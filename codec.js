var svarint   = require('signed-varint')
var varstruct = require('varstruct')
var varmatch  = require('varstruct-match')
var assert    = require('assert')
var b2s       = varstruct.buffer(32)
var signature = varstruct.buffer(64)
var type      = varstruct.varbuf(varstruct.bound(varstruct.byte, 0, 32))

var content = varstruct.varbuf(varstruct.bound(varstruct.varint, 0, 1024))

//TODO, make a thing so that the total length of the
//message + the references is <= 1024

var References = varstruct.vararray(
                    varstruct.bound(varstruct.varint, 0, 1024),
                  varstruct.buffer(32))

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

function fixed(codec, encodeAs, decodeAs) {
  function encode (v,b,o) {
    return codec.encode(encodeAs,b,o)
  }
  function decode (b,o) {
    var v = codec.decode(b,o)
    assert.deepEqual(v, encodeAs)
    return decodeAs || v
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

var Broadcast = varstruct({
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

var TypeIndex = varstruct({
  type: varstruct.buffer(32),
  id: b2s,
  sequence: varstruct.UInt64
})

var ReferenceIndex = varstruct({
  type: varstruct.buffer(32),
  id: b2s,
  reference: varstruct.buffer(32),
  sequence: varstruct.UInt64
})

var ReferencedIndex = varstruct({
  referenced: varstruct.buffer(32),
  type: varstruct.buffer(32),
  id: b2s,
  sequence: varstruct.UInt64
})

var Okay =
  fixed(varstruct.buffer(4), new Buffer('okay'), {okay: true})

exports = module.exports =
  varmatch(varstruct.varint)
  .type(0, Message, function (t) {
    return isHash(t.previous) && isHash(t.author) && t.signature
  })
  .type(0, UnsignedMessage, function (t) {
    return isHash(t.previous) && isHash(t.author) && !t.signature
  })
  .type(1, Key, function (t) {
    return isHash(t.id) && isInteger(t.sequence) && !Buffer.isBuffer(t.type)
  })
  .type(2, FeedKey, function (t) {
    return isHash(t.id) && isInteger(t.timestamp)
  })
  .type(3, LatestKey, isHash)
  .type(4, varstruct.varint, isInteger)
  .type(5, Okay, function (b) {
    return b && b.okay
  })

exports.UnsignedMessage = UnsignedMessage
exports.Message = Message
exports.Key = Key
exports.FeedKey = FeedKey
exports.Broadcast = Broadcast
exports.TypeIndex = TypeIndex
exports.ReferenceIndex = ReferenceIndex
exports.ReferencedIndex = ReferencedIndex

exports.buffer = true


