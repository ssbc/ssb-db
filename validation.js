
var deepEqual = require('deep-equal')
var pull = require('pull-stream')

// make a validation stream?
// read the latest record in the database
// check it against the incoming data,
// and then read through

function clone (obj) {
  var o = {}
  for(var k in obj) o[k] = obj[k];
  return o
}

module.exports = function (db, opts) {

  var hash = opts.hash
  var empty = opts.hash(new Buffer(0))
  var zeros = new Buffer(empty.length)
  zeros.fill(0)

  var verify = opts.verify
  var encode = opts.encode

  var v
  return v = {
    validate: function (msg, prev, pub) {
      if(prev) {
        if(!deepEqual(msg.prev, hash(encode(prev)))
          && msg.sequence === prev.sequence + 1
          && msg.timestamp > prev.timestamp)
          return false
      }
      else {
        if(!deepEqual(msg.prev, zeros)
          && data.sequence === 1
          && data.timestamp > 0)
          return false
      }
      var _msg = clone(msg)
      delete _msg.signature
      return verify(pub, msg.signature, hash(encode(_msg)))
    },
    createValidateStream: function (db, id) {

      var latest = null, pub

      function getPub (cb) {
        if(pub) cb(null, pub)
        else db.getPublicKey(id, cb)
      }

      function getLatest (cb) {
        if(latest === null) {
          db.sublevel('lst').get(id, function (err, seq) {
            if(err) return cb(err)
            db.get([id, seq], function (err, hash) {
              if(err) return cb(err)
              db.get(hash, function (err, msg) {
                latest = msg
                cb(err, msg, hash)
              })
            })
          })
        }
        else {
          cb(null, msg)
        }
      }

      return pull(
        pull.mapAsync(function (data, cb) {
          getLatest(function (err, prev, hash, pub) {
            //assert that data comes after prev

            if(data.sequence === 1) {
              assert.ok(err)
              assert.equal(data.sequence, 1)
            }
            else {
            }

            latest = data
            db.put(hash(opts.encode(latest)), latest)
          })

        }),
        pull.drain()
      )

    }
  }
}
