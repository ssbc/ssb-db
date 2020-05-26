const ssbKeys = require("ssb-keys");
const rimraf = require("rimraf");
const mkdirp = require("mkdirp");
const path = require("path");
const osenv = require("osenv");
const crypto = require("crypto");

const randomName = () => crypto.randomBytes(16).toString("hex");

module.exports = function createSSB(name = randomName(), opts = {}) {
  const dir = path.join(osenv.tmpdir(), name);

  if (opts.temp !== false) {
    rimraf.sync(dir);
    mkdirp.sync(dir);
  }

  const keys = (opts.keys = opts.keys || ssbKeys.generate());
  return require("../create")(dir, opts, keys);
};
