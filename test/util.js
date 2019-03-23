var ssbKeys = require('ssb-keys')

module.exports = function createSSB (name, opts, keys) {
  opts = opts || {}
  var dir = require('path').join(require('osenv').tmpdir(), name)
  if (opts.temp !== false) {
    if(process.title == 'node') {
      //don't do this if we are in the browser
      require('rimraf').sync(dir)
      require('mkdirp').sync(dir)
    }
  }
  opts.keys = opts.keys || ssbKeys.generate()
  return require('../create')(dir, opts, opts.keys)
}
