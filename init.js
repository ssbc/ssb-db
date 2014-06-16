var path   = require('path')
var fs     = require('fs')

var mkdirp = require('mkdirp')
var ecc    = require('eccjs')
var level  = require('level')

var Sbs    = require('./')
var codec  = require('./codec')
var secret = require('./secret')

module.exports = function (config) {
  if(!config.path) throw new Error('must have config.path')

  mkdirp.sync(config.path)

  var dbPath = path.join(config.path, 'db')
  var keyPath = path.join(config.path, 'secret')
  var db = level(dbPath, {
    keyEncoding: codec, valueEncoding: codec
  })

  var keys

  try {
    keys = secret.decode(fs.readFileSync(keyPath, 'utf8'))
  } catch(err) {
    keys = secret.generate()
    fs.writeFileSync(keyPath, secret.encode(keys), 'utf8')
  }

  return Sbs(db, keys)
}

if(!module.parent) {
  var config = require('./config')
  var proquint = require('proquint-')
  var sbs = module.exports(config)

  if(config.proquint)
    console.log(proquint.encodeCamelDash(sbs.id))
  else
    console.log(sbs.id.toString('hex'))
}
