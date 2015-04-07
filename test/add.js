'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var ssbKeys  = require('ssb-keys')
var createFeed = require('ssb-feed')

module.exports = function (opts) {
  var create = require('ssb-feed/message')(opts)

  var db = sublevel(level('test-ssb-feed', {
    valueEncoding: opts.codec
  }))

  var ssb = require('../')(db, opts)

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


}

if(!module.parent)
  module.exports(require('../defaults'))

