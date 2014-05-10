var varstruct = require('varstruct')
var Blake2s = require('blake2s')
var ecc = require('eccjs')
var k256 = ecc.curves.k256
var pull = require('pull-stream')
var assert = require('assert')

var b2s = varstruct.buffer(32)
var signature = varstruct.buffer(64)


var type = varstruct.varbuf(varstruct.bound(varstruct.byte, 0, 32))

var unsigned_message = varstruct({
  previous  : b2s,
  author    : b2s,
  sequence  : varstruct.varint,
  type      : type,
  message   : varstruct.varbuf(varstruct.byte)
})

var message = varstruct({
  previous  : b2s,
  author    : b2s,
  sequence  : varstruct.varint,
  type      : type,
  message   : varstruct.varbuf(varstruct.byte),
  signature : signature
})


var keys = ecc.generate(ecc.curves.k256)

var zeros = new Buffer(32)
zeros.fill(0)

var ones = new Buffer(32)
ones.fill(255)

function bsum (value) {
  return new Blake2s().update(value).digest()
}

function validate(msg, keys) {
  msg = Buffer.isBuffer(msg) ? message.decode(msg) : msg
  process.assert(bsum(keys.public).toString('hex') === msg.author.toString('hex'), 'same author')
  return ecc.verify(k256, keys, msg.signature, bsum(unsigned_message.encode(msg)))
}

function feed (keys) {
  var feed = [], id = bsum(keys.public)

  function append (type, buffer, cb) {
    var last = feed[feed.length - 1]
    var msg = signMessage({
      previous: last ? bsum(message.encode(last)) : zeros,
      author  : bsum(keys.public),
      type    : type,
      sequence: feed.length,
      message : buffer
    }, keys)
    feed.push(msg)
    cb()
  }

  append(new Buffer('INIT'), keys.public, function () {})

  return {
    id: id,
    feed: feed,
    append: append,
    validate: function (cb) {
      var prev = zeros, seq = 0
      pull(
        pull.values(feed),
        pull.map(function (msg) {
          assert.deepEqual(msg.previous, prev)
          assert.deepEqual(msg.author, id)
          assert.equal(msg.sequence, seq)
          var hash = bsum(unsigned_message.encode(msg))
          if(!ecc.verify(k256, keys, msg.signature, hash))
            throw new Error('message was not validated by:' + id)
          prev = bsum(message.encode(msg))
          seq ++
          return true
        }),
        pull.drain(null, function (err) {
          //TODO: set the state to validate, and allow appending a message etc.
          cb(err, {previous: prev, sequence: seq})
        })
      )
    }
  }
}

function signMessage(msg, keys) {
  console.log(msg)
  msg.signature = ecc.sign(k256, keys, bsum(unsigned_message.encode(msg)))
  return msg
}


var f = feed(keys)

f.append(new Buffer('MESSAGE'), new Buffer('hello world!'), function () {})

f.validate(function (err, meta) {
  if(err) throw err
  console.log(meta)
})
