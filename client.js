var pull = require('pull-stream')
var duplex = require('stream-to-pull-stream').duplex
var net = require('net')
var rpc = require('./api').client()

var stream = duplex(net.connect(5657))

pull(
  stream,
  rpc.createStream(function (err) {
    if(err) throw err
  }),
  stream
)

var cmd = process.argv.slice(2)

if(cmd.length >= 2)
  rpc.add(cmd[0], cmd[1], function (err, val) {
    if(err) throw err
    console.log(val)
    process.exit()
  })

else
  pull(rpc.createFeedStream(), pull.drain(console.log, function (err) {
    if(err) throw err
    process.exit()
  }))

