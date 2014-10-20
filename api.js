var Serializer = require('pull-serializer')
var JSONH = require('json-human-buffer')
var muxrpc = require('muxrpc')
var toPull = require('stream-to-pull-stream')
var pull = require('pull-stream')

function serialize (stream) {
  return Serializer(stream, JSONH, {split: '\n\n'})
}


var manifest = {
  async: [
    'add',
    'getPublicKey',
    'getLatest'
  ],

  source: [
    'createFeedStream',
    'createHistoryStream',
    'createLogStream',
    'messagesLinkedTo',
    'feedsLinkedTo',
    'feedsLinkedFrom'
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

  return api
}

exports.client = function () {
      // muxrpc(remote, local, serialization)
  return muxrpc(manifest, null, serialize) ()
}

exports.server = function (ssb, feed) {
  return muxrpc(null, manifest, serialize) (exports(ssb, feed))
}

exports.manifest = manifest
