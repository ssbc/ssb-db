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

function unbox (data, key, unboxers) {
  var plaintext
  if (data && isString(data.value.content)) {
    for (var i = 0; i < unboxers.length; i++) {
      var unboxer = unboxers[i]
      if (isFunction(unboxer)) {
        plaintext = unboxer(data.value.content, data.value)
      } else {
        if (!key) key = unboxer.key(data.value.content, data.value)
        if (key) plaintext = unboxer.value(data.value.content, key, data.value)
      }

      if (plaintext) {
        var msg = {}
        for (var k in data.value) { msg[k] = data.value[k] }

        // set `meta.original.content`
        msg.meta = u.metaBackup(msg, 'content')

        // modify content now that it's saved at `meta.original.content`
        msg.content = plaintext

        // set meta properties for private messages
        msg.meta.private = true
        if (key) { msg.meta.unbox = key.toString('base64') }

        // backward-compatibility with previous property location
        // this property location may be deprecated in favor of `msg.meta`
        msg.cyphertext = msg.meta.original.content
        msg.private = msg.meta.private
        if (key) { msg.unbox = msg.meta.unbox }

        return { key: data.key, value: msg, timestamp: data.timestamp }
      }
    }
  }
  return data
}

/*
## queue (msg, cb)

add a message to the log, buffering the write to make it as fast as
possible, cb when the message is queued.

## append (msg, cb)

write a message, callback once it's definitely written.
*/

function isString (s) {
  return typeof s === 'string'
}

module.exports = function (dirname, keys, opts) {
  var caps = opts && opts.caps || {}
  var hmacKey = caps.sign

  var boxers = []
  var unboxers = []

  var log = OffsetLog(path.join(dirname, 'log.offset'), { blockSize: 1024 * 16, codec })

  const unboxerMap = (msg, cb) => cb(null, db.unbox(msg))
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
    unboxers.push(unboxer)
  }

  /* TODO extract to ssb-private */
  var box1 = {
    box: function (content, recps, cb) {
      if (!recps.every(isFeed)) return cb(null, null)

      cb(null, ssbKeys.box(content, recps))
    },
    unbox: {
      key: function (ciphertext) { 
        if (!ciphertext.endsWith('.box')) return null
        // TODO move this inside of ssb-keys

        return ssbKeys.unboxKey(ciphertext, keys)
      },
      value: function (ciphertext, key) { return ssbKeys.unboxBody(ciphertext, key) }
    }
  }
  db.addBoxer(box1.box)
  db.addUnboxer(box1.unbox)
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
        if (err) console.error(err)
        if (ciphertext) return cb(null, ciphertext)

        if (i === boxers.length - 1) cb(RecpsError(recps))
        else {
          attempt(i + 1)
        }
      })
    }

    attempt()
  }
  db.unbox = function (data, key) {
    return unbox(data, key, unboxers)
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
