'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var ssbKeys = require('ssb-keys')
var createSSB = require('./util')

module.exports = function (opts) {
  var ssb = createSSB('test-ssb-feed')
  var create = require('ssb-feed/util').create

  tape('write-stream', function (t) {
    var keys = ssbKeys.generate()

    var prev
    var init = prev = create(keys, 'init', { public: keys.public }, null)
    var q = [init]

    var l = 5
    while (l--) {
      q.push(prev = create(keys, 'msg', { count: l }, prev))
    }

    console.log(q)

    pull(
      pull.values(q),
      pull.asyncMap(function (data, cb) {
        setTimeout(function () {
          cb(null, data)
        }, ~~(Math.random() * 500))
      }),
      ssb.createWriteStream(function (err) {
        if (err) throw err
        t.end()
      })
    )
  })

  tape('write-stream, overwrite', function (t) {
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

    console.log(q)

    pull(
      pull.values(q),
      pull.asyncMap(function (data, cb) {
        setTimeout(function () {
          cb(null, data)
        }, ~~(Math.random() * 500))
      }),
      ssb.createWriteStream(function (err) {
        if (err) throw err
        t.end()
      })
    )
  })
}

if (!module.parent) { module.exports({}) }
