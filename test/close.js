'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var keys = require('ssb-keys').generate()

var createSSB = require('./util/create-ssb')

var content = { type: 'whatever' }

const name = `test-ssb-close-${Date.now()}`

tape('load', function (t) {
  t.plan(1)
  var ssb = createSSB(name, { keys, temp: false })

  ssb.createFeed().add(content, function (err, msg) {
    if (err) throw err
    // console.log(msg)

    ssb.close(function () {
      t.ok(true, 'closes + runs callback')
    })
  })
})

tape('reopen', function (t) {
  t.plan(1)

  // HACK: See readme section on 'known bugs'.
  setTimeout(() => {
    var ssb = createSSB(name, { keys, temp: false })

    pull(
      ssb.createLogStream(),
      pull.collect(function (err, ary) {
        if (err) throw err

        t.deepEqual(ary[0].value.content, content, 'reopen works fine')
      })
    )
  }, 100)
})
