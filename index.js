var varstruct = require('varstruct')
var Blake2s = require('blake2s')
var ecc = require('eccjs')
var k256 = ecc.curves.k256
var pull = require('pull-stream')
var assert = require('assert')

var b2s = varstruct.buffer(32)
var signature = varstruct.buffer(64)


var type = varstruct.varbuf(varstruct.bound(varstruct.byte, 0, 32))

var UnsignedMessage = varstruct({
  previous  : b2s,
  author    : b2s,
  sequence  : varstruct.varint,
  type      : type,
  message   : varstruct.varbuf(varstruct.byte)
})

var Message = varstruct({
  previous  : b2s,
  author    : b2s,
  sequence  : varstruct.varint,
  type      : type,
  message   : varstruct.varbuf(varstruct.byte),
  signature : signature
})


var zeros = new Buffer(32)
zeros.fill(0)

function bsum (value) {
  return new Blake2s().update(value).digest()
}

function validate(msg, keys) {
  msg = Buffer.isBuffer(msg) ? message.decode(msg) : msg
  process.assert(bsum(keys.public).toString('hex') === msg.author.toString('hex'), 'same author')
  return ecc.verify(k256, keys, msg.signature, bsum(unsigned_message.encode(msg)))
}

function signMessage(msg, keys) {
  msg.signature = ecc.sign(k256, keys, bsum(UnsignedMessage.encode(msg)))
  return msg
}

function Feed (keys) {
  var feed = [], id = keys ? bsum(keys.public) : null

  function append (type, buffer, cb) {
    var last = feed[feed.length - 1]
    var msg = signMessage({
      previous: last ? bsum(Message.encode(last)) : zeros,
      author  : bsum(keys.public),
      type    : type,
      sequence: feed.length,
      message : buffer
    }, keys)
    feed.push(msg)
    cb(null, msg.sequence, bsum(Message.encode(msg)))
  }

  //if we have the private key, write an initial message.
  if(keys)
    append(new Buffer('INIT'), keys.public, function () {})

  var prev = zeros, seq = 0
  var f
  return f = {
    id: id,
    feed: feed,
    append: append,
    createReadStream: function (opts) {
      if(opts && !isNaN(opts.gt))
        return pull.values(feed.slice(opts.gt + 1))
      return pull.values(feed)
    },
    createWriteStream: function (cb) {
      return pull(pull.map(function (msg) {
          if(!keys) {
            keys = {public: msg.message}
            f.id = id = bsum(keys.public)
          } else
            seq ++

          assert.deepEqual(msg.author, id, 'unexpected author')
          assert.deepEqual(msg.previous, prev, 'messages out of order')
          assert.equal(msg.sequence, seq, 'sequence number is incorrect')

          var hash = bsum(UnsignedMessage.encode(msg))

          if(!ecc.verify(k256, keys, msg.signature, hash))
            throw new Error('message was not validated by:' + id)

          feed.push(msg)
          prev = bsum(Message.encode(msg))

          return true
        }),
        pull.drain(null, function (err) {
          cb(err, seq, prev)
        })
      )
    }
  }
}

//verify the signature, but not the sequence number or prev
Feed.verify = function (msg, keys) {
  var public = keys.public || keys
  var hash = bsum(UnsignedMessage.encode(msg))
  if(!ecc.verify(k256, keys, msg.signature, hash))
    throw new Error('message was not validated by:' + bsum(public))
  return true
}

module.exports = Feed
