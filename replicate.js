var api = require('./api')
var manifest = api.manifest
var goodbye = require('pull-goodbye')
var Serializer = require('pull-serializer')
var JSONH = require('json-human-buffer')
var pull = require('pull-stream')
var many = require('pull-many')

function serialize (stream) {
  return Serializer(stream, JSONH, {split: '\n\n'})
}

function id (e) {
  return e
}

module.exports = function (ssb, opts, cb) {
  opts = opts || {}
  var rpc = api.peer(ssb, {}, id)
  var progress = opts.progress || function () {}

  var latestStream = opts.latest
    ? pull(
        opts.latest(),
        ssb.createLatestLookupStream()
      )
    : ssb.latest()

  var sources = many()
  var sent = 0
  pull(
    latestStream,
    pull.drain(function (upto) {
      sources.add(rpc.createHistoryStream(upto.id, upto.sequence + 1))
    }, function () {
      sources.cap()
    })
  )

  var rpcStream = rpc.createStream()

  pull(
    sources,
    pull.through(function (data) {
      sent ++
      console.log(sent)
      console.log(data)
    }),
    ssb.createWriteStream(function (err) {
      rpcStream.close(function (err2) {
        cb(err || err2, sent)
      })
    })
  )

  return serialize(goodbye(rpcStream))

}
