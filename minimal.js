'use strict'
var path = require('path')
var Flume = require('flumedb')
var OffsetLog = require('flumelog-offset')
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

  let writing = false

  const write = () => {
    writing = true
    // Very defensive: Is this necessary? I don't know whether it's possible
    // for another function to `state.queue.push()` between these two lines.
    const batch = state.queue.slice()
    state.queue = state.queue.slice(batch.length)

    append(batch, function (err) {
      // Previously this error wasn't being caught anywhere. :(
      // New behavior: if a write fails, crash loudly and throw an error.
      if (err) throw err

      // If we have new messages in the queue, write them!
      // Otherwise, run all callbacks added via `flush.add()`
      if (state.queue.length) {
        write()
      } else {
        writing = false
        flush.runAll()
      }

      // Update the observable
      batch.forEach(function (data) {
        db.post.set(u.originalData(data))
      })
    })
  }

  const queue = (message, cb) => {
    try {
      // SSB-Validate mutates `state` internally.
      V.append(state, hmacKey, message)
      cb(null, state.queue[state.queue.length - 1])
      if (writing === false) {
        write()
      }
    } catch (e) {
      cb(e)
    }
  }

  db.queue = waitForValidators(queue)

  const getFeedState = (feedId) => {
    const feedState = state.feeds[feedId]
    if (!feedState) return { id: null, sequence: 0 }
    // NOTE this covers the case where you have a brand new feed (or new createFeed)

    // Remove vestigial properties like 'timestamp'
    return {
      id: feedState.id,
      sequence: feedState.sequence
    }
  }
  db.getFeedState = waitForValidators((feedId, cb) => {
    cb(null, getFeedState(feedId))
  })

  db.append = waitForBoxers(waitForValidators(function dbAppend (opts, cb) {
    try {
      const feedState = getFeedState(opts.keys.id)
      const content = box(opts.content, boxers, feedState)
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

    queue(msg, function (err, message) {
      if (err) return cb(err)
      flush.add(() => cb(null, message))
    })
  }))

  db.flush = function dbFlush (cb) {
    if (state.queue.length === 0 && writing === false) cb()
    else flush.add(() => cb())
  }

  db.addMap = function (fn) {
    maps.push(fn)
  }

  db.addBoxer = function addBoxer (boxer) {
    if (typeof boxer === 'function') return db.addBoxer({ value: boxer })
    if (typeof boxer.value !== 'function') throw new Error('invalid boxer')

    if (boxer.init) {
      setup.boxers.add(boxer.init)
      setup.boxers.runAll()
    }

    boxers.push(boxer.value)
  }

  db.addUnboxer = function addUnboxer (unboxer) {
    if (typeof unboxer === 'function') {
      unboxers.push(unboxer)
      return
    }

    if (typeof unboxer.key !== 'function') throw new Error('invalid unboxer')
    if (typeof unboxer.value !== 'function') throw new Error('invalid unboxer')
    if (unboxer.init && typeof unboxer.value !== 'function') throw new Error('invalid unboxer')

    if (unboxer.init) {
      setup.unboxers.add(unboxer.init)
      setup.unboxers.runAll()
    }
    unboxers.push(unboxer)
  }

  db._unbox = function dbUnbox (msg, msgKey) {
    return unbox(msg, msgKey, unboxers)
  }

  const _rebuild = db.rebuild
  db.rebuild = function (cb) {
    db.rebuild.isActive = true
    unbox.resetCache()
    _rebuild((err) => {
      db.rebuild.isActive = false
      if (typeof cb === 'function') cb(err)
      else if (err) console.error(err)
    })
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
