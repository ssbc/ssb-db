
var net = require('net')

// check for any local beacons,
// connect and replicate...

var beacons = require('./beacons')
var u = require('./util')
var toStream = require('pull-stream-to-stream')
//connect to local nodes.

var network = module.exports = function (sbs, config) {
  var server = net.createServer(function (stream) {

    console.error('received')
    //receive a connection
    var s = sbs.createReplicationStream()
    stream.pipe(toStream(s.sink, s.source).on('data', console.error)).pipe(stream)

  }).listen(function () {

    var running = false
    var port = server.address().port
    var peers = beacons(sbs, port, config)

    // Decide who to connect to...
    // For local connections, just randomly connect
    // to nearby servers, that are a known user.
    // (that means, you follow them, or a friend does)

    // For connections over the internet...
    // use a different strategy...
    // like, we want to replicate ev

    var following = {}

    peers.on('update', function (p) {
      server.emit('update', p)
      console.error(p)
      for(var k in peers.peers) (function (k) {
        if(!following[k])
          sbs.isFollowing(
            sbs.id, peers.peers[k].id,
            function (err, value) {
              if(value) {
                following[k] = peers.peers[k]
                console.error('following!!!', k)
                start()
              }
            })
      })(k)
    })

    function restart () {
      running = false
      start()
    }

    function start () {
      if(running) return
      running = true

      //a different path to optimize for networks
      //with lower that 5 (?) nodes? quite often it
      //would be like this, but sometimes it will
      //be much larger (like at a tech conference)

      //randomly pick a peer.

      var f = Object.keys(following)
      var k = f[~~(Math.random()*f.length)]
      if(!k || k === sbs.id.toString('hex')) {
        console.error('no friends', k, f)
        setTimeout(restart, 3000*Math.random())
        return
      }
      var stream = net.connect(following[k].port, following[k].address)
      console.error('*** connected ***')
    var s = sbs.createReplicationStream()
    stream.pipe(toStream(s.sink, s.source)).pipe(stream)

      var hasEnded = false
      function ended () {
        if(hasEnded) return
        hasEnded = true
        setTimeout(restart, 1000 * Math.random())
      }

      stream.on('close', ended).on('error', ended)
    }

    var address = server.address
    var port = server.port
    start()
  })

  return server
}

