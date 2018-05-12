
var level = require('level')
var sublevel = require('level-sublevel/bytewise')
var opts = require('./defaults')
var SSB = require('./')

module.exports = function (path, opts, keys) {
  opts = opts || require('./defaults')
  return SSB(
    sublevel(level(path, {
      valueEncoding: require('./codec')
    })), opts, keys, path)
}
