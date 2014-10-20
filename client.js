var pull = require('pull-stream')
var duplex = require('stream-to-pull-stream').duplex
var net = require('net')
var api = require('./api')
var stringify = require('pull-stringify')
var JSONH = require('json-human-buffer')
var toPull = require('stream-to-pull-stream')

var rpc = api.client()

function contains (s, a) {
  if(!a) return false
  return ~a.indexOf(s)
}

function usage () {
  console.error('ssb {cmd} {options}')
  process.exit(1)
}

var opts = require('minimist')(process.argv.slice(2))
var cmd = opts._[0]
delete opts._

var async  = !~contains(cmd, api.manifest.async)
var source = !~contains(cmd, api.manifest.source)
if(!async && !source)
  return usage()

var stream = duplex(net.connect(5657))

pull(
  stream,
  rpc.createStream(function (err) {
    if(err) throw err
  }),
  stream
)

if(!process.stdin.isTTY) {
  pull(
    toPull.source(process.stdin),
    pull.collect(function (err, ary) {
      var str = Buffer.concat(ary).toString('utf8')
      var data = JSONH.parse(str)
      next(data)
    })
  )
}
else
  next(opts)

function next (data) {
  if(async) {
    rpc[cmd](data, function (err, ret) {
      if(err) throw err
      console.log(JSONH.stringify(ret, null, 2))
      process.exit()
    })
  }
  else
    pull(
      rpc[cmd](data),
      stringify('', '\n', '\n\n', 2, JSONH.stringify),
      toPull.sink(process.stdout, function (err) {
        if(err) throw err
        process.exit()
      })
    )
}
