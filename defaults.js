
var Blake2s = require('blake2s')
var crypto  = require('crypto')
var JSONB   = require('json-buffer')
var ecc     = require('eccjs')

var codec   = require('./codec')

var curve   = ecc.curves.k256

exports.hash = function (data) {
  return new Blake2s().update(data).digest()
}

exports.generate = function () {
  return ecc.restore(curve, crypto.randomBytes(32))
}

exports.restore = function (private) {
  return ecc.restore(curve, private)
}

exports.serializeKeys = function (keys) {
  return keys.private
}

exports.verify = function (pub, sig, hash) {
  return ecc.verify(curve, pub, sig, hash)
}

exports.sign = function (pub, hash) {
  return ecc.sign(curve, pub, hash)
}

exports.encode = codec.encode
exports.decode = codec.decode
exports.buffer = true

//exports.encode = function (data) {
//  return JSONB.stringify(data)
//}
//
//exports.decode = function (data) {
//  return JSONB.parse(data)
//}


