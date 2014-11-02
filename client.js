var pull = require('pull-stream')
var duplex = require('stream-to-pull-stream').duplex
var net = require('net')
var api = require('./api')
var stringify = require('pull-stringify')
var JSONH = require('json-human-buffer')
var toPull = require('stream-to-pull-stream')

var rpc = api.client()

var aliases = {
  feed: 'createFeedStream',
  history: 'createHistoryStream',
  hist: 'createHistoryStream',
  public: 'getPublicKey',
  pub: 'getPublicKey',
  log: 'createLogStream',
  conf: 'config'
}

function isObject (o) {
  return o && 'object' === typeof o && !Buffer.isBuffer(o)
}

function defaultRel (o, r) {
  if(!isObject(o)) return o
  for(var k in o) {
    console.log(k)
    if(isObject(o[k]))
      defaultRel(o[k], k)
    else if(k[0] === '$' && ~['$msg', '$ext', '$feed'].indexOf(k)) {
      if(!o.$rel)
        o.$rel = r ? r : o.type
    }
  }
  return o
}

function contains (s, a) {
  if(!a) return false
  return !!~a.indexOf(s)
}

function usage () {
  console.error('ssb {cmd} {options}')
  process.exit(1)
}

var opts = require('minimist')(process.argv.slice(2))
var cmd = opts._[0]
var arg = opts._[1]
delete opts._

cmd = aliases[cmd] || cmd

if(arg && Object.keys(opts).length === 0)
  opts = arg

var config = require('./config')
if(cmd === 'config') {
  console.log(JSON.stringify(config, null, 2))
  process.exit()
}


var async  = contains(cmd, api.manifest.async)
var source = contains(cmd, api.manifest.source)

if(!async && !source)
  return usage()

var stream = duplex(net.connect(config.rpcPort))

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
      console.log(str)
      var data = JSONH.parse(str)
      console.log(data)
      next(data)
    })
  )
}
else
  next(JSONH.fromHuman(opts))

function next (data) {
  //set $rel as key name if it's missing.
  defaultRel(data)
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
