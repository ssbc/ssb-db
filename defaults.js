var Blake2s = require('blake2s')
var crypto  = require('crypto')
var ecc     = require('eccjs')
var JSONH   = require('json-human-buffer')

var curve   = ecc.curves.k256

// this is all the developer specifiable things
// you need to give secure-scuttlebutt to get it to work.
// these should not be user-configurable, but it will
// be handy for forks to be able to use different
// crypto or encodings etc.

module.exports = {

  //this must return a buffer digest.
  hash: function (data, enc) {
    return new Blake2s().update(data, enc).digest()
  },

  isHash: function (data) {
    return Buffer.isBuffer(data) && data.length == 32
  },

  keys: {
    //this should return a key pair:
    // {public: Buffer, private: Buffer}

    generate: function () {
      return ecc.restore(curve, crypto.randomBytes(32))
    },

    //takes a public key and a hash and returns a signature.
    //(a signature must be a node buffer)
    sign: function (keys, hash) {
      return ecc.sign(curve, keys, hash)
    },

    //takes a public key, signature, and a hash
    //and returns true if the signature was valid.
    verify: function (pub, sig, hash) {
      return ecc.verify(curve, pub, sig, hash)
    },
  },

  // the codec that is used to persist into leveldb.
  // this is the codec that will be passed to levelup.
  // https://github.com/rvagg/node-levelup#custom_encodings
  codec: {
    decode: function (string) {
      return JSONH.parse(string)
    },
    encode: function (obj) {
      return JSONH.stringify(obj, null, 2)
    },
    buffer: false
  }
}

