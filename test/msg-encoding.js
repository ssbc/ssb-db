'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var jhb      = require('json-human-buffer')

module.exports = function (opts) {

  tape('known error case 1', function (t) {

    var db = sublevel(level('test-ssb-encoding', {
      valueEncoding: require('../codec')
    }))
    var ssb = require('../')(db, opts)
    var feed = ssb.createFeed(opts.keys.generate())
    var testMsg = jhb.parse('{"type":"post","is":"text","text":"test","timezone":300,"rebroadcasts":{"$rel":"rebroadcasts","$msg":"1BHEHMwZlikXB3o1mg+fP3GVo/+Xb7p46u3rqt/hHkA=.base64","$feed":"rbU6CvdwBXxO/fDyoKuRyKxmZYyeb5+l87R9XVkN8bs=.base64","timestamp":1414078805677,"timezone":300}}')

    feed.add(testMsg, function (err, msg, hash) {
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
