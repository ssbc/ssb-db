
var Blake2s = require('blake2s')
var crypto  = require('crypto')
var JSONB   = require('json-buffer')
var ecc     = require('eccjs')

var codec   = require('./codec')

var curve   = ecc.curves.k256

// this is all the developer specifiable things
// you need to give secure-scuttlebutt to get it to work.
// these should not be user-configurable, but it will
// be handy for forks to be able to use different
// crypto or encodings etc.

module.exports = {

  hash: function (data, enc) {
    return new Blake2s().update(data, enc).digest()
  },

  keys: {
    generate: function () {
      return ecc.restore(curve, crypto.randomBytes(32))
    },
    sign: function (pub, hash) {
      return ecc.sign(curve, pub, hash)
    },
    verify: function (pub, sig, hash) {
      return ecc.verify(curve, pub, sig, hash)
    },
    codec: {
      decode: function (private) {
        return ecc.restore(curve, private)
      },
      encode: function (keys) {
        return keys.private
      },
      //this makes this a valid level codec.
      buffer: true
    }
  },

  codec: codec

}

