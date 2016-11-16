'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var ssbKeys  = require('ssb-keys')
var createFeed = require('ssb-feed')

module.exports = function (opts) {
  var create = require('ssb-feed/util').create

  var db = sublevel(level('test-ssb-feed', {
    valueEncoding: require('../codec')
  }))

  console.log(db.location)

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
  tape('add okay message', function (t) {
    var f = ssb.createFeed()

    f.add({type: 'okay'}, function (err, msg, key) {
      if(err) throw err
      console.log(msg, key)
      ssb.get(msg.key, function (err, _msg) {
        if(err) throw err

        t.deepEqual(_msg, msg.value)
        f.add({type: 'wtf'}, function (err, msg) {
          console.log(msg)
          ssb.get(msg.key, function (err, _msg) {
            t.deepEqual(_msg, msg.value)
            t.end()
          })
        })
      })
    })
  })

  tape('log', function (t) {

    pull(ssb.createLogStream({keys: true, values: true}), pull.collect(function (err, ary) {
      console.log(err, ary)
      if(err) throw err
      console.log(ary)
      t.equal(ary.length, 2)
      t.end()
    }))

  })


}

if(!module.parent)
  module.exports(require('../defaults'))

