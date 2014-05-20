var svarint = require('signed-varint')
var varstruct = require('varstruct')
var assert = require('assert')
var b2s = varstruct.buffer(32)
var signature = varstruct.buffer(64)
var type = varstruct.varbuf(varstruct.bound(varstruct.byte, 0, 32))
var content = varstruct.varbuf(varstruct.bound(varstruct.varint, 0, 1024))

exports.UnsignedMessage = varstruct({
  previous  : b2s,
  author    : b2s,
  timestamp : varstruct.varint,
  timezone  : svarint,
  sequence  : varstruct.varint,
  type      : type,
  message   : content
})

exports.Message = varstruct({
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

exports.Key = varstruct({
  magic: prefix(1),
  id: b2s,
  sequence: varstruct.UInt64
})

exports.FeedKey = varstruct({
  magic: prefix(2),
  timestamp: varstruct.UInt64,
  hash: b2s
})

exports.LatestKey = varstruct({
  magic: prefix(3),
  id: b2s
})

exports.Broadcast = varstruct({
  magic: fixed(varstruct.buffer(4), new Buffer('SCBT')),
  id: b2s,
  //don't use varints, so that the same buffer can be reused over and over.
  port: varstruct.UInt32,
  timestamp: varstruct.UInt64

})
