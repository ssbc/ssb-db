'use strict'

var tape       = require('tape')
var level      = require('level-test')()
var sublevel   = require('level-sublevel/bytewise')
var pull       = require('pull-stream')
var ssbKeys    = require('ssb-keys')
var createFeed = require('ssb-feed')
var cont       = require('cont')

module.exports = function (opts) {
  var create = require('ssb-feed/util').create

  var db = sublevel(level('test-ssb-feed', {
    valueEncoding: opts.codec
  }))

  var db = require('../')(db, opts)

  var alice = db.createFeed(opts.generate())
  var bob = db.createFeed(opts.generate())

  var msgs = []

  tape('initialize', function (t) {

    cont.para([
      alice.add({type: 'yo!', yo: alice.id}),
      alice.add({type: 'contact', follow: bob.id, okay: true}),
      bob.add({type: 'poke', poke: alice.id}),
      alice.add({type: 'poke', poke: alice.id})
    ])(function (err, _msgs) {
      msgs = _msgs
      t.notOk(err)
      bob.add({
        type: 'post', mentions: [msgs[2].key], text: 'okay then'
      }, function (err, msg) {
        msgs.push(msg)
        t.notOk(err); t.end()
      })
    })

  })


  tape('query only rel type', function (t) {
    
    pull(
      db.links({rel: 'yo'}),
      pull.through(function (data) {
        t.ok(data.key)
        delete data.key
      }),
      pull.collect(function (err, ary) {
        t.notOk(err)
        t.deepEqual(ary, [{source: alice.id, rel: 'yo', dest: alice.id}])
        console.log(ary)
        t.end()
      })
    )
  })

  function createTest (t) {
    return function test(name, query, results) {
      t.test(name, function (t) {
        pull(
          db.links(query),
          pull.collect(function (err, ary) {
            t.notOk(err)
            t.equal(ary.length, results.length)
            t.deepEqual(ary, results)
            t.end()
          })
        )
      })
    }
  }

  tape('query by dest', function (t) {
    var test = createTest(t)
    var mention = {
      source: bob.id,
      rel: 'mentions',
      dest: msgs[2].key,
      key: msgs[4].key,
    }
    test('equal, query dest: %',
      {dest: '%'}, [mention])
    test('equal, query exact dest: %...',
      {dest: msgs[2].key}, [mention])
    test('equal, query dest: %..., rel: mentions',
      {dest: msgs[2].key, rel: 'mentions'}, [mention])
  })

}

if(!module.parent)
  module.exports(require('../defaults'))

