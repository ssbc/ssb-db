'use strict'
var path = require('path')
var Flume = require('flumedb')
var OffsetLog = require('flumelog-offset')
//var codec = require('flumecodec/json')
var AsyncWrite = require('async-write')
var V = require('ssb-validate')
var timestamp = require('monotonic-timestamp')
var Obv       = require('obv')
var _unbox    = require('ssb-keys').unbox
var box    = require('ssb-keys').box
var pull      = require('pull-stream')
var rebox     = require('./util').rebox
var isFeed = require('ssb-ref').isFeed

var isArray = Array.isArray

function unbox(data, unboxers) {
  if(data && isString(data.value.content)) {
    for(var i = 0;i < unboxers.length;i++) {
        var plaintext = unboxers[i](data.value.content, data.value)
        if(plaintext) {
            data.value.cyphertext = data.value.content
            data.value.content = plaintext
            data.value.private = true
            return data
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

function toKeyValueTimestamp(msg) {
  return {
    key: V.id(msg),
    value: msg,
    timestamp: timestamp()
  }
}

function isString (s) {
  return 'string' === typeof s
}

module.exports = function (dirname, keys, opts) {
  var hmac_key = opts && opts.caps && opts.caps.sign


  var main_unboxer = function(content) { return _unbox(content, keys); }
  var unboxers = [ main_unboxer ]

  var codec = {
    encode: function (obj) {
      return JSON.stringify(obj, null, 2)
    },
    decode: function (str) {
      return unbox(JSON.parse(str.toString()), unboxers)
    },
    buffer: false,
    type: 'ssb'
  }

  var log = OffsetLog(path.join(dirname, 'log.offset'), {blockSize:1024*16, codec:codec})

  //NOTE: must use db.ready.set(true) at when migration is complete

  var db = Flume(log, false) //false says the database is not ready yet!
  .use('last', require('./indexes/last')())

  var state = V.initial(), ready = false
  var waiting = [], flush = []

  var append = db.rawAppend = db.append
  db.post = Obv()
  var queue = AsyncWrite(function (_, cb) {
    var batch = state.queue//.map(toKeyValueTimestamp)
    state.queue = []
    append(batch, function (err, v) {
      batch.forEach(function (data) {
        db.post.set(rebox(data))
      })
      cb(err, v)
    })
  }, function reduce(_, msg) {
    state = V.append(state, hmac_key, msg)
    state.queue[state.queue.length-1] = toKeyValueTimestamp(state.queue[state.queue.length-1])
    return state
  }, function (_state) {
    return state.queue.length > 1000
  }, function isEmpty (_state) {
    return !state.queue.length
  }, 10)

  queue.onDrain = function () {
    if(state.queue.length == 0) {
      var l = flush.length;
      for (var i = 0; i < l; ++i)
        flush[i]()
      flush = flush.slice(l)
    }
  }

  db.last.get(function (err, last) {
    //copy to so we avoid weirdness, because this object
    //tracks the state coming in to the database.
    for(var k in last) {
      state.feeds[k] = {
        id: last[k].id,
        timestamp: last[k].ts||last[k].timestamp,
        sequence: last[k].sequence,
        queue: []
      }
    }
    ready = true

    var l = waiting.length;
    for (var i = 0; i < l; ++i)
      waiting[i]()
    waiting = waiting.slice(l)
  })

  function wait(fn) {
    return function (value, cb) {
      if(ready) fn(value, cb)
      else waiting.push(function () {
        fn(value, cb)
      })
    }
  }

  db.queue = wait(function (msg, cb) {
    queue(msg, function (err) {
      if(err) cb(err)
      else cb(null, toKeyValueTimestamp(msg))
    })
  })
  db.append = wait(function (opts, cb) {
    try {
      var content = opts.content, recps = opts.content.recps
      if(recps) {
        if(isFeed(recps) || isArray(recps) && recps.every(isFeed) && recps.length > 0) {
          recps = opts.content.recps = [].concat(recps) //force to array
          content = opts.content = box(opts.content, recps)
        }
        else throw new Error('private message must have all valid recipients, was:'+JSON.stringify(recps))
      }

      var msg = V.create(
        state.feeds[opts.keys.id],
        opts.keys, opts.hmacKey || hmac_key,
        content,
        timestamp()
      )
    }
    catch (err) {
      cb(err)
      return
    }

    queue(msg, function (err) {
      if(err) return cb(err)
      var data = state.queue[state.queue.length-1]
      flush.push(function () {
        cb(null, data)
      })
    })
  })
  db.buffer = function () {
    return queue.buffer
  }
  db.flush = function (cb) {
    //maybe need to check if there is anything currently writing?
    if(!queue.buffer || !queue.buffer.queue.length && !queue.writing) cb()
    else flush.push(cb)
  }
  db.addUnboxer = function(unboxer) {
    unboxers.push(unboxer);
  }

  return db
}



