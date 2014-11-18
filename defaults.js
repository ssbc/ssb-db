var Blake2s = require('blake2s')
var crypto  = require('crypto')
var ecc     = require('eccjs')

var curve   = ecc.curves.k256

// this is all the developer specifiable things
// you need to give secure-scuttlebutt to get it to work.
// these should not be user-configurable, but it will
// be handy for forks to be able to use different
// crypto or encodings etc.

function isString(s) {
  return 'string' === typeof s
}
function isHash (data) {
  return isString(data) && /^[A-Za-z0-9\/+]{43}=\.blake2s$/.test(data)
}

function tag (key, tag) {
  return key.toString('base64')+'.' + tag
}

function toBuffer(buf) {
  if(buf == null) return buf
  return new Buffer(buf.substring(0, buf.indexOf('.')), 'base64')
}

function hashToBuffer(hash) {
  if(!isHash(hash)) throw new Error('sign expects a hash')
  return toBuffer(hash)
}

function keysToBuffer(key) {
  return isString(key) ? toBuffer(key) : {
    public: toBuffer(key.public),
    private: toBuffer(key.private)
  }
}

module.exports = {

  //this must return a buffer digest.
  hash: function (data, enc) {
    return new Blake2s().update(data, enc).digest('base64') + '.blake2s'
  },

  isHash: isHash,

  keys: {
    //this should return a key pair:
    // {public: Buffer, private: Buffer}

    generate: function () {
      var d = ecc.restore(curve, crypto.randomBytes(32))
      return {
        public: tag(d.public, 'k256'),
        private: tag(d.private, 'k256')
      }
    },

    //takes a public key and a hash and returns a signature.
    //(a signature must be a node buffer)
    sign: function (keys, hash) {
      return tag(
        ecc.sign(curve, keysToBuffer(keys), hashToBuffer(hash)),
        'blake2s.k256'
      )
    },

    //takes a public key, signature, and a hash
    //and returns true if the signature was valid.
    verify: function (pub, sig, hash) {
      return ecc.verify(curve, keysToBuffer(pub), toBuffer(sig), hashToBuffer(hash))
    },
  },

  // the codec that is used to persist into leveldb.
  // this is the codec that will be passed to levelup.
  // https://github.com/rvagg/node-levelup#custom_encodings
  codec: {
    decode: function (string) {
      return JSON.parse(string)
    },
    encode: function (obj) {
      return JSON.stringify(obj, null, 2)
    },
    buffer: false
  }
}

