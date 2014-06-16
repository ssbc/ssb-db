

var secret = require('../secret')
var tape = require('tape')

tape('encode/decode secret', function (t) {

  var keys = secret.generate()

  var string = secret.encode(keys)

  t.equal(typeof string, 'string')

  t.deepEquals(secret.decode(string), keys)

  t.end()

})
