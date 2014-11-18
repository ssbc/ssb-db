
var tape = require('tape')
var hexpp = require('hexpp')

module.exports = function (opts) {

  tape('encode and sign a message', function (t) {

    var keys = opts.keys.generate()

    var message = {
      author: opts.hash(keys.public),
      previous: opts.hash(''),
      sequence: 5,
      timestamp: 1239435349,
      timezone: 120,
      content: {
        type: 'test',
        foo: {bar: {baz: true}}
      }
    }


    console.log('message', message)
    var buffer = opts.codec.encode(message)

    var sig = opts.keys.sign(keys, opts.hash(buffer))

    message.signature = sig

    var buffer_msg = opts.codec.encode(message)


    console.log(hexpp(buffer, {ascii: true}))
    console.log(hexpp(buffer_msg, {ascii: true}))

    console.log(opts.codec.decode(buffer))
    console.log(opts.codec.decode(buffer_msg))

    t.end()

  })


}


if(!module.parent)
  module.exports(require('../defaults'))
