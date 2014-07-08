var worklog  = require('level-worklog')
var contpara = require('continuable-para')
var pull     = require('pull-stream')
var pl       = require('pull-level')
var paramap  = require('pull-paramap')
var bytewise = require('bytewise/hex')
//53 bit integer
var MAX_INT  = 0x1fffffffffffff

var encode = bytewise.encode

module.exports = function (db, opts) {

  var logDB = db.sublevel('log')
  var clockDB = db.sublevel('clk')
  var lastDB = db.sublevel('lst')

  function get (db, key) {
    return function (cb) { db.get(encode(key), cb) }
  }

  worklog(db, logDB)

  var validation = require('./validation')(db, opts)

  db.pre(function (op, add) {
    var msg = op.value
    // index by sequence number
    add({
      key: encode([msg.author, msg.sequence]), value: op.key,
      type: 'put', prefix: clockDB
    })
    // index the latest message from each author
    add({
      key: encode(msg.author), value: msg.sequence,
      type: 'put', prefix: lastDB
    })
  })

  db.getPublicKey = function (id, cb) {
    function cont (cb) {
      clockDB.get(encode([id, 1]), function (err, hash) {
      if(err) return cb(err)
       db.get(hash, function (err, msg) {
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
    validation.validate(msg, cb)
  }

  db.createFeedStream = function (id, opts) {
    opts = opts || {}
    opts.start = encode([id, 0])
    opts.end = encode([id, MAX_INT])
    opts.keys = false
    return pull(
      pl.read(clockDB, opts),
      paramap(function (key, cb) {
        db.get(key, cb)
      })
    )

  }

  return db
d}
