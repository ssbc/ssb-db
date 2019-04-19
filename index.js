var create     = require('./create')
var ssbKeys    = require('ssb-keys')
var path       = require('path')
var osenv      = require('osenv')
var mkdirp     = require('mkdirp')
var rimraf     = require('rimraf')
var valid      = require('./lib/validators')
var pkg        = require('./package.json')
var manifest   = require('./manifest.json')

function isString(s) { return 'string' === typeof s }
function isObject(o) { return 'object' === typeof o }
function isFunction (f) { return 'function' === typeof f }
// create SecretStack definition
var fs = require('fs')

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
    try { mkdirp.sync(opts.path) }
    catch (err) { console.error('ignoring mkdirp.sync in browser') }

    if(!opts.keys)
      opts.keys = ssbKeys.generate('ed25519', opts.seed && Buffer.from(opts.seed, 'base64'))

    if(!opts.path)
      throw new Error('opts.path *must* be provided, or use opts.temp=name to create a test instance')

    // main interface
    var ssb = create(opts.path, opts, opts.keys)
    //treat the main feed as remote, because it's likely handled like that by others.
//    var feed = ssb.createFeed(opts.keys, {remote: true})
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

    //calculate status
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
      id                       : opts.keys.id,
      keys                     : opts.keys,

      ready                    : function () {
        return ssb.ready.value
      },

      progress                 : function () {
        return ssb.progress
      },

      status                   : function () {
        //this ought to be more consistently organized by the name of the thing.
        return {progress: self.progress(), db: ssb.status, sync: since() }
      },

      version                  : function () {
        return pkg.version
      },

      //temporary!... but became permanent
      _flumeUse                :
        function (name, flumeview) {
          ssb.use(name, flumeview)
          return ssb[name]
        },

      close                    : close,

      publish                  : valid.async(ssb.publish, 'string|msgContent'),
      add                      : valid.async(ssb.add, 'msg'),
      queue                    : valid.async(ssb.queue, 'msg'),
      get                      : valid.async(ssb.get, 'msgLink|number|object'),

      post                     : ssb.post,
      addMap                   : ssb.addMap,

      since                    : since,

      whoami                   : function () { return { id: opts.keys.id } },
      createRawLogStream       : ssb.createRawLogStream,
      createLogStream       : ssb.createRawLogStream,
      getVectorClock           : ssb.getVectorClock,
      getAtSequence            : ssb.getAtSequence,
      addUnboxer               : ssb.addUnboxer,
      box                      : ssb.box,
    }
  }
}











