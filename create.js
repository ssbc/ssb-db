
var level = require('level')
var sublevel = require('level-sublevel/bytewise')
var opts = require('./defaults')
var SSB = require('./')

module.exports = function (path, db) {
  return SSB(sublevel(level(path, {valueEncoding: opts})), opts)
}
