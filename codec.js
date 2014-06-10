var svarint = require('signed-varint')
var varstruct = require('varstruct')
var varmatch = require('varstruct-match')
var assert = require('assert')
var b2s = varstruct.buffer(32)
var signature = varstruct.buffer(64)
var type = varstruct.varbuf(varstruct.bound(varstruct.byte, 0, 32))
var content = varstruct.varbuf(varstruct.bound(varstruct.varint, 0, 1024))

var UnsignedMessage = varstruct({
  previous  : b2s,
  author    : b2s,
  timestamp : varstruct.varint,
  timezone  : svarint,
  sequence  : varstruct.varint,
  type      : type,
  message   : content
})

var Message = varstruct({
  previous  : b2s,
  author    : b2s,
  sequence  : varstruct.varint,
  timestamp : varstruct.varint,
  timezone  : svarint,
  type      : type,
  message   : content,
  signature : signature
})

function fixed(codec, value) {
  function encode (v,b,o) {
    return codec.encode(value,b,o)
  }
  function decode (b,o) {
    var v = codec.decode(b,o)
    assert.deepEqual(v, value)
    return v
  }
  var length = codec.length || codec.encodingLength(value)
  encode.bytesWritten = decode.bytesRead = length
  return {
    encode: encode,
    decode: decode,
    length: length
  }
}

function prefix (value) {
  return fixed(varstruct.byte, value)
}


var Key = varstruct({
  id: b2s,
  sequence: varstruct.UInt64
})

var FeedKey = varstruct({
  timestamp: varstruct.UInt64,
  id: b2s
})

var LatestKey = b2s

exports.Broadcast = varstruct({
  magic: fixed(varstruct.buffer(4), new Buffer('SCBT')),
  id: b2s,
  //don't use varints, so that the same buffer can be reused over and over.
  port: varstruct.UInt32,
  timestamp: varstruct.UInt64

})

function isInteger (n) {
  return 'number' === typeof n && Math.round(n) === n
}

function isHash(b) {
  return Buffer.isBuffer(b) && b.length == 32
}

exports = module.exports =
  varmatch(varstruct.varint)
  .type(0, Message, function (t) {
    return isHash(t.previous) && isHash(t.author)
  })
  .type(1, Key, function (t) {
    return isHash(t.id) && isInteger(t.sequence)
  })
  .type(2, FeedKey, function (t) {
    return isHash(t.id) && isInteger(t.timestamp)
  })
  .type(3, LatestKey, isHash)
  .type(4, varstruct.varint, isInteger)

exports.UnsignedMessage = UnsignedMessage
exports.Message = Message
exports.Key = Key
exports.FeedKey = FeedKey

exports.buffer = true

