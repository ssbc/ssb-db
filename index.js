var create     = require('./create')
var ssbKeys    = require('ssb-keys')
var path       = require('path')
var os         = require('os')
var mkdirp     = require('mkdirp')
var rimraf     = require('rimraf')
var valid      = require('./lib/validators')
var version    = require('./package.json').version
var help       = require('./help')

const pull = require('pull-stream')
const pullNotify = require('pull-notify')
const pullCat = require('pull-cat')

function isString(s) { return 'string' === typeof s }
function isObject(o) { return 'object' === typeof o }
function isFunction (f) { return 'function' === typeof f }

var manifest = {
  add: 'async',
  createFeedStream: 'source',
  createHistoryStream: 'source',
  createLogStream: 'source',
  createRawLogStream: 'source',
  createSequenceStream: 'source',
  createUserStream: 'source',
  createWriteStream: 'sink',
  del: 'async',
  get: 'async',
  getLatest: 'async',
  getVectorClock: 'async',
  help: 'sync',
  latest: 'source',
  getFeedState: 'async',
  latestSequence: 'async',
  links: 'source',
  messagesByType: 'source',
  progress: 'sync',
  publish: 'async',
  rebuild: 'async',
  status: 'sync',
  version: 'sync',
  whoami: 'sync',
}

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
      opts.path = path.join(os.tmpdir(), name)
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

    var secretStackClose = api.close
    function close (arg, cb) {
      if('function' === typeof arg) cb = arg
      ssb.flush(function (err) {
        if(err) return cb(err)
        // override to close the SSB database
        continueClose()
      })
      function continueClose () {
        if (ssb.rebuild.isActive) return setTimeout(continueClose, 100)

        ssb.close(function (err) {
          if (err) return cb(err)
          //multiserver doesn't take a callback on close.
          secretStackClose((err) => {
            setImmediate(() => {
              if (typeof cb === 'function') {
                if (typeof err === 'object' && err !== null && err.code === 'ERR_SERVER_NOT_RUNNING') {
                  // https://github.com/ssbc/ssb-db/issues/300
                  err = null
                }
                cb(err)
              }
            })
          })
        })
      }
    }

    function since () {
      var plugs = {}
      var sync = true
      for (var name in ssb.views) {
        plugs[name] = ssb.views[name].since.value
        sync = sync && (plugs[name] === ssb.since.value)
      }
      return {
        since: ssb.since.value,
        plugins: plugs,
        sync: sync
      }
    }
    var self

    // When `since` changes we want to send the new value to our instance of
    // pull-notify so that the value can be streamed to any listeners (if they
    // exist). Listeners are created by calling `createSequenceStream()` and are
    // automatically removed when the stream closes.
    const sequenceNotifier = pullNotify()
    ssb.since(sequenceNotifier)

    return self = {
      keys                     : opts.keys,
      id                       : feed.id,

      whoami                   : () => {
        return { id: feed.id }
      },
      version                  : () => version,
      ready                    : () => ssb.ready.value,
      progress                 : () => ssb.progress,
      status                   : () => {
        return {
          progress: ssb.progress,
          db: ssb.status,
          sync: since()
        }
      },

      //temporary!
      _flumeUse                : function (name, flumeview) {
        ssb.use(name, flumeview)
        return ssb[name]
      },

      close                    : close,
      del                      : valid.async(ssb.del, 'msgLink|feedId'),
      publish                  : valid.async(feed.add, 'string|msgContent'),
      add                      : valid.async(ssb.add, 'msg'),
      queue                    : valid.async(ssb.queue, 'msg'),
      get                      : valid.async(ssb.get, 'msgLink|number|object'),

      post                     : ssb.post,
      addMap                   : ssb.addMap,

      since                    : since,

      latest                   : ssb.latest,
      getFeedState             : valid.async(ssb.getFeedState, 'feedId'),
      getLatest                : valid.async(ssb.getLatest, 'feedId'),
      latestSequence           : valid.async(ssb.latestSequence, 'feedId'),
      createFeed               : ssb.createFeed,
      createFeedStream         : valid.source(ssb.createFeedStream, 'readStreamOpts?'),
      createHistoryStream      : valid.source(ssb.createHistoryStream, ['createHistoryStreamOpts'], ['feedId', 'number?', 'boolean?']),
      createLogStream          : valid.source(ssb.createLogStream, 'readStreamOpts?'),
      createRawLogStream       : valid.source(ssb.createRawLogStream, 'readStreamOpts?'),
      createUserStream         : valid.source(ssb.createUserStream, 'createUserStreamOpts'),
      createSequenceStream     : () => {
        // If the initial value is `undefined` we want it to be `-1`.
        // This is because `-1` is a magic sequence number for an empty log.
        const initialValue = ssb.since.value !== undefined
          ? ssb.since.value
          : -1

        return pullCat([
          pull.values([initialValue]),
          sequenceNotifier.listen()
        ])
      },
      links                    : valid.source(ssb.links, 'linksOpts'),
      // sublevel                 : ssb.sublevel, // Disabled as does not appear to be used
      messagesByType           : valid.source(ssb.messagesByType, 'string|messagesByTypeOpts'),
      createWriteStream        : ssb.createWriteStream,
      getVectorClock           : ssb.getVectorClock,
      getAtSequence            : ssb.getAtSequence,
      addBoxer                 : ssb.addBoxer,
      addUnboxer               : ssb.addUnboxer,
      rebuild                  : ssb.rebuild,
      help                     : () => help
    }
  }
}
