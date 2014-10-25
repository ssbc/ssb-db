var svarint   = require('signed-varint')
var varstruct = require('varstruct')
var varmatch  = require('varstruct-match')
var assert    = require('assert')
var b2s       = varstruct.buffer(32)
var signature = varstruct.buffer(64)
var type      = varstruct.varbuf(varstruct.bound(varstruct.byte, 0, 32))

var msgpack   = require('msgpack-js')
var hexpp     = require('hexpp')

var content = varstruct.varbuf(varstruct.bound(varstruct.varint, 0, 1024))

var codec = exports = module.exports =
  varmatch(varstruct.byte)
//matches added at bottom of this file.

var Message = varstruct({
  previous  : b2s,
  author    : b2s,
  timestamp : varstruct.varint,
  sequence  : varstruct.varint,
  content   : content
})

var Ephemeral = varstruct({
  author    : b2s,
  sequence  : varstruct.varint,
  ephemseq  : varstruct.varint,
  timestamp : varstruct.varint,
  content   : content
})

var _Signed = varstruct({
  value: codec,
  signature: signature
})

function clone (a) {
  var b = {}
  for(var k in a)
    b[k] = a[k]
  return b
}

var Signed = {
  encode: function encode (_value, b, o) {
    var value = clone(_value)
    var sig = value.signature
    delete value.signature
    var r = _Signed.encode({value: value, signature: sig}, b, o)
    encode.bytes = _Signed.encode.bytes
    return r
  },
  decode: function decode (b, o) {
    var v = _Signed.decode(b, o)
    v.value.signature = v.signature
    decode.bytes = _Signed.decode.bytes
    return v.value
  },
  encodingLength: function (value) {
    value = clone(value)
    var len = value.signature.length
    delete value.signature
    return codec.encodingLength(value) + len
  }
}

function clone (v) {
  var o = {}
  for(var k in v)
    o[k] = v[k]
  return o
}

function msgpackify (codec) {

  var _encode = codec.encode
  var _decode = codec.decode
  function encode (value, b, o) {
    value = clone(value)
    value.content = msgpack.encode(value.content)
    var r = _encode(value, b, o)
    encode.bytes = _encode.bytes
    return r
  }

  return {
    encode: encode,

    decode: function decode (b, o) {
      var value = _decode(b, o)
      value.content = msgpack.decode(value.content)
      decode.bytes = _decode.bytes
      return value
    },
    encodingLength: function (value) {
      return encode(value).length
    }
  }
  return codec
}

Message = msgpackify(Message)
Ephemeral = msgpackify(Ephemeral)

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
  encode.bytes = decode.bytes = length
  return {
    encode: encode,
    decode: decode,
    length: length
  }
}

var Key = varstruct({
  id: b2s,
  sequence: varstruct.UInt64
})

var LatestKey = b2s

function isInteger (n) {
  return 'number' === typeof n && Math.round(n) === n
}

function isHash(b) {
  return Buffer.isBuffer(b) && b.length == 32
}

var Okay =
  fixed(varstruct.buffer(4), new Buffer('okay'), {okay: true})

codec
  .type(0, Signed, function (t) {
    return t.signature
  })
  .type(10, Message, function (t) {
    return isHash(t.previous) && isHash(t.author)
  })
  .type(100, Key, function (t) {
    return isHash(t.id) && isInteger(t.sequence)
  })
  .type(120, LatestKey, isHash)
  .type(130, varstruct.varint, isInteger)
  .type(140, Okay, function (b) {
    return b && b.okay
  })

exports.Message = Message
exports.Ephemeral = Ephemeral
exports.Signed = Signed

exports.Key = Key

exports.buffer = true
exports.type = 'secure-scuttlebutt-codec'

