'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var jhb      = require('json-human-buffer')

var codec    = require('../defaults').codec
var hexpp    = require('hexpp')

module.exports = function (opts) {

  var content = {
      "type":"post",
      "is":"text",
      "text":"test",
      "timezone":300,
      "rebroadcasts":{
        "$rel":"rebroadcasts",
        "$msg":
          new Buffer("1BHEHMwZlikXB3o1mg+fP3GVo/+Xb7p46u3rqt/hHkA=", 'base64'),
        "$feed":
          new Buffer("rbU6CvdwBXxO/fDyoKuRyKxmZYyeb5+l87R9XVkN8bs=", 'base64'),
        "timestamp":1414078805677,
        "timezone":300
      }
    }

  var msg = {
    author: new Buffer(32),
    previous: new Buffer(32),
    timestamp: Date.now(),
    sequence: 10,
    content: content
  }

  var signed = {}

  for(var k in msg)
    signed[k] = msg[k]

  signed.signature = new Buffer(64)
  signed.signature.fill(0xab)

  tape('Message', function (t) {
    var enc = codec.encode(msg)
    console.log('**** Message ****')
    console.log(hexpp(enc))
    var o = codec.decode(enc)
    t.deepEqual(o, msg)
    t.end()
  })

  tape('Signed', function (t) {
    var enc = codec.encode(signed)
    console.log('**** Signed ****')
    console.log(hexpp(enc))
    var o = codec.decode(enc)
    t.deepEqual(o, signed)
    t.end()
  })

  tape('known error case 1', function (t) {

    var db = sublevel(level('test-ssb-encoding', {
      valueEncoding: require('../codec')
    }))
    var ssb = require('../')(db, opts)
    var feed = ssb.createFeed(opts.keys.generate())

    feed.add(content, function (err, msg, hash) {
      if(err) throw err
      t.assert(!!msg)
      t.assert(!!hash)
      pull(
        ssb.createFeedStream(),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 2)
          console.log(ary)
          t.end()
        })
      )
    })

  })
}


if(!module.parent)
  module.exports(require('../defaults'))
