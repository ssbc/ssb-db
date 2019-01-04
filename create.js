var SSB = require('./')

module.exports = function (path, opts, keys) {
  opts = opts || require('./defaults')
  return SSB(null, opts, keys, path)
}

