'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var ssbKeys = require('ssb-keys')

var createSSB = require('./util/create-ssb')

function run (opts = {}) {
  var ssb = createSSB('test-ssb-write-stream')
  var create = require('ssb-feed/util').create

  tape('createWriteStream', function (t) {
    var keys = ssbKeys.generate()

    var prev
    var init = prev = create(keys, 'init', { public: keys.public }, null)
    var q = [init]

    var l = 5
    while (l--) {
      q.push(prev = create(keys, 'msg', { count: l }, prev))
    }

    pull(
      pull.values(q),
      pull.asyncMap(function (data, cb) {
        setTimeout(function () {
          cb(null, data)
        }, ~~(Math.random() * 500))
      }),
      ssb.createWriteStream(function (err) {
        t.error(err)
        t.end()
      })
    )
  })

  tape('createWriteStream (overwrite)', function (t) {
    var keys = ssbKeys.generate()

    var prev
    var init = prev = create(keys, 'init', { public: keys.public }, null)
    var q = [init]

    var l = 5
    while (l--) {
      q.push(prev = create(keys, 'msg', { count: l }, prev))
    }

    q.push(q[3])
    q.push(q[4])

    pull(
      pull.values(q),
      pull.asyncMap(function (data, cb) {
        setTimeout(function () {
          cb(null, data)
        }, ~~(Math.random() * 500))
      }),
      ssb.createWriteStream(function (err) {
        t.error(err)

        ssb.close(err => {
          t.error(err, 'ssb.close - createWriteStream')
          t.end()
        })
      })
    )
  })
}

run()
