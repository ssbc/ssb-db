'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var createSSB = require('./util/create-ssb')
var createFeed = require('ssb-feed')
var ssbKeys = require('ssb-keys')

var generate = ssbKeys.generate

function run (opts = {}) {
  tape('del (delete message)', (t) => {
    var ssb = createSSB('test-ssb-log8')

    var feed = createFeed(ssb, generate(), opts)
    t.plan(5)

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
                ssb.close(err => {
                  t.error(err, 'ssb.close - del (delete message)')
                  t.end()
                })
              })
            })
          )
        })
      )
    })
  })

  tape('del (delete feed)', (t) => {
    var ssb = createSSB('test-ssb-log9')
    var feed = createFeed(ssb, generate(), opts)

    t.plan(6)

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
                ssb.close(err => {
                  t.error(err, 'ssb.close - del (delete feed)')
                  t.end()
                })
              })
            })
          )
        })
      })
    })
  })
}
run()
