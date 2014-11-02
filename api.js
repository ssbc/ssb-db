var Serializer = require('pull-serializer')
var JSONH = require('json-human-buffer')
var muxrpc = require('muxrpc')
var toPull = require('stream-to-pull-stream')
var pull = require('pull-stream')

function serialize (stream) {
  return Serializer(stream, JSONH, {split: '\n\n'})
}

function isFunction (f) {
  return 'function' === typeof f
}


var manifest = {
  async: [
    'add',
    'get',
    'getPublicKey',
    'getLatest',
    'whoami'
  ],

  source: [
    'createFeedStream',
    'createHistoryStream',
    'createLogStream',
    'messagesByType',
    'messagesLinkedToMessage',
    'messagesLinkedToFeed',
    'messagesLinkedFromFeed',
    'feedsLinkedToFeed',
    'feedsLinkedFromFeed'
  ]
}

//connect to server, and expose this api.
exports = module.exports = function (ssb, feed) {

  if(!ssb) throw new Error('ssb is required')
  if(!feed) throw new Error('feed is required')


  var api = {}
  for(var key in manifest) {
    manifest[key].forEach(function (name) {
      api[name] = function () {
        var args = [].slice.call(arguments)
        var f = ssb[name].apply(ssb, args)
        if(f)
          return pull(f, function (read) {
            return function (abort, cb) {
              read(abort, function (err, data) {
                cb(err, data)
              })
            }
          })
      }
    })
  }

  // initialize the feed to always be with respect to
  // a given id. or would it be better to allow access to multiple feeds?

  api.add = function (data, cb) {
    feed.add(data, cb)
  }

  api.whoami = function (_, cb) {
    if(isFunction(_)) cb = _
    cb(null, {id: feed.id, public: feed.keys.public})
  }

  return api
}

exports.client = function () {
      // muxrpc(remote, local, serialization)
  return muxrpc(manifest, null, serialize) ()
}

exports.server = function (ssb, feed) {
  return muxrpc(null, manifest, serialize) (exports(ssb, feed))
}

exports.peer = function (ssb, feed, _serialize) {
  //this is terribly dangerous until we have authorization on the rpc stream
  return muxrpc(manifest, manifest, _serialize || serialize) (exports(ssb, feed))
}

exports.manifest = manifest
