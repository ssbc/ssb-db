'use strict'

var tape       = require('tape')
var level      = require('level-test')()
var sublevel   = require('level-sublevel/bytewise')
var pull       = require('pull-stream')
var ssbKeys    = require('ssb-keys')
var createFeed = require('ssb-feed')
var cont       = require('cont')

var create = require('ssb-feed/util').create

var opts = require('../defaults')

var db = require('../')(
    sublevel(level('test-ssb-feed', { valueEncoding: opts.codec })),
    opts
  )

var alice = db.createFeed()
var bob = db.createFeed()
var carol = db.createFeed()

var start = Date.now()

tape('latest', function (t) {

  cont.para([
    alice.add({type: 'post', text: 'hello'}),
    bob  .add({type: 'post', text: 'hello'}),
    carol.add({type: 'post', text: 'hello'}),
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


