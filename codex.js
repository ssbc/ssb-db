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

exports.Key = varstruct({
  id: b2s,
  sequence: varstruct.UInt64
})

