
var toStream = require('pull-stream-to-stream')
var pull = require('pull-stream')
var cat = require('pull-cat')
var join = require('pull-join')
//search the feed for relays, connect to them and replicate.

//but how is a relay stored?
//{relay: host:port}
//so this means we need to index keys/values/strings?

function getRelays (ssb, id, cb) {
  return join(
      pull(
        cat([
          pull.values([{dest: id}]),
          ssb.feedsLinkedFrom(id, 'follow')
        ]),
        pull.map(function (link) { return {key: link.dest}})
      ),
      pull(
        ssb.messagesByType('relay'),
        pull.map(function (msg) {
          return {key: msg.author, value: msg.message.address}
        })
      ),
      function (id, _, address) {
        return {id: id, address: address}
      }
    )
}

function all(stream, cb) {
  if (cb) return pull(stream, pull.collect(cb))
  else return function (cb) {
    pull(stream, pull.collect(cb))
  }
}

function addr (opts) {
  return opts.host + ':' + opts.port
}

var net = require('net')

exports = module.exports = function (ssb, feed, opts) {

  all(cat([
    pull.values((opts.seeds || []).map(function (e) {
      return {address: e, id: null}
    })),
    getRelays(ssb, feed.id)
  ]), function (err, ary) {

    console.log(addr(opts), ary)

    //now replicate with a random relay.
    var a = ary[~~(Math.random()*ary.length)]
    if(!a || !a.address) return console.error('no one to replicate with')
    var address = a.address
    console.log(addr(opts), 'to:', addr(a.address))
    stream = net.connect(a.address.port, a.address.host)

    stream
      .pipe(toStream(feed.createReplicationStream({
          progress: function (a, b) {
            console.log(addr(opts), addr(address), a, b)
          }
        }, function (err) {
          console.log('DONE', addr(opts))
        })))
      .pipe(stream)

  })

  return net.createServer(function (stream) {
    stream
      .pipe(toStream(feed.createReplicationStream(function (err) {
        console.log('replicated with client')
      })))
      .pipe(stream)
  }).listen(opts.port)

}

exports.getRelays = getRelays
