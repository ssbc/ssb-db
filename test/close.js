
'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var ssbKeys  = require('ssb-keys')

var createFeed = require('ssb-feed')
var createSSB  = require('./util')

tape('load', function (t) {
  var create = require('ssb-feed/util').create

  var ssb = createSSB('test-ssb-feed')

  ssb.createFeed().add({type:'whatever'}, function (err, msg) {
    if(err) throw err
  //  t.end()
    console.log(msg)
    ssb.close(function () {
      t.end()
    })
  })
})

tape('reopen', function (t) {
  var ssb = createSSB('test-ssb-feed', {temp: false})

  pull(
    ssb.createLogStream(),
    pull.collect(function (err, ary) {
      console.log(ary, ssb.since.value)
      t.end()
    })
  )
})

