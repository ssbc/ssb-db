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
        if(values == false) return cb(null, {key:data.value})
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
    var prog = {current: 0, start: 0, target: 0}

    function one (opts, cb) {
      pull(
        db.createLogStream(opts),
        pull.collect(function (err, ary) {
          cb(err, ary[ary.length - 1])
        })
      )
    }

    one({reverse: true, limit: 1}, function (err, last) {
      if(!last) ready() //empty legacy database.
      else {
        flumedb.since.once(function (v) {
          if(v === -1) {
            load(null)
          }
          else flumedb.get(v, function (err, data) {
            if(err) throw err
            if(data.timestamp < last.timestamp) {
              load(data.timestamp)
            }
            else ready()
          })
        })
      }

      function load(since) {
        // fast track for more accurate progress
        flumedb.progress.migration = prog
        var c = 0
        pull(
          pl.old(logDB, {gt: since, values: false}),
          pull.drain(function () {
            c++
          }, function () {
            prog.target = c
            migrate()
          })
        )

        function migrate () {
          // actual upgrade
          pull(
            db.createLogStream({gt: since}),
            paramap(function (data, cb) {
              prog.current += 1
              flumedb.rawAppend(data, cb)
            }, 32),
            pull.drain(null, ready)
          )
        }
      }
      function ready (err) {
        if(err) throw err
        flumedb.ready.set(true)
      }
    })
  }
}

