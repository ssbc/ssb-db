
var toStream = require('pull-stream-to-stream')
var pull = require('pull-stream')
var cat = require('pull-cat')
var join = require('pull-join')
//search the feed for relays, connect to them and replicate.

//but how is a relay stored?
//{relay: host:port}
//so this means we need to index keys/values/strings?

function getRelays (ssb, id) {
  return join(
    pull(
      ssb.feedsLinkedFrom(id, 'follow'),
      pull.map(function (link) { return {key: link.dest}})
    ),
    pull(
      ssb.messagesByType('pub'),
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

function upto (expected) {
  var o = {}
  for(var k in expected)
    o[k] = expected[k].me + expected[k].recv
  return o
}


var net = require('net')

exports = module.exports = function (ssb, feed, opts) {

  var connecting = false, server

  function connect () {
    if(connecting) return
    connecting = true
    if(server.closed) return
    //TODO rewrite this to be be a realtime dataset
    //track relay servers, and follows.
    //keep track of how much data you have received
    //from them and when you last replicated.
    all(cat([
      pull.values((opts.seeds || []).map(function (e) {
        return {address: e, id: feed.id}
      })),
      getRelays(ssb, feed.id)
    ]), function (err, ary) {

      //now replicate with a random relay.
      ary = ary.filter(function (e) {
        return e.address.port !== opts.port || e.address.host !== opts.host
      })

      var a = ary[~~(Math.random()*ary.length)]
      if(!a || !a.address) return console.error('no one to replicate with')
      var address = a.address

      console.log(addr(opts), 'to:', addr(a.address))
      stream = net.connect(a.address.port, a.address.host)

      //when there are new messages, replicate more often.
      //when you replicate but didn't get anything replicate slower.

      stream
        .on('error', function (err) {
          console.log(err)
          setTimeout(connect, 1000 + Math.random() * 3000)
        })
        .pipe(toStream(feed.createReplicationStream({
            //we probably want a progress bar to show how in sync we are.
          }, function (err, sent, recv, expected) {
            connecting = false
            server.emit('replicated', upto(expected))
            //TODO: something smarter than randomly waiting
            setTimeout(connect, 1000 + Math.random() * 3000)
          })))
        .pipe(stream)

    })

  }

  return server = net.createServer(function (stream) {
    stream
      .pipe(toStream(feed.createReplicationStream({},
        function (err, sent, recv, expected) {
          server.emit('replicated', upto(expected))
        })))
      .pipe(stream)
  }).listen(opts.port, function () {
    setTimeout(connect, 1000 + Math.random() * 3000)
  })
  .on('close', function () {
    server.closed = true
  })

}


exports.getRelays = getRelays
