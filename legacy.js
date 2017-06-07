'use strict'
var pull      = require('pull-stream')
var pl        = require('pull-level')
var Live      = require('pull-live')
var paramap   = require('pull-paramap')
var u         = require('./util')
var stdopts   = u.options
var Format    = u.formatStream
var msgFmt    = u.format
var timestamp = require('monotonic-timestamp')

module.exports = function (db, flumedb) {

  var logDB = db.sublevel('log')
  db.pre(function (op, add, _batch) {
    var msg = op.value
    var id = op.key
    // index by sequence number

    var localtime = op.timestamp = timestamp()

    add({
      key: localtime, value: id,
      type: 'put', prefix: logDB
    })

  })

  function Limit (fn) {
    return function (opts) {
      if(opts && opts.limit && opts.limit > 0) {
        var limit = opts.limit
        var read = fn(opts)
        return function (abort, cb) {
          if(limit--) return read(abort, function (err, data) {
            if(data && data.sync) limit ++
            cb(err, data)
          })
          else read(true, cb)
        }
      }
      else
        return fn(opts)
    }
  }

  db.createLogStream = Limit(Live(function (opts) {
    opts = stdopts(opts)
    var keys = opts.keys; delete opts.keys
    var values = opts.values; delete opts.values
    return pull(
      pl.old(logDB, stdopts(opts)),
      //lookup2(keys, values, 'timestamp')
      paramap(function (data, cb) {
        var key = data.value
        var seq = data.key
        db.get(key, function (err, value) {
          if (err) cb(err)
          else cb(null, msgFmt(keys, values, {key: key, value: value, timestamp: seq}))
        })
      })
    )
  }, function (opts) {
    return pl.live(db, stdopts(opts))
  }))

  if(flumedb) {
    flumedb.progress = {}
    function one (opts, cb) {
      pull(
        db.createLogStream(opts),
        pull.collect(function (err, ary) {
          cb(err, ary[ary.length - 1])
        })
      )
    }

    function update (since) {
      var prog = flumedb.progress
      var start = (prog.start = flumedb.progress.start ? flumedb.progress.start : +since)
      prog.current = +since
      prog.ratio =
        (prog.current - start) / (prog.target - start)
    }

    one({reverse: true, limit: 1}, function (err, last) {
      if(!last) ready() //empty legacy database.
      else {
        flumedb.progress.target = +last.timestamp
        flumedb.since.once(function (v) {
          if(v === -1) load(null)
          else flumedb.get(v, function (err, data) {
            if(err) throw err
            if(data.timestamp < last.timestamp) load(data.timestamp)
            else ready()
          })
        })
      }

      function load(since) {
        update(since)
        pull(
          db.createLogStream({gt: since}),
          paramap(function (data, cb) {
            update(data.timestamp)
            flumedb.append(data, cb)
          }, 32),
          pull.drain(null, ready)
        )
      }
      function ready () {
        if(!flumedb.progress.target) {
          flumedb.progress.target = flumedb.progress.current = flumedb.progress.ratio = 1
          flumedb.progress.start = 0
        }
        flumedb.ready.set(true)
      }
    })
  }
}




