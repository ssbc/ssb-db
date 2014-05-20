
var broadcastStream = require('broadcast-stream')
var codec = require('./codec')
var u = require('./util')

module.exports = function (sbs, config) {
  var stream = broadcastStream(8999)
  var net = require('net')

  var peers = {}

  function sayHello(stream) {
    stream.write('hello from ' + id.toString('hex'))
    setTimeout(function () {
      stream.end()
    }, 1000*Math.random())
  }

  var server = net.createServer(function (stream) {
    stream.on('data', function (data) {
      console.log('recv-net', data.toString())
    })
    sayHello(stream)
  }).listen(config.port || 0, function () {
    console.log(server.address())
    start(server.address().port)
    setTimeout(connect, Math.random()*2000)
  })
  stream.on('error', function (err) { console.log(err)})

  var id = u.bsum(''+process.pid)
  console.log('I AM ' + id.toString('hex'))
  function start (port) {
    var buffer = new Buffer(codec.Broadcast.length)

    setInterval(function () {
      console.log('emit', port)
      stream.write(
        codec.Broadcast.encode({
          id: id,
          port: port,
          timestamp: Date.now()
        }, buffer, 0)
      )
      setTimeout(function () {
      }, Math.random()*2000)

    }, 1000)
  }

  stream.on('data', function (data) {
    var msg = codec.Broadcast.decode(data)

    if(true || data.loopback) {
      peers[msg.id.toString('hex')] = {
        port:msg.port,
        address: data.address,
        timestamp: msg.timestamp
      }
    }
  })

  var connected = false

  function connect () {
    console.log('connect')
    if(connected)
      return
    var ids = Object.keys(peers)
    var peerid = ids[~~(Math.random()*ids.length)]
    var peer = peers[peerid]
    console.log(peer)
    if(!peer) return
    if(peerid === id)
      return setTimeout(connect, Math.random()*2000)
    console.log('con:', peerid)
    connected = true

    console.log('send message to:', peer)
    var stream = net.connect(peer.port, peer.address)
    stream.on('data', function (data) {
      console.log('recv-net', data.toString())
    })
    sayHello(stream)
    stream.on('close', function () {
      connected = false
      setTimeout(connect, Math.random()*1000)
    })
    stream.on('error', function (err) {
      connected = false
      setTimeout(connect, Math.random() * 1000)
    })
  }

}

if(!module.parent) {
  module.exports(null, require('./config'))
}
