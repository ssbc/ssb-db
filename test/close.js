
'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var ssbKeys  = require('ssb-keys')
var createFeed = require('ssb-feed')


tape('load', function (t) {
  var create = require('ssb-feed/util').create

  var db = sublevel(level('test-ssb-feed', {
    valueEncoding: require('../codec')
  }))

  var ssb = require('../')(db, {})

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
  var db = sublevel(level('test-ssb-feed', {
    valueEncoding: require('../codec')
  }))

  var ssb = require('../')(db, {})

  pull(
    ssb.createLogStream(),
    pull.collect(function (err, ary) {
      console.log(ary, ssb.since.value)
      t.end()
    })
  )
})





