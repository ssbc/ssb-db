'use strict';
var contpara  = require('continuable-para')
var pull      = require('pull-stream')
var pl        = require('pull-level')
var paramap   = require('pull-paramap')
var replicate = require('./replicate')
var timestamp = require('monotonic-timestamp')
var Feed      = require('./feed')

//53 bit integer
var MAX_INT  = 0x1fffffffffffff

module.exports = function (db, opts) {

  var logDB = db.sublevel('log')
  var feedDB = db.sublevel('fd')
  var clockDB = db.sublevel('clk')
  var lastDB = db.sublevel('lst')

  function get (db, key) {
    return function (cb) { db.get(encode(key), cb) }
  }

  var validation = require('./validation')(db, opts)

  db.pre(function (op, add, _batch) {
    var msg = op.value
    // index by sequence number
    add({
      key: [msg.author, msg.sequence], value: op.key,
      type: 'put', prefix: clockDB
    })
    add({
      key: [msg.timestamp, msg.author], value: op.key,
      type: 'put', prefix: feedDB
    })
    // index the latest message from each author
    add({
      key: msg.author, value: msg.sequence,
      type: 'put', prefix: lastDB
    })

    add({
      key: timestamp(), value: op.key,
      type: 'put', prefix: logDB
    })

  })

  db.getPublicKey = function (id, cb) {
    function cont (cb) {
      clockDB.get([id, 1], function (err, hash) {
      if(err) return cb(err)
        db.get(hash, function (err, msg) {
          if(err) return cb(err)
          cb(null, msg.message)
        })
      })
    }
    return cb ? cont(cb) : cont
  }

  //msg must be an already valid message, with signature.
  //since creating this involves some state (it must increment
  //the sequence and point to the previous message)
  //it's recommended to append messages via a Feed object
  //which will manage that for you. (see feed.js)

  db.add = function (msg, cb) {
    //check that msg is valid (follows from end of database)
    //then insert into database.
    var n = 1
    validation.validate(msg, function (err) {
      if(--n) throw new Error('called twice')
      cb(err)
    })
  }

  db.createFeedStream = function (opts) {

    opts = opts || {}
    opts.keys = false
    return pull(
      pl.read(feedDB, opts),
      paramap(function (key, cb) {
        db.get(key, cb)
      })
    )
  }

  db.latest = function (opts) {
    return pull(
      pl.read(lastDB),
      pull.map(function (data) {
        var d = {id: data.key, sequence: data.value}
        return d
      })
    )
  }

  db.follow = function (other, cb) {
    lastDB.put(other, 0, cb)
  }

  db.isFollowing = function (other, cb) {
    lastDB.get(other, cb)
  }

  db.following = function () {
    return pl.read(lastDB)
  }

  db.createHistoryStream = function (id, seq, live) {
    return pull(
      pl.read(clockDB, {
        start:   [id, seq],
        end:  [id, MAX_INT],
        tail: live, live: live,
        keys: false
      }),
      paramap(function (key, cb) {
        db.get(key, cb)
      })
    )
  }

  db.createWriteStream = function (cb) {
    return pull(
      paramap(function (data, cb) {
        db.add(data, cb)
      }),
      pull.drain(null, cb)
    )
  }

  db.createReplicationStream = function (cb) {
    return replicate(db, cb || function () {})
  }

  db.createFeed = function (keys) {
    if(!keys)
      keys = opts.generate()
    return Feed(db, keys, opts)
  }

  db.getLatest = function (id, cb) {
    lastDB.get(id, function (err, v) {
      if(err) return cb(err)
      clockDB.get([id, v], function (err, hash) {
        if(err) return cb(err)
        db.get(hash, cb)
      })
    })
  }

  return db
}
