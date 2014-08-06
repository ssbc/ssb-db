var tape = require('tape')
var defaults = require('../defaults')

function copy (buf) {
  var _buf = new Buffer(buf.length)
  buf.copy(_buf)
  return _buf
}

function randint (n) {
  return ~~(Math.random()*n)
}

function flipRandomBit(buf) {
    buf = copy(buf)
    var r = randint(buf.length)
    //change one bit
    buf[r] = buf[r] ^ (1 << randint(7))
    return buf
}

function clone (obj) {
  var o = {}
  for(var k in obj) o[k] = obj[k]
  return o
}

function noop () {}

module.exports = function (opts) {

  var validation = require('../validation')({sublevel: noop}, opts)
  var create = require('../message')(opts)

  var empty = opts.hash(new Buffer(0))
  var zeros = new Buffer(empty.length)
  zeros.fill(0)


  // encode, hash, sign, verify
  tape('simple', function (t) {

    var keys = opts.keys.generate()

    var msg = create(keys, 'init', keys.public)

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

  // validate a message

  tape('validate message', function (t) {

    var keys = opts.keys.generate()

    var msg = create(keys, 
      'init',      //type
      keys.public, //message
      null         //previous
    )

    var msg2 = create(keys, 'msg', 'hello', msg)

    console.log(msg)
    console.log(msg2)

    //should this throw?
    t.ok(validation.validateSync(msg, null, keys))
    t.ok(validation.validateSync(msg2, msg, keys))

    for(var i = 0; i < 10; i++) {

      var _msg
      _msg = clone(msg2)
      _msg.signature = flipRandomBit(_msg.signature)
      t.notOk(validation.validateSync(_msg, msg, keys))

      _msg = clone(msg2)
      _msg.previous = flipRandomBit(_msg.previous)
      _msg = create.sign(_msg, keys)
      t.notOk(validation.validateSync(_msg, msg, keys))

      _msg = clone(msg2)
      _msg.author = flipRandomBit(_msg.author)
      _msg = create.sign(_msg, keys)
      t.notOk(validation.validateSync(_msg, msg, keys))
    }

    t.end()
  })

}

if(!module.parent)
  module.exports(require('../defaults'))
