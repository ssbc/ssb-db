
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

  //this must return a buffer digest.
  hash: function (data, enc) {
    return new Blake2s().update(data, enc).digest()
  },

  keys: {
    //this should return a key pair:
    // {public: Buffer, private: Buffer}

    generate: function () {
      return ecc.restore(curve, crypto.randomBytes(32))
    },
    //takes a public key and a hash and returns a signature.
    //(a signature must be a node buffer)
    sign: function (pub, hash) {
      return ecc.sign(curve, pub, hash)
    },

    //takes a public key, signature, and a hash
    //and returns true if the signature was valid.
    verify: function (pub, sig, hash) {
      return ecc.verify(curve, pub, sig, hash)
    },

    //codec for keys. this handles serializing
    //and deserializing keys for storage.
    //in elliptic curves, the public key can be
    //regenerated from the private key, so you only
    //need to serialize the private key.
    //in RSA, you need to remember both public and private keys.

    //maybe it's a good idea to add checksums and stuff
    //so that you can tell that this is a valid key when
    //read off the disk?
    codec: {
      decode: function (buffer) {
        return ecc.restore(curve, buffer)
      },
      encode: function (keys) {
        return keys.private
      },
      //this makes this a valid level codec.
      buffer: true
    }
  },

  // the codec that is used to persist into leveldb.
  // this is the codec that will be passed to levelup.
  // https://github.com/rvagg/node-levelup#custom_encodings
  codec: codec
}

