'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var keys = require('ssb-keys').generate()

var createSSB = require('./util/create-ssb')

var content = { type: 'whatever' }

const name = `test-ssb-close-${Date.now()}`

tape('close (loads and closes)', function (t) {
  t.plan(2)
  var ssb = createSSB(name, { keys, temp: false })

  ssb.publish(content, function (err, msg) {
    if (err) throw err

    ssb.close(function (err) {
      t.error(err)
      t.ok(true, 'closes + runs callback')
    })
  })
})

tape('close (reopen existing db)', function (t) {
  t.plan(2)
  var ssb = createSSB(name, { keys, temp: false })

  pull(
    ssb.createLogStream(),
    pull.collect(function (err, ary) {
      if (err) throw err

      t.deepEqual(ary[0].value.content, content, 'reopen works fine')
      ssb.close((err) => {
        t.error(err)
      })
    })
  )
})
