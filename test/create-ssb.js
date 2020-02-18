var ssbKeys = require('ssb-keys')

module.exports = function createSSB (name, opts) {
  opts = opts || {}
  var dir = require('path').join(require('osenv').tmpdir(), name)
  if (opts.temp !== false) {
    require('rimraf').sync(dir)
    require('mkdirp').sync(dir)
  }
  var keys = opts.keys = opts.keys || ssbKeys.generate()
  return require('../create')(dir, opts, keys)
}
