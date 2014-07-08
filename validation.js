
var deepEqual = require('deep-equal')
var pull = require('pull-stream')
var contpara = require('continuable-para')
var bytewise = require('bytewise/hex').encode

// make a validation stream?
// read the latest record in the database
// check it against the incoming data,
// and then read through

function clone (obj) {
  var o = {}
  for(var k in obj) o[k] = obj[k];
  return o
}

function get (db, key) {
  return function (cb) {
    return db.get(bytewise(key), cb)
  }
}

module.exports = function (ssb, opts) {


  var lastDB = ssb.sublevel('lst')
  var hash = opts.hash
  var zeros = opts.hash(new Buffer(0))
      zeros.fill(0)

  var verify = opts.verify
  var encode = opts.encode

  var validators = {}

  function validateSync (msg, prev, pub) {
    if(prev) {
      if(!deepEqual(msg.prev, hash(encode(prev)))
        && msg.sequence === prev.sequence + 1
        && msg.timestamp > prev.timestamp)
        return false
    }
    else {
      if(!deepEqual(msg.prev, zeros)
        && msg.sequence === 1
        && msg.timestamp > 0)
        return false
    }
    if(!deepEqual(msg.author, hash(pub.public || pub)))
      return false

    var _msg = clone(msg)
    delete _msg.signature
    return verify(pub, msg.signature, hash(encode(_msg)))
  }

  function createValidator (id) {

    var queue = [], batch = [], prev, pubKey, cbs = []

    return function (msg, cb) {

      // INIT: retrive the latest message for the given id.
      // when not in INIT state, queue any new messages.
      // DRAIN: validate all queued messages.
      // writes all valid message.
      // after writing, if there are more queued queued messages
      // goto DRAIN

      if(!queue.length && !batch.length) {
        queue.push({msg: msg, cb: cb})

        contpara(
          get(ssb, msg.prev),
          ssb.getPublicKey(msg.author),
          get(lastDB, msg.author)
        )(function (err, results) {
          prev = err ? null : results[0]
          //get PUBLIC KEY out of FIRST MESSAGE.
          pub = err ? msg.message : results[1]

          var expected = err ? 1 : results[2] + 1
          if(expected !== msg.sequence)
            return cb(
              new Error('sequence out of order, expected:'
                + expected + ' got: ' + msg.sequence)
            )

          drain()
        })

      }
      else
        queue.push({msg: msg, cb: cb})
    }

    function drain () {
      while(queue.length) {
        var e = queue.shift()
        cbs.push(e.cb)

        if(validateSync(e.msg, prev, pub)) {
          batch.push({
            key: bytewise(hash(encode(e.msg))), value: e.msg, type: 'put'
          })
          prev = e.msg
        }
        else
          cb(new Error('invalid message:' + hash(encode(e.msg))))
      }

      ssb.batch(batch, function (err) {
        batch = []; while(cbs.length) cbs.shift()(err)
        if(queue.length) drain()
        else delete validators[id.toString('base64')]
      })
    }
  }

  var v
  return v = {
    validateSync: validateSync,
    validate: function (msg, cb) {

      var id = msg.author
      var ids = id.toString('base64')
      var validator = validators[ids] =
        validators[ids] || createValidator(id)

      return validator(msg, cb)
    }
  }
}
