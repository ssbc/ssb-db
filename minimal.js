'use strict'
var path = require('path')
var Flume = require('flumedb')
var OffsetLog = require('flumelog-offset')
var AsyncWrite = require('async-write')
var V = require('ssb-validate')
var timestamp = require('monotonic-timestamp')
var Obv = require('obv')
var mkdirp = require('mkdirp')
var u = require('./util')
var codec = require('./codec')
var { box, unbox: _unbox } = require('./autobox')

module.exports = function (dirname, keys, opts) {
  var caps = (opts && opts.caps) || {}
  var hmacKey = caps.sign

  mkdirp.sync(dirname)
  var log = OffsetLog(path.join(dirname, 'log.offset'), { blockSize: 1024 * 16, codec })

  var state = V.initial()
  var flush = new u.AsyncJobQueue() // doesn't currenlty use async-done

  var boxers = []
  var unboxers = []
  var unbox = _unbox.withCache()
  // NOTE unbox.withCache needs to be instantiated *inside* this scope
  // otherwise the cache is shared across instances!

  var setup = {
    validators: new u.AsyncJobQueue(),
    unboxers: new u.AsyncJobQueue(),
    boxers: new u.AsyncJobQueue()
  }
  function waitForValidators (fn) {
    return function (...args) {
      setup.validators.runAll(() => fn(...args))
    }
  }
  function waitForUnboxers (fn) {
    return function (...args) {
      setup.unboxers.runAll(() => fn(...args))
    }
  }
  function waitForBoxers (fn) {
    return function (...args) {
      setup.boxers.runAll(() => fn(...args))
    }
  }

  const unboxerMap = waitForUnboxers((msg, cb) => {
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
  // TODO flume may be starting streams before all the chainMap details are ready / initialised
  // we should come back and check that / get it to for sure wait

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

  db.queue = waitForValidators(function dbQueue (msg, cb) {
    queue(msg, function (err) {
      var data = state.queue[state.queue.length - 1]
      if (err) cb(err)
      else cb(null, data)
    })
  })

  db.append = waitForBoxers(waitForValidators(function dbAppend (opts, cb) {
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
  }))

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
    switch (typeof boxer) {
      case 'function':
        boxers.push(boxer)
        break

      case 'object':
        if (typeof boxer.value !== 'function') throw new Error('invalid boxer')

        if (boxer.init) {
          setup.boxers.add(boxer.init)
          setup.boxers.runAll()
        }

        boxers.push(boxer.value)

        break

      default: throw new Error('invalid boxer')
    }
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
          setup.unboxers.add(unboxer.init)
          setup.unboxers.runAll()
        }
        unboxers.push(unboxer)

        break

      default: throw new Error('invalid unboxer')
    }
  }

  db._unbox = function dbUnbox (msg, msgKey) {
    return unbox(msg, msgKey, unboxers)
  }

  const _rebuild = db.rebuild
  db.rebuild = function (cb) {
    unbox.resetCache()
    _rebuild(cb)
  }

  /* initialise some state */
  setup.validators.add(done => {
    // TODO There's an impossible
    // the unboxer doesn't start working till the indexing is finished
    // but the unboxer is dependent on the indexing (for loading db.last)
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
  setup.validators.runAll()

  return db
}
