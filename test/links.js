'use strict'

var tape = require('tape')
var pull = require('pull-stream')
var cont = require('cont')
var createSSB = require('./util')

function cmpstr (a, b) {
  return a < b ? -1 : a === b ? 0 : 1
}

function compare (a, b) {
  return cmpstr(a.key, b.key) || cmpstr(a.dest, b.dest) || cmpstr(a.rel, b.rel)
//  return a.key < b.key ? -1 : a.key === b.key ? 0 : -1
}

module.exports = function (opts) {
  var db = createSSB('test-ssb-feed')

  var alice = db.createFeed()
  var bob = db.createFeed()

  var msgs = []

  var fromAlice = []

  pull(
    db.links({ source: alice.id, old: false, live: true }),
    pull.drain(fromAlice.push.bind(fromAlice))
  )

  tape('initialize', function (t) {
    cont.para([
      alice.add({ type: 'yo!', yo: alice.id }),
      alice.add({ type: 'contact', follow: bob.id, okay: true }),
      bob.add({ type: 'poke', poke: alice.id }),
      alice.add({ type: 'poke', poke: alice.id })
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
      db.links({ rel: 'yo' }),
      pull.through(function (data) {
        t.ok(data.key)
        delete data.key
      }),
      pull.collect(function (err, ary) {
        t.notOk(err)
        t.deepEqual(ary, [{ source: alice.id, rel: 'yo', dest: alice.id }])
        console.log(ary)
        t.end()
      })
    )
  })

  function createTest (t) {
    return function test (name, query, results) {
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
      key: msgs[4].key
    }
    test('equal, query dest: %',
      { dest: '%' }, [mention])
    test('equal, query exact dest: %...',
      { dest: msgs[2].key }, [mention])
    test('equal, query dest: %..., rel: mentions',
      { dest: msgs[2].key, rel: 'mentions' }, [mention])
  })

  tape('realtime', function (t) {
    console.log(fromAlice, alice.id)
    pull(
      db.links({ source: alice.id, old: true }),
      pull.collect(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 3)
        t.equal(fromAlice.length, 3)
        t.deepEqual(fromAlice.sort(compare), ary.sort(compare))
        t.end()
      })
    )
  })

  tape('live link values', function (t) {
    var msg
    pull(
      db.links({ old: false, live: true, values: true }),
      pull.drain(function (data) {
        t.deepEqual(data, {
          key: msg.key,
          value: msg.value,
          source: alice.id,
          dest: bob.id,
          rel: 'foo'
        })
        t.end()
      })
    )

    alice.publish({ type: 'foo', foo: bob.id }, function (err, _msg) {
      msg = _msg
      t.error(err, 'publish')
    })
  })
}

if (!module.parent) { module.exports({}) }
