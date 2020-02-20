'use strict'
var path = require('path')
var Flume = require('flumedb')
var OffsetLog = require('flumelog-offset')
var AsyncWrite = require('async-write')
var V = require('ssb-validate')
var timestamp = require('monotonic-timestamp')
var Obv = require('obv')
var ssbKeys = require('ssb-keys')
var isFeed = require('ssb-ref').isFeed
var u = require('./util')
var codec = require('./codec')
var { box, unbox } = require('./autobox')

module.exports = function (dirname, keys, opts) {
  var caps = opts && opts.caps || {}
  var hmacKey = caps.sign

  var boxers = []
  var unboxers = []

  var log = OffsetLog(path.join(dirname, 'log.offset'), { blockSize: 1024 * 16, codec })

  const unboxerMap = wait((msg, cb) => {
    try {
      cb(null, unbox(msg, null, unboxers))
    } catch (err) {
      cb(err)
    }
  })
  const maps = [ unboxerMap ]
  const chainMaps = (val, cb) => {
    // assumes `maps.length >= 1`
    if (maps.length === 1) {
      maps[0](val, cb)
    } else {
      let idx = -1 // haven't entered the chain yet
      const next = (err, val) => {
        idx += 1
        if (err || idx === maps.length) {
          cb(err, val)
        } else {
          maps[idx](val, next)
        }
      }
      next(null, val)
    }
  }

  // NOTE: must use db.ready.set(true) at when migration is complete
  // false says the database is not ready yet!
  var db = Flume(log, true, chainMaps)
    .use('last', require('./indexes/last')())

  var state = V.initial()
  var setup = new u.AsyncJobQueue()
  var waiting = new u.AsyncJobQueue()
  var flush = new u.AsyncJobQueue() // doesn't currenlty use async-done

  function wait (fn) {
    return function (value, cb) {
      if (setup.isEmpty()) fn(value, cb)
      else {
        waiting.add(() => fn(value, cb))
        setup.runAll(() => {
          waiting.runAll()
        })
      }
    }
  }

  var append = db.rawAppend = db.append
  db.post = Obv()
  var queue = AsyncWrite(function (_, cb) {
    var batch = state.queue
    state.queue = []
    append(batch, function (err, v) {
      batch.forEach(function (data) {
        db.post.set(u.originalData(data))
      })
      cb(err, v)
    })
  }, function reduce (_, msg) {
    return V.append(state, hmacKey, msg)
  }, function (_state) {
    return state.queue.length > 1000
  }, function isEmpty (_state) {
    return !state.queue.length
  }, 100)

  queue.onDrain = function onDrain () {
    if (state.queue.length === 0) {
      flush.runAll()
    }
  }

  db.queue = wait(function dbQueue (msg, cb) {
    queue(msg, function (err) {
      var data = state.queue[state.queue.length - 1]
      if (err) cb(err)
      else cb(null, data)
    })
  })

  db.append = wait(function dbAppend (opts, cb) {
    try {
      const content = box(opts.content, boxers)
      var msg = V.create(
        state.feeds[opts.keys.id],
        opts.keys,
        opts.hmacKey || hmacKey,
        content,
        timestamp()
      )
    } catch (err) {
      return cb(err)
    }

    queue(msg, function (err) {
      if (err) return cb(err)
      var data = state.queue[state.queue.length - 1]
      flush.add(() => cb(null, data))
    })
  })

  db.buffer = function buffer () {
    return queue.buffer
  }

  db.flush = function dbFlush (cb) {
    // maybe need to check if there is anything currently writing?
    if (!queue.buffer || !queue.buffer.queue.length && !queue.writing) cb()
    else flush.add(() => cb())
  }

  db.addMap = function (fn) {
    maps.push(fn)
  }

  db.addBoxer = function addBoxer (boxer) {
    boxers.push(boxer)
  }

  db.addUnboxer = function addUnboxer (unboxer) {
    switch (typeof unboxer) {
      case 'function':
        unboxers.push(unboxer)
        break

      case 'object':
        if (typeof unboxer.key !== 'function') throw new Error('invalid unboxer')
        if (typeof unboxer.value !== 'function') throw new Error('invalid unboxer')
        if (unboxer.init && typeof unboxer.value !== 'function') throw new Error('invalid unboxer')

        if (unboxer.init) {
          setup.add(unboxer.init)
          setup.runAll()
        }
        unboxers.push(unboxer)

        break

      default: throw new Error('invalid unboxer')
    }
  }

  db._unbox = function dbUnbox (msg, msgKey) {
    return unbox(msg, msgKey, unboxers)
  }

  /* initialise some state */
  setup.add(done => {
    db.last.get((_, last) => {
      // copy to so we avoid weirdness, because this object
      // tracks the state coming in to the database.
      for (var k in last) {
        state.feeds[k] = {
          id: last[k].id,
          timestamp: last[k].ts || last[k].timestamp,
          sequence: last[k].sequence,
          queue: []
        }
      }
      done()
    })
  })
  setup.runAll()

  // TODO extract to ssb-private //////
  var box1 = {
    boxer: (content, recps) => {
      if (!recps.every(isFeed)) return

      return ssbKeys.box(content, recps)
    },
    unboxer: {
      // init: (done) => {
      //   // loads trial keys into box1State (memory)
      //   done()
      // },
      key: (ciphertext, msg) => {
        if (!ciphertext.endsWith('.box')) return
        // todo move this inside of ssb-keys

        return ssbKeys.unboxKey(ciphertext, keys)
      },
      value: (ciphertext, msgKey) => {
        return ssbKeys.unboxBody(ciphertext, msgKey)
      }
    }
  }
  db.addBoxer(box1.boxer)
  db.addUnboxer(box1.unboxer)
  // /TODO /////////////////////////////

  return db
}
