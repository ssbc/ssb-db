var pull = require('pull-stream')
var duplex = require('stream-to-pull-stream').duplex
var net = require('net')
var rpc = require('./api').client()
var stringify = require('pull-stringify')
var JSONH = require('json-human-buffer')
var toPull = require('stream-to-pull-stream')

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
    process.exit()
  })

else
  pull(
    rpc.createFeedStream(),
    stringify('', '\n\n', '\n\n', 2, JSONH.stringify),
    toPull.sink(process.stdout, function (err) {
      if(err) throw err
      process.exit()
    })
  )

