var worklog  = require('level-worklog')
var contpara = require('continuable-para')
var pull     = require('pull-stream')
var pl       = require('pull-level')
var paramap  = require('pull-paramap')
var bytewise = require('bytewise/hex')
var replicate = require('./replicate')
var timestamp = require('monotonic-timestamp')

//53 bit integer
var MAX_INT  = 0x1fffffffffffff
var encode = bytewise.encode

module.exports = function (db, opts) {

  var logDB = db.sublevel('log', {valueEncoding: opts})
  var feedDB = db.sublevel('fd')
  var clockDB = db.sublevel('clk')
  var lastDB = db.sublevel('lst')

  function get (db, key) {
    return function (cb) { db.get(encode(key), cb) }
  }

//  worklog(db, logDB)

  var validation = require('./validation')(db, opts)

  db.pre(function (op, add, _batch) {
    var msg = op.value
    // index by sequence number
    var hash = bytewise.decode(op.key)
    add({
      key: encode([msg.author, msg.sequence]), value: hash,
      type: 'put', prefix: clockDB
    })
    add({
      key: encode([msg.timestamp, msg.author]), value: hash,
      type: 'put', prefix: feedDB
    })
    // index the latest message from each author
    add({
      key: encode(msg.author), value: msg.sequence,
      type: 'put', prefix: lastDB
    })

    add({
      key: encode(timestamp()), value: hash,
      type: 'put', prefix: logDB
    })

  })

  db.getPublicKey = function (id, cb) {
    function cont (cb) {
      clockDB.get(encode([id, 1]), function (err, hash) {
      if(err) return cb(err)
        db.get(encode(hash), function (err, msg) {
          if(err) return cb(err)
          cb(null, msg.message)
        })
      })
    }
    return cb ? cont(cb) : cont
  }

  db.add = function (msg, cb) {
    //check that msg is valid (follows from end of database)
    //then insert into database.
    var n = 1
    validation.validate(msg, function (err) {
      if(--n) throw new Error('called twice')
      cb(err)
    })
  }

  db.createFeedStream = function (id, opts) {
    opts = opts || {}
    opts.start = encode([id, 0])
    opts.end = encode([id, MAX_INT])
    opts.keys = false
    return pull(
      pl.read(clockDB, opts),
      paramap(function (key, cb) {
        db.get(encode(key), cb)
      })
    )

  }

  db.latest = function (opts) {
    return pull(
      pl.read(lastDB),
      pull.map(function (data) {
        var d = {id: bytewise.decode(data.key), sequence: data.value}
        return d
      })
    )
  }

  db.follow = function (other, cb) {
    lastDB.put(encode(other), 0, cb)
  }

  db.createHistoryStream = function (id, seq, live) {
    return pull(
      pl.read(clockDB, {
        start:   encode([id, seq]),
        end:  encode([id, MAX_INT]),
        tail: live, live: live,
        keys: false
      }),
      paramap(function (key, cb) {
        db.get(encode(key), cb)
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


  return db
}
