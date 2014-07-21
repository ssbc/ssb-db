var codec = require('./codec')

var db = require('level')(process.argv[2], {
    keyEncoding: 'utf8', valueEncoding: codec
  })

db.createReadStream()
  .on('data', console.log)
