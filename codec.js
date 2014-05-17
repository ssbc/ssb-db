var svarint = require('signed-varint')
var varstruct = require('varstruct')

var b2s = varstruct.buffer(32)
var signature = varstruct.buffer(64)
var type = varstruct.varbuf(varstruct.bound(varstruct.byte, 0, 32))

exports.UnsignedMessage = varstruct({
  previous  : b2s,
  author    : b2s,
  timestamp : varstruct.varint,
  timezone  : svarint,
  sequence  : varstruct.varint,
  type      : type,
  message   : varstruct.varbuf(varstruct.byte)
})

exports.Message = varstruct({
  previous  : b2s,
  author    : b2s,
  sequence  : varstruct.varint,
  timestamp : varstruct.varint,
  timezone  : svarint,
  type      : type,
  message   : varstruct.varbuf(varstruct.byte),
  signature : signature
})

function prefix (value) {
  function encode (v,b,o) {
    return varstruct.byte.encode(value,b,o)
  }
  function decode (v,b,o) {
    return varstruct.byte.decode(value,b,o)
  }
  encode.bytesWritten = decode.bytesRead = 1
  return {
    encode: encode,
    decode: decode,
    length: 1
  }
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
