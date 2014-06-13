var codec = require('./codec')

var db = require('level')(process.argv[2], {
    keyEncoding: codec, valueEncoding: codec
  })

db.createReadStream()
  .on('data', console.log)
