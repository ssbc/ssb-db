var createSSB = require('../create')
var compare = require('typewiselite')
var pull = require('pull-stream')
var cont = require('cont')

var tape = require('tape')

var ssb = createSSB('/tmp/friends-test')
var friends = ssb.addApp(require('../apps/friends'))

var alice = ssb.createFeed()
var bob   = ssb.createFeed()
var carol = ssb.createFeed()

var all = function (stream) {
  return function (cb) {
    pull(stream, pull.collect(cb))
  }
}

tape('follows', function (t) {

  cont.para([
    friends.follow(alice, {friend: bob.id}),
    friends.follow(alice, {friend: carol.id}),
    friends.follow(bob, {friend: alice.id}),
    friends.follow(bob, {friend: carol.id})
  ]) (function (err) {
    if(err) throw err

    cont.para({
      alice:  all(friends.follows(alice.id)),
      bob:    all(friends.follows(bob.id)),
      _alice: all(friends.followers(alice.id)),
      _carol: all(friends.followers(carol.id))
    }) (function (err, r) {
      if(err) throw err
      console.log('*****', r)

      t.deepEqual(r.alice, [
        bob.id, carol.id
      ].sort(compare), 'alice follows')

      t.deepEqual(r.bob, [
        carol.id, alice.id
      ].sort(compare), 'bob follows')

      t.deepEqual(r._carol, [
        alice.id, bob.id
      ].sort(compare), 'followers of alice')

      t.deepEqual(r._alice, [
        bob.id
      ].sort(compare), 'followers of bob')

      t.end()

    })
  })
})

