'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var timestamp = require('monotonic-timestamp')
var ssbKeys = require('ssb-keys')
var createFeed = require('ssb-feed')
var createSSB = require('./create-ssb')

var generate = ssbKeys.generate

module.exports = function (opts) {
  tape('simple', function (t) {
    var ssb = createSSB('test-ssb-log1')

    var feed = createFeed(ssb, generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if (err) throw err
      pull(
        ssb.createLogStream(),
        pull.collect(function (err, ary) {
          if (err) throw err
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
    var ssb = createSSB('test-ssb-log2')

    var feed = createFeed(ssb, generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if (err) throw err
      var start = timestamp()
      feed.add('msg', 'second message', function (err, msg) {
        if (err) throw err
        pull(
          ssb.createLogStream({ gt: start }),
          pull.collect(function (err, ary) {
            if (err) throw err
            t.equal(ary.length, 1)
            console.log(ary)
            t.end()
          })
        )
      })
    })
  })

  tape('gt 0', function (t) {
    var ssb = createSSB('test-ssb-log4')

    var feed = createFeed(ssb, generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if (err) throw err
      pull(
        ssb.createLogStream({ gt: 0 }),
        pull.collect(function (err, ary) {
          if (err) throw err
          t.equal(ary.length, 1)
          console.log(ary)
          t.end()
        })
      )
    })
  })

  tape('keys only', function (t) {
    var ssb = createSSB('test-ssb-log5')

    var feed = createFeed(ssb, generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if (err) throw err
      pull(
        ssb.createLogStream({ values: false }),
        pull.collect(function (err, ary) {
          if (err) throw err
          t.equal(ary.length, 1)
          t.equal(typeof ary[0], 'string')
          console.log(ary)
          t.end()
        })
      )
    })
  })

  tape('values only', function (t) {
    var ssb = createSSB('test-ssb-log6')

    var feed = createFeed(ssb, generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if (err) throw err
      pull(
        ssb.createLogStream({ keys: false }),
        pull.collect(function (err, ary) {
          if (err) throw err
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

    var ssb = createSSB('test-ssb-log7')

    var feed = createFeed(ssb, generate(), opts)

    var ts = Date.now()

    pull(
      ssb.createLogStream({ live: true }),

      pull.drain(function (op) {
        if (op.sync) return t.ok(true)
        t.ok(op.timestamp > ts)
        t.equal(op.value.content.type, 'msg')
        t.end()
      })
    )

    feed.add('msg', 'hello there!', function (err, msg) {
      if (err) throw err
    })
  })

  tape('delete message', (t) => {
    var ssb = createSSB('test-ssb-log8')

    var feed = createFeed(ssb, generate(), opts)
    t.plan(4)

    feed.add('msg', 'hello there!', function (err, msg) {
      t.error(err)

      pull(
        ssb.createFeedStream(),
        pull.drain(function (msg) {
          ssb.del(msg.key, err => t.error(err))
        }, () => {
          pull(
            ssb.createFeedStream(),
            pull.drain(() => {
              t.fail('no messages should be available')
            }, () => {
              ssb.get(msg.key, (err) => {
                t.ok(err)
                t.equal(err.code, 'flumelog:deleted')
                t.end()
              })
            })
          )
        })
      )
    })
  })

  tape('delete feed', (t) => {
    var ssb = createSSB('test-ssb-log9')
    var feed = createFeed(ssb, generate(), opts)

    t.plan(5)

    feed.add('msg', 'hello there!', function (err) {
      t.error(err)
      feed.add('msg', 'hello again!', function (err, msg) {
        t.error(err)
        ssb.del(msg.value.author, err => {
          t.error(err)
          pull(
            ssb.createFeedStream(),
            pull.drain(() => {
              t.fail('no messages should be available')
            }, () => {
              ssb.get(msg.key, (err) => {
                t.ok(err)
                t.equal(err.code, 'flumelog:deleted')
                t.end()
              })
            })
          )
        })
      })
    })
  })
}

if (!module.parent) { module.exports({}) }
