'use strict'
var tape      = require('tape')
var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var pull      = require('pull-stream')
var timestamp = require('monotonic-timestamp')

module.exports = function (opts) {

  tape('simple', function (t) {

    var db = sublevel(level('test-ssb-log', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var feed = ssb.createFeed(opts.keys.generate())

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      pull(
        ssb.createLogStream(),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 2)
          console.log(ary)
          t.end()
        })
      )
    })

  })

  tape('gt', function (t) {

    var db = sublevel(level('test-ssb-log2', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var feed = ssb.createFeed(opts.keys.generate())

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      var start = timestamp()
      feed.add('msg', 'second message', function (err, msg) {
        if(err) throw err
        pull(
          ssb.createLogStream({ gt: start }),
          pull.collect(function (err, ary) {
            if(err) throw err
            t.equal(ary.length, 1)
            console.log(ary)
            t.end()
          })
        )
      })
    })

  })

  tape('gt 0', function (t) {

    var db = sublevel(level('test-ssb-log3', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var feed = ssb.createFeed(opts.keys.generate())

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      pull(
        ssb.createLogStream({ gt: 0 }),
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

