
var level = require('level')
var sublevel = require('level-sublevel/bytewise')
var opts = require('./defaults')
var SSB = require('./')

module.exports = function (path, opts) {
  opts = opts || require('./defaults')
  return SSB(
    sublevel(level(path, {
      valueEncoding: opts.codec
    })), opts)
}
