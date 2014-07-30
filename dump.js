var codec = require('./codec')
var bytewise = require('bytewise/hex')

var db = require('level')(process.argv[2], {
    keyEncoding: 'utf8', valueEncoding: codec
  })

function decodeKey (key) {
  key = key.split('\xff').filter(Boolean)
  var _key = key.pop()
  return [key, bytewise.decode(_key)]
}

db.createReadStream()
  .on('data', function (op) {
    console.log({key:decodeKey(op.key), value: op.value})
  })
