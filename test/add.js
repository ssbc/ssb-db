'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var crypto = require('crypto')

var createSSB = require('./util/create-ssb')

function run (opts) {
  var ssb = createSSB('test-ssb-add', {})
  var ssb2 = createSSB('test-ssb-add2', {})

  tape('add (invalid message)', function (t) {
    ssb.add({}, function (err) {
      t.ok(err)
      t.end()
    })
  })

  tape('add (null message)', function (t) {
    ssb.add(null, function (err) {
      t.ok(err)
      t.end()
    })
  })
  tape('add okay message', function (t) {
    ssb.publish({ type: 'okay' }, function (err, msg, key) {
      if (err) throw err
      ssb.get(msg.key, function (err, _msg) {
        if (err) throw err

        t.deepEqual(_msg, msg.value)
        ssb.get({ id: msg.key, meta: true }, function (_, _msg2) {
          t.deepEqual(_msg2, msg)

          ssb.publish({ type: 'wtf' }, function (err, msg) {
            if (err) throw err
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

  tape('add, createLogStream (createLogStream)', function (t) {
    pull(ssb.createLogStream({ keys: true, values: true }), pull.collect(function (err, ary) {
      if (err) throw err
      t.equal(ary.length, 2)
      t.end()
    }))
  })

  tape('add, createLogStream (values only)', function (t) {
    pull(
      ssb.createLogStream({ keys: false, values: true }),
      ssb2.createWriteStream(function (err, ary) {
        if (err) throw err
        t.end()
      })
    )
  })
  tape('add (close)', function (t) {
    ssb.close((err) => {
      t.error(err, 'ssb.close - add (close)')
      ssb2.close(err => {
        t.error(err, 'ssb2.close - add (close)')
        t.end()
      })
    })
  })

  tape('add/ publish (sign-cap)', function (t) {
    var opts = { caps: { sign: crypto.randomBytes(32).toString('base64') } }
    var ssb3 = createSSB('test-ssb-sign-cap', opts)
    ssb3.publish({ type: 'test', options: opts }, function (err, msg) {
      if (err) throw err
      t.deepEqual(msg.value.content.options, opts)
      ssb3.close(err => {
        t.error(err, 'ssb3.close - add/ publish (sign-cap)')
        t.end()
      })
    })
  })
}

run()
