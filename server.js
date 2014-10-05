
var toStream = require('pull-stream-to-stream')
var pull = require('pull-stream')
var cat = require('pull-cat')
var join = require('pull-join')
//search the feed for relays, connect to them and replicate.

//but how is a relay stored?
//{relay: host:port}
//so this means we need to index keys/values/strings?

//TODO test this.
function getRelays (ssb, id, cb) {
  return join(
      pull(
        cat([
          pull.values([{dest: id}]),
          ssb.feedsLinkedFrom(id, 'follow')
        ]),
        pull.map(function (link) { return {key: link.dest}}),
        pull.through(console.log)
      ),
      pull(
        ssb.messagesByType('relay'),
        pull.map(function (msg) {
          return {key: msg.author, value: msg.message.address}
        }),
        pull.through(console.log)
      ),
      function (id, _, address) {
        console.log(_, address, id)
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

exports = module.exports = function (ssb, me, opts) {
  //  select * from messages
  //  where !!messages.relay
  //  join messages as m2 
  //  where m2.author = me and m2.follow = messages.author

  // get every one that I follow
  // and join that set to relays

  // what is the best replication strategy?

  all(getRelays(ssb, me), function (err, ary) {

    //now replicate with a random relay.
    var a = ary[~~(Math.random()*ary.length)]
    stream = net.connect(a.address)

    stream
      .pipe(toStream(feed.createReplicationStream()))
      .pipe(stream)

  })

  return net.createServer(function (stream) {
    var feed = ssb.createFeed(me)
    stream
      .pipe(toStream(feed.createReplicationStream()))
      .pipe(stream)
  }).listen(opts.port)

}

exports.getRelays = getRelays
