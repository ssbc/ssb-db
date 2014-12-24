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

  function getLatest (id, cb) {
    var pub
    contpara([
      ssb.getPublicKey(id),
      get(lastDB, id)
    ])(function (err, results) {
      //get PUBLIC KEY out of FIRST MESSAGE.
      pub = err ? null : results[0]
      var expected = err ? 0 : results[1]
      if(!expected) {
        return cb(null, {message: null, key: pub, ready: true})
      }

      get(clockDB, [id, expected]) (function (err, key) {
        if(err) throw explain(err, 'this should never happen')
        get(ssb, key) (function (err, _prev) {
          if(err) throw explain(err, 'this should never happen')
          console.log('GET', _prev)
          cb(null, {message: _prev, key: pub, ready: true})
        })
      })
    })
  }

  var latest = {}, authors = {}

  var queue = [], batch = []

  function setLatest(id) {
    if(latest[id]) return
    latest[id] = {message: null, key: null, ready: false}
    getLatest(id, function (_, obj) {
      latest[id] = obj
      validate()
    })
  }

  var batch = [], writing = false

  function drain () {
    writing = true
    var _batch = batch
    batch = []
    ssb.batch(_batch, function () {
      writing = false
      if(batch.length) drain()
      _batch.forEach(function (op) {
        console.log('CB!!!!', op.value.sequence)
        op.cb(null, op.value, op.key)
      })
      validate()
    })
  }

  function write (op) {
    batch.push(op)
    console.log('write!!!', op.key)
    if(!writing) drain()
  }

  function validate() {
    if(!queue.length) return

    //for(var i = 0; i < queue.length; i++) {
      var next = queue[0]
      var id = next.value.author

      if(!latest[id]) setLatest(id)
      else if(latest[id].ready) {
        var op = queue.shift()
        var next = op.value
        var l = latest[id]
        var pub = l.key
        var prev = l.message && l.message.value

        if(!pub && !prev && next.content.type === 'init') {
          l.message = op
          l.key = next.content.public
          write(l.message)
        }
        else if(prev.sequence + 1 === next.sequence) {
          if(validateSync(next, prev, pub)) {
            write(latest[id].message = op)
          }
          else {
            op.cb(new Error(validateSync.reason))
          }
        }
        else if(prev.sequence >= next.sequence) {
          //console.log('drop', op.key)
          ssb.get(op.key, op.cb)
        } else
          throw new Error('should never happen - seq too high')
      }
    //}
  }

  function createValidator (id, done) {
    return function (msg, cb) {
      queue.push({
        key: hash(encode(msg)),
        value: msg, type: 'put', cb: cb
      })
      validate()
    }
  }

  var v
  return v = {
    validateSync: validateSync,
    getLatest: getLatest,
    validate: function (msg, cb) {

      var id = msg.author
      var validator = validators[id] =
        validators[id] || createValidator(id)

      return validator(msg, cb)
    }
  }
}
