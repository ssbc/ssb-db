var svarint   = require('signed-varint')
var varstruct = require('varstruct')
var varmatch  = require('varstruct-match')
var assert    = require('assert')
var b2s       = varstruct.buffer(32)
var signature = varstruct.buffer(64)
var type      = varstruct.varbuf(varstruct.bound(varstruct.byte, 0, 32))

var msgpack   = require('msgpack-js')

var content = varstruct.varbuf(varstruct.bound(varstruct.varint, 0, 1024))

//TODO, make a thing so that the total length of the
//message + the references is <= 1024

var codec = exports = module.exports =
  varmatch(varstruct.varint)
//matches added at bottom of this file.

var References = varstruct.vararray(
                    varstruct.bound(varstruct.varint, 0, 1024),
                  varstruct.buffer(32))

var Message = varstruct({
  previous  : b2s,
  author    : b2s,
  timestamp : varstruct.varint,
  timezone  : svarint,
  sequence  : varstruct.varint,
  type      : type,
  message   : content
})

var Ephemeral = varstruct({
  author    : b2s,
  sequence  : varstruct.varint,
  ephemseq  : varstruct.varint,
  timestamp : varstruct.varint,
  timezone  : svarint,
  type      : type,
  message   : content
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
  encode: function encode (value, b, o) {
    var _value = clone(value)
    var sig = value.signature
    delete _value.signature
    var r = _Signed.encode({value: _value, signature: sig}, b, o)
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

//var Signed = varstruct({
//  value: codec,
//  signature: signature
//})
//
//{
//  encode: function (value, buffer, offset) {
//    var signature = value.signature
//    value.signature = null
//    return _Signed.encode({
//      value:
//        exports.encode(value, buffer, offset),
//      signature: signature
//    }, buffer, offset)
//  },
//  decode: function (buffer, offset) {
//
//    return _Signed
//  }
//}

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
    value.message = msgpack.encode(value.message)
    var r = _encode(value, b, o)
    encode.bytes = _encode.bytes
    return r
  }

  return {
    encode: encode,

    decode: function decode (b, o) {
      var value = _decode(b, o)
      value.message = msgpack.decode(value.message)
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
//UnsignedMessage = msgpackify(Message)


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
  encode.bytes = decode.bytes = length
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

codec
  .type(0, Signed, function (t) {
    return t.signature
  })
  .type(10, Message, function (t) {
    return isHash(t.previous) && isHash(t.author)// && t.signature
  })
//  .type(0, UnsignedMessage, function (t) {
//    return isHash(t.previous) && isHash(t.author) && !t.signature
//  })
  .type(100, Key, function (t) {
    return isHash(t.id) && isInteger(t.sequence) && !Buffer.isBuffer(t.type)
  })
  .type(110, FeedKey, function (t) {
    return isHash(t.id) && isInteger(t.timestamp)
  })
  .type(120, LatestKey, isHash)
  .type(130, varstruct.varint, isInteger)
  .type(140, Okay, function (b) {
    return b && b.okay
  })

//exports.UnsignedMessage = UnsignedMessage
exports.Message = Message
exports.Ephemeral = Ephemeral
exports.Signed = Signed
exports.Broadcast = Broadcast

exports.Key = Key
exports.FeedKey = FeedKey
exports.TypeIndex = TypeIndex
exports.ReferenceIndex = ReferenceIndex
exports.ReferencedIndex = ReferencedIndex

exports.buffer = true
exports.type = 'secure-scuttlebutt-codec'

