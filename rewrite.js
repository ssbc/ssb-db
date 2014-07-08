var worklog = require('level-worklog')
var contpara = require('continuable-para')

module.exports = function (db, opts) {

  console.log(db)

  var logDB = db.sublevel('log')
  var clockDB = db.sublevel('clk')
  var lastDB = db.sublevel('lst')

  function get (db, key) {
    return function (cb) { db.get(key, cb) }
  }

  worklog(db, logDB)

  db.pre(function (op, add) {
    var msg = op.value
    // index by sequence number
    add({
      key: [msg.author, msg.sequence], value: op.key,
      type: 'put', prefix: clockDB
    })
    // index the latest message from each author
    add({
      key: msg.author, value: msg.sequence,
      type: 'put', prefix: lastDB
    })
  })

  db.getPublicKey = function (id, cb) {
    clockDb.get([id, 1], function (err, msg) {
      //parse the message?
      cb(null, opts.message.decode)
    })

  }

  db.getPublicKey = function (id, cb) {
    function cont (cb) {
      lastDB.get([id, 1], function (err, hash) {
        db.get(hash, function (msg) {
          cb(null, msg.message)
        })
      })
    }
    return cb ? cont(cb) : cont
  }

  db.add = function (msg, cb) {

    //check that msg is valid (follows from end of database)
    //then insert into database.


  }

  return db
}
