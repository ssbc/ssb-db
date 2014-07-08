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

module.exports = function (opts) {

  var validation = require('../validation')(null, opts)

  var empty = opts.hash(new Buffer(0))
  var zeros = new Buffer(empty.length)
  zeros.fill(0)


  // encode, hash, sign, verify
  tape('simple', function (t) {

    var keys = opts.generate()

    var msg = {
      prev: zeros,
      sequence: 1,
      message: keys.public,
      type: new Buffer('INIT', 'utf8')
    }

    var encoded = opts.encode(msg)
    var hash = opts.hash(encoded)
    console.log(hash, encoded)
    var sig = opts.sign(keys, hash)

    opts.verify(keys, sig, hash)

    for(var i = 0; i < 3; i++) {
      t.notOk(opts.verify(keys, flipRandomBit(sig), hash))
      t.notOk(opts.verify(keys, sig, flipRandomBit(hash)))

      var _keys = opts.generate()
      t.notOk(opts.verify(_keys, sig, hash))
    }
    t.end()
  })

  // validate a message

  function sign (msg, keys) {

    msg.signature =
      opts.sign(keys, opts.hash(opts.encode(msg)))

    return msg
  }

  tape('validate message', function (t) {

    var keys = opts.generate()

    var msg = sign({
      prev: zeros,
      sequence: 1,
      message: keys.public,
      type: new Buffer('INIT', 'utf8')
    }, keys)

    var msg2 = sign({
      prev: opts.hash(opts.encode(msg)),
      sequence: 2,
      message: new Buffer('hello'),
      type: new Buffer('INIT', 'utf8')
    }, keys)

    //should this throw?
    t.ok(validation.validate(msg, null, keys))
    t.ok(validation.validate(msg2, msg, keys))

    t.end()

  })

}

if(!module.parent)
  module.exports(require('../defaults'))

