'use strict';

var deepEqual = require('deep-equal')
var pull = require('pull-stream')
var pushable = require('pull-pushable')

var contpara = require('cont').para
var explain = require('explain-error')
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
    return db.get(key, cb)
  }
}

function isString (s) {
  return 'string' === typeof s
}

module.exports = function (ssb, opts) {

  var lastDB = ssb.sublevel('lst')
  var clockDB = ssb.sublevel('clk')
  var hash = opts.hash
  var zeros = undefined
      //opts.hash(new Buffer(0))
      //zeros.fill(0)

  var verify = opts.keys.verify
  var encode = opts.codec.encode

  var validators = {}

  function validateSync (msg, prev, pub) {
    var type = msg.content.type
    if(!isString(type)) {
      validateSync.reason = 'type property must be string'
      return false
    }

    if(52 < type.length || type.length < 3) {
      validateSync.reason = 'type must be 3 < length <= 52, but was:' + type.length
      return false
    }

    if(prev) {
      if(!deepEqual(msg.previous, hash(encode(prev)))) {

        validateSync.reason = 'expected previous: '
          + hash(encode(prev)).toString('base64')

        return false
      }
      if(msg.sequence === prev.sequence + 1
        && msg.timestamp < prev.timestamp) {

          validateSync.reason = 'out of order'

          return false
      }
    }
    else {
      if(!(msg.previous == null
        && msg.sequence === 1 && msg.timestamp > 0)) {

          validateSync.reason = 'expected initial message'

          return false
      }
    }

    if(!deepEqual(msg.author, hash(pub.public || pub))) {

      validateSync.reason = 'expected different author:'+
        hash(pub.public || pub).toString('base64') +
        'but found:' +
        msg.author.toString('base64')

      return false
    }

    var _msg = clone(msg)
    delete _msg.signature
    if(!verify(pub, msg.signature, hash(encode(_msg)))) {

      validateSync.reason = 'signature was invalid'

      return false
    }
    validateSync.reason = ''
    return true
  }

  function createValidator (id, done) {

    var queue = [], batch = [], prev = null, pub, cbs = []
    var ready = false, init = false

    var queue = pushable()

    contpara(
      ssb.getPublicKey(id),
      get(lastDB, id)
    )(function (err, results) {
      //get PUBLIC KEY out of FIRST MESSAGE.
      pub = err ? null : results[1]
      var expected = err ? 0 : results[2]
      if(!expected) {
        ready = true
        return validate()
      }

      get(clockDB, [id, expected]) (function (err, _prev) {
        if(err) throw explain(err, 'this should never happen')
        prev = _prev
        validate()
      })
    })

    var recent = {}

    function validate() {
      pull(
        queue,
        pull.asyncMap(function (op, cb) {
          if(pub == null) pub = op.value.content.public

          if(recent[op.key]) cb()
          else if(prev && op.value.sequence <= prev.sequence) {
            clockDB.get([id, op.value.sequence], function (err, _key) {
              if(_key === op.key) {
                //we already have this msg, just drop it.
                op.cb(null, op.value, op.key); cb()
              }
              else {
                //looks like a private key has been compromized.
                err = explain(err,
                  'private key for:' + id +
                  ' has been compromized'
                )

                op.cb(err); cb(err)
              }
            })
          }
          else cb(null, op)
        }),
        pull.filter(Boolean),
        pull.asyncMap(function (op, cb) {
          if(validateSync(op.value, prev, pub)) {
            recent[op.key] = true
            prev = op.value
            cb(null, op)
          } else {
            var err = new Error(validateSync.reason)
            op.cb(err); cb(err)
          }
        }),
        pull.through(function (op) {
          console.log(op.key.substring(0, 4), op.value.sequence)
        }),
//TODO make batches work correctly with pull-window.
//this seems to break because of
//it doesn't always group correctly.
//        pw.recent(10, 100),
        pull.map(function (op) {
          return [op]
        }),
        pull.asyncMap(function (ops, cb) {
          ssb.batch(ops, function (err) {
            ops.forEach(function (op) {
              delete recent[op.key]
              op.cb(err, op.value, op.key)
            })
            cb(null, ops)
          })
        }),
        pull.drain(null, done)
      )
    }

    return function (msg, cb) {
      queue.push({
        key: hash(encode(msg)),
        value: msg, type: 'put', cb: cb
      })
    }

  }

  var v
  return v = {
    validateSync: validateSync,
    validate: function (msg, cb) {

      var id = msg.author
      var validator = validators[id] =
        validators[id] || createValidator(id)

      return validator(msg, cb)
    }
  }
}
