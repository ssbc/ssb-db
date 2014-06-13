var ScuttlebuttSecure = require('../')
var Feed = require('../feed')
var level = require('level-test')()
var tape = require('tape')
var ecc  = require('eccjs')
var k256 = ecc.curves.k256
var pull = require('pull-stream')
var u = require('../util')
var codec = require('../codec')

function create(name) {

  return ScuttlebuttSecure(
          level(name, {
            keyEncoding: codec, valueEncoding: codec
          })
        )
}
function writeMessages (feed, ary, cb) {
  pull(
    pull.values(ary),
    pull.asyncMap(function (m, cb) {
      feed.append('message', m, cb)
    }),
    pull.drain(null, cb)
  )
}


tape('lookup messages', function (t) {
  var db = create('scuttlebutt-secure-messages')

  var cbs = u.groups(next)

  var alice = db.feed(ecc.generate(k256))
  var bob   = db.feed(ecc.generate(k256))

  writeMessages(alice, [
    'hello there',
    'again again',
    'third time lucky'
  ], cbs())
  writeMessages(bob, [
    'foo bar baz',
    'apple banana cherry durian elderberry',
    'something else'
  ], cbs())

  function next (err) {
    if(err) throw err
    //request the feeds
    var cbs1 = u.groups(next2)

    pull(
      db.createTypeStream({type: 'message'}),
      pull.collect(cbs1())
    )
    pull(
      db.createTypeStream({type: 'message', id: alice.id, lookup: false}),
      pull.collect(cbs1())
    )
    pull(
      db.createTypeStream({type: 'message', id: bob.id, lookup: false}),
      pull.collect(cbs1())
    )

    function next2(err, results) {
      t.equal(results.length, 3)
      t.equal(results[0].length, 6)
      t.equal(results[1].length, 3)
      t.equal(results[2].length, 3)
      console.log(results)
      t.end()
    }
  }
})


tape('lookup messages', function (t) {
  var db = create('scuttlebutt-secure-follows')

  var cbs = u.groups(next)

  var alice = db.feed(ecc.generate(k256))
  var bob   = db.feed(ecc.generate(k256))

  alice.follow(bob.id, cbs())
  bob.follow(alice.id, cbs())

  function next (err) {
    if(err) throw err
    //request the feeds
    var cbs1 = u.groups(next2)


    pull(
      db.createReferenceStream({type: 'follow', id: alice.id}),
      pull.collect(cbs1())
    )
    pull(
      db.createReferenceStream({type: 'follow', id: bob.id}),
      pull.collect(cbs1())
    )

    function next2(err, results) {
      if(err) throw err
      console.log('*****', results)
      t.deepEqual(results[0][0].reference, bob.id)
      t.deepEqual(results[1][0].reference, alice.id)
      t.equal(results[0].length, 1)
      t.equal(results[1].length, 1)

      var cbs2 = u.groups(next3)

      pull(
        db.createReferencedStream({type: 'follow', referenced: alice.id}),
        pull.collect(cbs2())
      )
      pull(
        db.createReferencedStream({type: 'follow', referenced: bob.id}),
        pull.collect(cbs2())
      )

      function next3 (err, results) {
        console.log('*****', results)
        t.deepEqual(results[0][0].id, bob.id)
        t.deepEqual(results[1][0].id, alice.id)
        t.equal(results[0].length, 1)
        t.equal(results[1].length, 1)
        
        t.end()
      }
    }
  }
})

