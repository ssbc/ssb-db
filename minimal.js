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

function isFunction (f) { return typeof f === 'function' }
function isString (s) { return typeof s === 'string' }

function box (content, boxers) {
  var recps = content.recps
  if (!recps) return content

  if (typeof recps === 'string') recps = content.recps = [recps]
  if (!Array.isArray(recps)) throw new Error('private message field "recps" expects an Array of recipients')
  if (recps.length === 0) throw new Error('private message field "recps" requires at least one recipient')

  var ciphertext
  for (var i = 0; i < boxers.length; i++) {
    const boxer = boxers[i]
    ciphertext = boxer(content, recps)

    if (ciphertext) break
  }
  if (!ciphertext) throw RecpsError(recps)

  return ciphertext
}

function unbox (msg, msgKey, unboxers) {
  if (!msg || !isString(msg.value.content)) return msg

  var plain
  for (var i = 0; i < unboxers.length; i++) {
    const unboxer = unboxers[i]

    if (isFunction(unboxer)) {
      plain = unboxer(msg.value.content, msg.value)
    }
    else {
      if (!msgKey) msgKey = unboxer.key(msg.value.content, msg.value)
      if (msgKey) plain = unboxer.value(msg.value.content, msgKey)
    }
    if (plain) break
  }

  if (!plain) return msg
  return decorate(msg, plain)

  function decorate (msg, plain) {
    var value = {}
    for (var k in msg.value) { value[k] = msg.value[k] }

    // set `meta.original.content`
    value.meta = u.metaBackup(value, 'content')

    // modify content now that it's saved at `meta.original.content`
    value.content = plain

    // set meta properties for private messages
    value.meta.private = true
    if (msgKey) { value.meta.unbox = msgKey.toString('base64') }

    // backward-compatibility with previous property location
    // this property location may be deprecated in favor of `value.meta`
    value.cyphertext = value.meta.original.content
    value.private = value.meta.private
    if (msgKey) { value.unbox = value.meta.unbox }

    return {
      key: msg.key,
      value,
      timestamp: msg.timestamp
    }
  }
}

/*
## queue (msg, cb)

add a message to the log, buffering the write to make it as fast as
possible, cb when the message is queued.

## append (msg, cb)

write a message, callback once it's definitely written.
*/

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
  var ready = false
  var waiting = []
  var flush = []

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
      var l = flush.length
      for (var i = 0; i < l; ++i) { flush[i]() }
      flush = flush.slice(l)
    }
  }

  db.last.get(function (_, last) {
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

    var n = 0
    for (var i = 0; i < unboxers.length; i++) {
      if (!isFunction(unboxers[i].init)) continue

      n++
      unboxers[i].init(next)
    }

    function next () {
      if (--n) return

      ready = true

      var l = waiting.length
      for (var i = 0; i < l; ++i) { waiting[i]() }
      waiting = waiting.slice(l)
    }
  })

  function wait (fn) {
    return function (value, cb) {
      if (ready) fn(value, cb)
      else {
        waiting.push(function () {
          fn(value, cb)
        })
      }
    }
  }

  db.queue = wait(function dbQueue (msg, cb) {
    queue(msg, function (err) {
      var data = state.queue[state.queue.length - 1]
      if (err) cb(err)
      else cb(null, data)
    })
  })

  db.append = wait(function append (opts, cb) {
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
      flush.push(function () {
        cb(null, data)
      })
    })
  })

  db.buffer = function buffer () {
    return queue.buffer
  }

  db.flush = function dbFlush (cb) {
    // maybe need to check if there is anything currently writing?
    if (!queue.buffer || !queue.buffer.queue.length && !queue.writing) cb()
    else flush.push(cb)
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
        unboxers.push(unboxer)
        break

      default: throw new Error('invalid unboxer')
    }
  }

  /* TODO extract to ssb-private */
  var box1 = {
    boxer: (content, recps) => {
      if (!recps.every(isFeed)) return

      return ssbKeys.box(content, recps)
    },
    unboxer: {
      init: (done) => {
        // loads trial keys into box1State (memory)
        done()
      },
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
  // ////////////////////////////////

  db.addMap = function (fn) {
    maps.push(fn)
  }

  db._unbox = function dbUnbox (msg, msgKey) {
    return unbox(msg, msgKey, unboxers)
  }

  return db
}

function RecpsError (recps) {
  return new Error(
    'private message requested, but no boxers could encrypt these recps: ' +
    JSON.stringify(recps)
  )
}
