
var broadcastStream = require('broadcast-stream')
var codec = require('./codec')
var u = require('./util')

var Emitter = require('events').EventEmitter

// emit local beacons on udp, so that it's easy
// to connect to friends when nearby.

module.exports = function (sbs, config) {

  var stream = broadcastStream(8999)

  var emitter = new Emitter()
  var port = 1024 + ~~(40000* Math.random())
  emitter.peers = {}

  //this should be hash of public key.
  var id = u.bsum('' + process.pid)

  var buffer = new Buffer(codec.Broadcast.length)

  stream.on('data', function (data) {
    var msg = codec.Broadcast.decode(data)
    var peer = {
      address: data.address, port: msg.port,
      timestamp: msg.timestamp, id: msg.id,
      loopback: !!data.loopback
    }
    emitter.peers[msg.id.toString('hex')] = peer
    emitter.emit('update', peer)
  })

  function emitBeacon () {
    setTimeout(function () {
      stream.write(
        codec.Broadcast.encode({
          id: id,
          port: port,
          timestamp: Date.now(),
          //TODO, add space for a brief personal message.
        }, buffer, 0)
      )
    }, Math.random() * 2000)
  }

  emitBeacon()

  return emitter
}

if(!module.parent) {
  module.exports()
}
