
var toStream = require('pull-stream-to-stream')

//search the feed for relays, connect to them and replicate.

//but how is a relay stored?
//{relay: host:port}
//so this means we need to index keys/values/strings?

//TODO test this.
function getRelays (ssb, id, cb) {
  pull(
   join(
      pull(
        cat([
          pull.values([{dest: me}]),
          ssb.feedsLinkedTo(me, 'follow'),
          pull.map(function (link) { return {key: link.dest}})
        ])
      ),
      pull(
        ssb.messagesByType('relay'),
        pull.map(function (msg) {
          return {key: msg.author, key: msg.message.address}
        })
      )
      function (_, address, id) {
        return {id: id, address: address}
      }
    ),
    pull.collect(cb)
  )
}

module.exports = function (ssb, me, opts) {
  //  select * from messages
  //  where !!messages.relay
  //  join messages as m2 
  //  where m2.author = me and m2.follow = messages.author

  // get every one that I follow
  // and join that set to relays

  // what is the best replication strategy?

  getRelays(ssb, me, function (err, ary) {

    //now replicate with a random relay.
    var a = ary[~~(Math.random()*ary.length]
    stream = net.connect(a.address)

    stream
      .pipe(toStream(feed.createReplicationStream()))
      .pipe(stream)

  })

  return net.createServer(function (stream) 
    var feed = ssb.createFeed(me)
    stream
      .pipe(toStream(feed.createReplicationStream()))
      .pipe(stream)
  }).listen(opts.port)

}
