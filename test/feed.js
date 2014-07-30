'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')

module.exports = function (opts) {

  tape('simple', function (t) {

    var db = sublevel(level('test-ssb-feed', {
      valueEncoding: require('../codec')
    }))

    var ssb = require('../')(db, opts)

    var feed = ssb.createFeed(opts.generate())

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
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
