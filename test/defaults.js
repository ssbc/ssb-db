var tape = require('tape')
var defaults = require('../defaults')

function isString(s) {
  return 'string' === typeof s
}

function isHash (data) {
  return isString(data) && /^[A-Za-z0-9\/+]{43}=\.blake2s$/.test(data)
}

function randint (n) {
  return ~~(Math.random()*n)
}

function flipRandomBit(buf) {
    var i = buf.indexOf('.')

    var _buf = new Buffer(buf.substring(0, i), 'base64')
    var r = randint(_buf.length)
    //change one bit
    _buf[r] = _buf[r] ^ (1 << randint(7))

    return _buf.toString('base64') + buf.substring(i)
}

function clone (obj) {
  var o = {}
  for(var k in obj) o[k] = obj[k]
  return o
}

function noop () {}

function b(s) {
  return s
}
var create = require('ssb-feed/util').create

module.exports = function (opts) {

//  var validation = require('../validation')({sublevel: noop}, opts)

  var empty = opts.hash(new Buffer(0))

  tape('encode/decode', function (t) {
    var keys = opts.keys.generate()

    var msg = create(keys, b('init'), 'hello there!')
    var encoded = opts.codec.encode(msg)
    var _msg = opts.codec.decode(encoded)
    t.deepEqual(_msg, msg)
    t.end()
  })

  // encode, hash, sign, verify
  tape('simple', function (t) {

    var keys = opts.keys.generate()

    var msg = create(keys, b('init'), keys.public)

    var encoded = opts.codec.encode(msg)
    var hash = opts.hash(encoded)
    var sig = opts.keys.sign(keys, hash)

    opts.keys.verify(keys, sig, hash)

    for(var i = 0; i < 3; i++) {
      t.notOk(opts.keys.verify(keys, flipRandomBit(sig), hash))
      t.notOk(opts.keys.verify(keys, sig, flipRandomBit(hash)))

      var _keys = opts.keys.generate()
      t.notOk(opts.keys.verify(_keys, sig, hash))
    }
    t.end()
  })


}

if(!module.parent)
  module.exports(require('../defaults'))
