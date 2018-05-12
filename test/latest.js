'use strict'

var tape       = require('tape')
var level      = require('level-test')()
var sublevel   = require('level-sublevel/bytewise')
var pull       = require('pull-stream')
var ssbKeys    = require('ssb-keys')
var createFeed = require('ssb-feed')
var cont       = require('cont')

var createSSB  = require('./util')
var create = require('ssb-feed/util').create

var opts = require('../defaults')

var db = createSSB('test-ssb-latest')

var alice = db.createFeed()
var bob = db.createFeed()
var carol = db.createFeed()

var start = Date.now()

//LEGACY: uses feed.add as a continuable
tape ('empty', function(t) {
  cont.para([
  ])(function (err) {
    if(err) throw err
    pull(
      db.latest(),
      pull.collect(function (err, ary) {
        t.equal(ary.length, 0)
      }))
      t.end()
  })
})

tape('latest', function (t) {

  cont.para([
    cont.to(alice.add)({type: 'post', text: 'hello'}),
    cont.to(bob  .add)({type: 'post', text: 'hello'}),
    cont.to(carol.add)({type: 'post', text: 'hello'}),
  ])(function (err) {
    if(err) throw err
    var end = Date.now()
    pull(
      db.latest(),
      pull.collect(function (err, ary) {
        if(err) throw err
        t.equal(ary.length, 3)
        var n = ary.map(function (v) {
          t.equal(v.sequence, 1)
          t.ok(v.ts >= start)
          t.ok(v.ts <= end)
          return v.id
        })
        t.deepEqual(n.sort(), [alice.id, bob.id, carol.id].sort())
        console.log(ary)
        t.end()
      })
    )
  })
})



