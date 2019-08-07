'use strict'
var path = require('path')
var Flume = require('flumedb')
var OffsetLog = require('flumelog-offset')
var codec = require('./codec')
var AsyncWrite = require('async-write')
var V = require('ssb-validate')
var timestamp = require('monotonic-timestamp')
var Obv = require('obv')
var ssbKeys = require('ssb-keys')
var box = ssbKeys.box
var u = require('./util')
var isFeed = require('ssb-ref').isFeed
var pull = require('pull-stream')
var asyncMap = require('pull-stream/throughs/async-map')

var isArray = Array.isArray
function isFunction (f) { return typeof f === 'function' }

function unbox (data, unboxers, key) {
  var plaintext

  if (data && isString(data.value.content)) {
    for (var i = 0; i < unboxers.length; i++) {
      var unboxer = unboxers[i]

      if (isFunction(unboxer)) {
        plaintext = unboxer(data.value.content, data.value)
      } else {
        if (!key) key = unboxer.key(data.value.content, data.value)
        if (key) plaintext = unboxer.value(data.value.content, key)
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
  var hmacKey = opts && opts.caps && opts.caps.sign

  var mainUnboxer = {
    key: function (content) { return ssbKeys.unboxKey(content, keys) },
    value: function (content, key) { return ssbKeys.unboxBody(content, key) }
  }

  var unboxers = [ mainUnboxer ]

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

    var batchAppend = batch.findIndex(function (elem) {
      return isArray(elem)
    });

    if (batchAppend === -1) {

      append(batch, function (err, v) {
        handlePost(batch)
        cb(err, v)
      })
    } else {
      var batchIndexes = findBatchIndexRanges(batch)

      var finalResult = null;

      pull(
        pull.values(batchIndexes),
        asyncMap(function(item, mapCb) {
          var startIndex = item[0]
          var endIndex = item[1]
          var slice = batch.slice(startIndex, endIndex)

          if (slice.length === 1 && isArray(slice[0])) {
            slice = slice[0]
          }

          append(slice, function(err, v) {
            handlePost(slice)
            mapCb(err, v)
          })
        }
      ),
      pull.drain(function(result) {
        finalResult = result
      }, function(err, v) {
        cb(err, finalResult)
      }))

    }

    function handlePost(d) {
      d.forEach(function (data) {
        if (!isArray(data)) {
          db.post.set(u.originalData(data))
        } else {
          data.forEach(d => db.post.set(u.originalData(d)))
        }
      })
    }


  }, function reduce (_, msg) {
    if (isArray(msg)) {
      // This is an atomic bulk append
      return V.appendBulk(state, hmacKey, msg)
    } else {
      return V.append(state, hmacKey, msg)
    }
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

  function findBatchIndexRanges(batch) {
    
    var batchIndexes = batch.map(function(elem, index) {
      if (isArray(elem)) {
        return index
      } else {
        return null
      }

    }).filter(function(elem) {
      return elem !== null
    })

    var start = 0
    var result = []
    batchIndexes.forEach(function (batchIndex) {
      
      if (start < batchIndex) {
        result.push([start, batchIndex])
      }

      result.push([batchIndex, batchIndex + 1])
      start = batchIndex + 1
    })

    var lastBatchIndex = batchIndexes[batchIndexes - 1];

    if (lastBatchIndex < (batch.length - 1)) {
      result.push([lastBatchIndex + 1, batch.length])
    }

    return result
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
    try {
      var content = opts.content
      content = boxOrThrow(content)
      var msg = V.create(
        state.feeds[opts.keys.id],
        opts.keys, opts.hmacKey || hmacKey,
        content,
        timestamp()
      )
    } catch (err) {
      cb(err)
      return
    }

    queue(msg, function (err) {
      if (err) return cb(err)
      var data = state.queue[state.queue.length - 1]
      flush.push(function () {
        cb(null, data)
      })
    })
  })

  db.appendAll = wait(function (opts, cb) {
    try {
      var messages = opts.messages
      messages = messages.map(boxOrThrow).map(function(message) {
        return {
          content: message,
          timestamp: timestamp()
        }

      })

      var validatedMessages = V.createAll(
        state.feeds[opts.keys.id],
        opts.keys,
        opts.hmacKey || hmacKey,
        messages
      )

      queue(validatedMessages, function (err) {
        if (err) return cb(err)
        var data = state.queue[state.queue.length - 1]
        flush.push(function () {
          cb(null, data)
        })
      })

    } catch (err) {
      cb(err)
      return
    }
      
  })

  db.buffer = function () {
    return queue.buffer
  }

  db.flush = function (cb) {
    // maybe need to check if there is anything currently writing?
    if (!queue.buffer || !queue.buffer.queue.length && !queue.writing) cb()
    else flush.push(cb)
  }

  db.addUnboxer = function (unboxer) {
    unboxers.push(unboxer)
  }

  db.unbox = function (data, key) {
    return unbox(data, unboxers, key)
  }
  db.addMap = function (fn) {
    maps.push(fn)
  }

  function boxOrThrow(content) {
    var recps = content.recps
    if (recps) {
      const isNonEmptyArrayOfFeeds = isArray(recps) && recps.every(isFeed) && recps.length > 0
      if (isFeed(recps) || isNonEmptyArrayOfFeeds) {
        recps = content.recps = [].concat(recps) // force to array
        return box(content, recps)
      } else {
        const errMsg = 'private message recipients must be valid, was:' + JSON.stringify(recps)
        throw new Error(errMsg)
      }
    }

    return content
  }

  return db
}

