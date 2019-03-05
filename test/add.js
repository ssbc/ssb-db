'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var crypto = require('crypto')

var createSSB = require('./util')

module.exports = function (opts) {
  var ssb = createSSB('test-ssb-feed', {})
  var ssb2 = createSSB('test-ssb-feed2', {})

  tape('add invalid message', function (t) {
    ssb.add({}, function (err) {
      t.ok(err)
      t.end()
    })
  })

  tape('add null message', function (t) {
    ssb.add(null, function (err) {
      t.ok(err)
      t.end()
    })
  })
  tape('add okay message', function (t) {
    var f = ssb.createFeed()

    f.add({ type: 'okay' }, function (err, msg, key) {
      if (err) throw err
      console.log(msg, key)
      ssb.get(msg.key, function (err, _msg) {
        if (err) throw err

        t.deepEqual(_msg, msg.value)
        ssb.get({id:msg.key, meta: true}, function (err, _msg2) {
          t.deepEqual(_msg2, msg)

          f.add({ type: 'wtf' }, function (err, msg) {
            if (err) throw err
            console.log(msg)
            ssb.get(msg.key, function (err, _msg) {
              if (err) throw err
              t.deepEqual(_msg, msg.value)
              t.end()
            })
          })
        })
      })
    })
  })

  tape('log', function (t) {
    pull(ssb.createLogStream({ keys: true, values: true }), pull.collect(function (err, ary) {
      console.log(err, ary)
      if (err) throw err
      console.log(ary)
      t.equal(ary.length, 2)
      t.end()
    }))
  })

  tape('log', function (t) {
    pull(
      ssb.createLogStream({ keys: false, values: true }),
      ssb2.createWriteStream(function (err, ary) {
        if (err) throw err
        t.end()
      })
    )
  })

  tape('sign-cap', function (t) {
    var opts = { caps: { sign: crypto.randomBytes(32).toString('base64') } }
    var ssb = createSSB('test-ssb-sign-cap', opts)
    ssb.createFeed().add({ type: 'test', options: opts }, function (err, msg) {
      if (err) throw err
      console.log(msg)
      t.deepEqual(msg.value.content.options, opts)
      t.end()
    })
  })
}

if (!module.parent) { module.exports({}) }

