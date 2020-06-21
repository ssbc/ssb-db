'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var ssbKeys = require('ssb-keys')
var createFeed = require('ssb-feed')
var codec = require('../codec')
var createSSB = require('./util/create-ssb')

var generate = ssbKeys.generate
var hash = ssbKeys.hash

function run (opts = {}) {
  var content = {
    'type': 'post',
    'is': 'text',
    'text': 'test',
    'timezone': 300,
    'rebroadcasts': {
      'msg':
          '1BHEHMwZlikXB3o1mg+fP3GVo/+Xb7p46u3rqt/hHkA=.blake2s',
      'feed':
          'rbU6CvdwBXxO/fDyoKuRyKxmZYyeb5+l87R9XVkN8bs=.blake2s',
      'timestamp': 1414078805677,
      'timezone': 300
    }
  }

  var msg = {
    author: hash('TEST_AUTHOR'),
    previous: hash('TEST_PREVIOUS'),
    timestamp: Date.now(),
    sequence: 10,
    content: content
  }

  var signed = {}

  for (var k in msg) { signed[k] = msg[k] }

  signed.signature = Buffer.alloc(64).toString('base64')

  tape('msg encoding (Message)', function (t) {
    var enc = codec.encode(msg)
    var o = codec.decode(enc)
    t.deepEqual(o, msg)
    t.end()
  })

  tape('msg encoding (Signed)', function (t) {
    var enc = codec.encode(signed)
    var o = codec.decode(enc)
    t.deepEqual(o, signed)
    t.end()
  })

  tape('msg encoding (known error case 1)', function (t) {
    var ssb = createSSB('test-ssb-encoding')

    var feed = createFeed(ssb, generate(), opts)

    feed.add(content, function (err, msg) {
      if (err) throw err
      t.assert(!!msg)
      t.assert(!!msg.key)
      t.assert(!!msg.value)
      pull(
        ssb.createFeedStream(),
        pull.collect(function (err, ary) {
          if (err) throw err
          t.equal(ary.length, 1)
          ssb.close(err => {
            t.error(err, 'ssb.close - msg encoding')
            t.end()
          })
        })
      )
    })
  })
}

run()
