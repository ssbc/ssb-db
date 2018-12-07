'use strict'
var tape = require('tape')
var pull = require('pull-stream')

var createSSB = require('./util')

tape('load', function (t) {
  var ssb = createSSB('test-ssb-feed')

  ssb.createFeed().add({ type: 'whatever' }, function (err, msg) {
    if (err) throw err
    //  t.end()
    console.log(msg)
    ssb.close(function () {
      t.end()
    })
  })
})

tape('reopen', function (t) {
  var ssb = createSSB('test-ssb-feed', { temp: false })

  pull(
    ssb.createLogStream(),
    pull.collect(function (err, ary) {
      if (err) throw err
      console.log(ary, ssb.since.value)
      t.end()
    })
  )
})
