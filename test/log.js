'use strict'
var tape      = require('tape')
var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var pull      = require('pull-stream')
var timestamp = require('monotonic-timestamp')
var ssbKeys  = require('ssb-keys')
var createFeed = require('ssb-feed')

var generate = ssbKeys.generate

module.exports = function (opts) {

  tape('simple', function (t) {

    var db = sublevel(level('test-ssb-log', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var feed = createFeed(ssb, generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      pull(
        ssb.createLogStream(),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 1)
          t.assert(!!ary[0].key)
          t.assert(!!ary[0].value)
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

    var feed = createFeed(ssb, generate(), opts)

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

    var feed = createFeed(ssb, generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      pull(
        ssb.createLogStream({ gt: 0 }),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 1)
          console.log(ary)
          t.end()
        })
      )
    })

  })

  tape('keys only', function (t) {

    var db = sublevel(level('test-ssb-log4', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var feed = createFeed(ssb, generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      pull(
        ssb.createLogStream({ values: false }),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 1)
          t.equal(typeof ary[0], 'string')
          console.log(ary)
          t.end()
        })
      )
    })

  })

  tape('values only', function (t) {

    var db = sublevel(level('test-ssb-log5', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var feed = createFeed(ssb, generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      pull(
        ssb.createLogStream({ keys: false }),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 1)
          t.equal(typeof ary[0].content.type, 'string')
          console.log(ary)
          t.end()
        })
      )
    })

  })

  tape('live', function (t) {
    t.plan(3)

    var db = sublevel(level('test-ssb-log6', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var feed = createFeed(ssb, generate(), opts)

      var ts = Date.now()

      pull(
        ssb.createLogStream({ live: true }),

        pull.drain(function (op) {
          if(op.sync) return t.ok(true)
          t.ok(op.timestamp > ts)
          t.equal(op.value.content.type, 'msg')
          t.end()
        })
      )


    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
    })

  })

}


if(!module.parent)
  module.exports(require('../defaults'))



