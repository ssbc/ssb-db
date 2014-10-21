var toPull = require('stream-to-pull-stream')
var net = require('net')
var pull = require('pull-stream')
var cat = require('pull-cat')
var join = require('pull-join')
var api = require('./api')


exports = module.exports = function (ssb, feed, opts) {

  return net.createServer(function (stream) {
    stream = toPull.duplex(stream)
    pull(stream, api.server(ssb, feed).createStream(), stream)
  })
  .listen(opts.rpcPort)

}


if(!module.parent) {
  var create = require('./create')
  var path = require('path')
  var ssb = create(path.join(process.env.HOME, '.ssb/db'))
  var feed = ssb.createFeed()
  exports(ssb, feed, {port: 5656, rpcPort: 5657})
}
