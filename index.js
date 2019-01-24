var create     = require('./create')
var ssbKeys    = require('ssb-keys')
var path       = require('path')
var osenv      = require('osenv')
var mkdirp     = require('mkdirp')
var rimraf     = require('rimraf')
var mdm        = require('mdmanifest')
var valid      = require('./lib/validators')
var pkg        = require('./package.json')

function isString(s) { return 'string' === typeof s }
function isObject(o) { return 'object' === typeof o }
function isFunction (f) { return 'function' === typeof f }
// create SecretStack definition
var fs = require('fs')
var manifest = mdm.manifest(fs.readFileSync(path.join(__dirname, 'api.md'), 'utf-8'))

manifest.seq = 'async'
manifest.usage = 'sync'
manifest.clock = 'async'
manifest.version = 'sync'

module.exports = {
  manifest: manifest,
  permissions: {
    master: {allow: null, deny: null},
    anonymous: {allow: ['createHistoryStream'], deny: null}
  },
  init: function (api, opts) {

    // .temp: use a /tmp data directory
    // (useful for testing)
    if(opts.temp) {
      var name = isString(opts.temp) ? opts.temp : ''+Date.now()
      opts.path = path.join(osenv.tmpdir(), name)
      rimraf.sync(opts.path)
    }

    // load/create secure scuttlebutt data directory
    mkdirp.sync(opts.path)

    if(!opts.keys)
      opts.keys = ssbKeys.generate('ed25519', opts.seed && Buffer.from(opts.seed, 'base64'))

    if(!opts.path)
      throw new Error('opts.path *must* be provided, or use opts.temp=name to create a test instance')

    // main interface
    var ssb = create(opts.path, opts, opts.keys)
    //treat the main feed as remote, because it's likely handled like that by others.
    var feed = ssb.createFeed(opts.keys, {remote: true})
    var _close = api.close
    var close = function (arg, cb) {
      if('function' === typeof arg) cb = arg
      ssb.flush(function (err) {
        if(err) return cb(err)
        // override to close the SSB database
        ssb.close(function (err) {
          if (err) return cb(err)
          console.log("fallback to close")
          _close(cb) //multiserver doesn't take a callback on close.
        })
      })
    }

    function since () {
      var plugs = {}
      var sync = true
      for(var k in ssb) {
        if(ssb[k] && isObject(ssb[k]) && isFunction(ssb[k].since)) {
          plugs[k] = ssb[k].since.value
          sync = sync && (plugs[k] === ssb.since.value)
        }
      }
      return {
        since: ssb.since.value,
        plugins: plugs,
        sync: sync,
      }
    }
    var self
    return self = {
      id                       : feed.id,
      keys                     : opts.keys,

      ready                    : function () {
        return ssb.ready.value
      },

      progress                 : function () {
        return ssb.progress
      },

      status                   : function () {
        return {progress: self.progress(), db: ssb.status, sync: since() }
      },

      version                  : function () {
        return pkg.version
      },

      //temporary!
      _flumeUse                :
        function (name, flumeview) {
          ssb.use(name, flumeview)
          return ssb[name]
        },

  //    usage                    : valid.sync(usage, 'string?|boolean?'),
      close                    : close,

      publish                  : valid.async(feed.add, 'string|msgContent'),
      add                      : valid.async(ssb.add, 'msg'),
      queue                      : valid.async(ssb.queue, 'msg'),
      get                      : valid.async(ssb.get, 'msgLink|number|object'),

      post                     : ssb.post,
      addMap                   : ssb.addMap,

      since                    : since,

      getPublicKey             : ssb.getPublicKey,
      latest                   : ssb.latest,
      getLatest                : valid.async(ssb.getLatest, 'feedId'),
      latestSequence           : valid.async(ssb.latestSequence, 'feedId'),
      createFeed               : ssb.createFeed,
      whoami                   : function () { return { id: feed.id } },
      query                    : ssb.query,
      createFeedStream         : valid.source(ssb.createFeedStream, 'readStreamOpts?'),
      createHistoryStream      : valid.source(ssb.createHistoryStream, ['createHistoryStreamOpts'], ['feedId', 'number?', 'boolean?']),
      createLogStream          : valid.source(ssb.createLogStream, 'readStreamOpts?'),
      createUserStream         : valid.source(ssb.createUserStream, 'createUserStreamOpts'),
      links                    : valid.source(ssb.links, 'linksOpts'),
      sublevel                 : ssb.sublevel,
      messagesByType           : valid.source(ssb.messagesByType, 'string|messagesByTypeOpts'),
      createWriteStream        : ssb.createWriteStream,
      getVectorClock           : ssb.getVectorClock,
      getAtSequence            : ssb.getAtSequence,
      addUnboxer               : ssb.addUnboxer,
      box                      : ssb.box,
    }
  }
}

