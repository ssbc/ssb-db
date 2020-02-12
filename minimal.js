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

function unbox (msg, msgKey, unboxers, cb) {
  if (!msg || !isString(msg.value.content)) return cb(null, msg)

  attempt()
  function attempt (i = 0) {
    if (i === unboxers.length) return cb(null, msg)

    const unboxer = unboxers[i]
    if (isFunction(unboxer)) {
      return unboxer(msg.value.content, msg.value, handleResult)
    }

    if (msgKey) {
      return unboxer.value(msg.value.content, msgKey, msg.value, handleResult)
    }

    unboxer.key(msg.value.content, msg.value, function (err, _msgKey) {
      if (err) return cb(err)
      if (_msgKey) {
        msgKey = _msgKey  // used by decorate
        unboxer.value(msg.value.content, msgKey, msg.value, handleResult)
      }
      else attempt(i + 1)
    })
  }
  
  function handleResult (err, plaintext) {
    if (err) return cb(err)
    if (plaintext) return cb(null, decorate(msg, plaintext))

    attempt(i + 1)
  }

  function decorate(msg, plaintext) {
    var value = {}
    for (var k in msg.value) { value[k] = msg.value[k] }

    // set `meta.original.content`
    value.meta = u.metaBackup(value, 'content')

    // modify content now that it's saved at `meta.original.content`
    value.content = plaintext

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

  const unboxerMap = (msg, cb) => {
    db.unbox(msg, null, (err, unboxed) => {
      if (err) {
        console.error(err)
        return cb(null, msg)
      }
      cb(null, unboxed)
    })
  }
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

  queue.onDrain = function () {
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
    ready = true

    var l = waiting.length
    for (var i = 0; i < l; ++i) { waiting[i]() }
    waiting = waiting.slice(l)
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

  db.queue = wait(function (msg, cb) {
    queue(msg, function (err) {
      var data = state.queue[state.queue.length - 1]
      if (err) cb(err)
      else cb(null, data)
    })
  })

  db.append = wait(function (opts, cb) {
    db.box(opts.content, state.feeds[opts.keys.id], function (err, content) {
      if (err) return cb(err)

      try {
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
  })

  db.buffer = function () {
    return queue.buffer
  }

  db.flush = function (cb) {
    // maybe need to check if there is anything currently writing?
    if (!queue.buffer || !queue.buffer.queue.length && !queue.writing) cb()
    else flush.push(cb)
  }

  db.addBoxer = function (boxer) {
    boxers.push(boxer)
  }

  db.addUnboxer = function (unboxer) {
    switch (typeof unboxer) {
      case 'function':
        unboxers.push(unboxer)
        break

      case 'object':
        if (typeof unboxer.key !== 'function') throw new Error('invalid unboxer')
        if (typeof unboxer.value !== 'function') throw new Error('invalid unboxer')
        unboxers.push(unboxer)
        break

      default: throw new Error('invalid unboxer')
    }
  }

  /* TODO extract to ssb-private */
  var box1 = {
    boxer: function (content, recps, cb) {
      if (!recps.every(isFeed)) return cb(null, null)

      cb(null, ssbKeys.box(content, recps))
    },
    unboxer: {
      key: function (ciphertext, value, cb) { 
        if (!ciphertext.endsWith('.box')) return cb(null, null)
        // TODO move this inside of ssb-keys

        cb(null, ssbKeys.unboxKey(ciphertext, keys))
      },
      value: function (ciphertext, msgKey, value, cb) {
        cb(null, ssbKeys.unboxBody(ciphertext, msgKey))
      }
    }
  }
  db.addBoxer(box1.boxer)
  db.addUnboxer(box1.unboxer)
  // ////////////////////////////////

  db.box = function (content, state, cb) { // state not used
    var recps = content.recps
    if (!recps) return cb(null, content)

    if (typeof recps === 'string') recps = content.recps = [recps]
    if (!Array.isArray(recps)) return cb(new Error('private message field "recps" expects an Array of recipients'))
    if (recps.length === 0) return cb(new Error('private message field "recps" requires at least one recipient'))

    function attempt (i = 0) {
      const boxer = boxers[i]

      boxer(content, recps, function (err, ciphertext) {
        if (err) return console.error(err)
        if (ciphertext) return cb(null, ciphertext)

        if (i === boxers.length - 1) cb(RecpsError(recps))
        else attempt(i + 1)
      })
    }

    attempt()
  }
  db.unbox = function (msg, msgKey, cb) {
    return unbox(msg, msgKey, unboxers, cb)
  }

  db.addMap = function (fn) {
    maps.push(fn)
  }

  return db
}

function RecpsError (recps) {
  return new Error(
    'private message requested, but no boxers could encrypt these recps: ' +
    JSON.stringify(recps)
  )
}
