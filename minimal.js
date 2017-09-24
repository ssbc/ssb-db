var path = require('path')
var Flume = require('flumedb')
var OffsetLog = require('flumelog-offset')
var codec = require('flumecodec/json')
var AsyncWrite = require('async-write')
var V = require('ssb-validate')
var timestamp = require('monotonic-timestamp')


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

module.exports = function (dirname) {

  var log = OffsetLog(path.join(dirname, 'log.offset'), 1024*16, codec)
  //NOTE: must use db.ready.set(true) at when migration is complete

  var db = Flume(log, false) //false says the database is not ready yet!
  .use('last', require('./indexes/last')())

  var state = V.initial(), ready = false
  var waiting = [], flush = []

  var append = db.append
  var queue = AsyncWrite(function (_, cb) {
    var batch = state.queue//.map(toKeyValueTimestamp)
    state.queue = []
    append(batch, function (err, v) {
      cb(err, v)
    })
  }, function reduce(_, msg) {
    state = V.append(state, msg)
    state.queue[state.queue.length-1] = toKeyValueTimestamp(state.queue[state.queue.length-1])
    return state
  }, function (_state) {
    return state.queue.length > 1000
  }, function isEmpty (_state) {
    return !state.queue.length
  })

  queue.onDrain = function () {
    if(state.queue.length == 0) {
      var l = flush.length
      while(l--) flush.shift()()
    }
  }

  db.last.get(function (err, last) {
    //copy to so we avoid weirdness, because this object
    //tracks the state coming in to the database.
    for(var k in last)
      state.feeds[k] = {
        id: last[k].id,
        timestamp: last[k].timestamp,
        sequence: last[k].sequence
      }
    ready = true
    while(waiting.length)
      waiting.shift()()
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
    var msg = V.create(
      state.feeds[opts.keys.id],
      opts.keys, opts.hmacKey,
      opts.content,
      timestamp()
    )
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
    flush.push(cb)
  }

  return db
}

