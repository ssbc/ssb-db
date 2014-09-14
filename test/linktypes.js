'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var cont     = require('cont')
var typewise = require('typewiselite')

function sort (a) {
  return a.sort(function (a, b) {
    return (
       typewise(a.source, b.source)
    || typewise(a.rel, b.rel)
    || typewise(a.dest, b.dest)
    || typewise(a.message, b.message)
    )
  })
}

module.exports = function (opts) {

  var db = sublevel(level('test-ssb-links', {
    valueEncoding: require('../codec')
  }))

  var create = require('../message')(opts)
  var ssb = require('../')(db, opts)

  var alice = ssb.createFeed()
  var bob   = ssb.createFeed()
  var carol = ssb.createFeed()


  tape('reply to a message', function (t) {

    alice.add('msg', 'hello world', function (err, msg, msg_hash) {

        console.log(msg, msg_hash)

        bob.add('msg', {
          reply: {$msg: msg_hash, $rel: 'reply'},
          content: 'okay then'
        }, function (err, reply1, reply_hash) {
          console.log(reply1, reply_hash)
          carol.add('msg', {
            reply: {$msg: msg_hash, $rel: 'reply'},
            content: 'whatever'
          }, function (err, reply2) {
            pull(
              ssb.messagesLinkedTo(msg_hash, 'reply'),
              pull.collect(function (err, ary) {
                ary.sort(function (a, b) { return a.timestamp - b.timestamp })

                t.deepEqual(ary, [reply1, reply2])
                t.end()
              })
            )
          })

        })

    })

  })

  var all = function (stream) {
    return function (cb) {
      pull(stream, pull.collect(cb))
    }
  }

  tape('follow another user', function (t) {

    function follow (a, b) {
      return function (cb) {
        a.add('flw', {$feed: b.id, $rel: 'follow'}, function (err, _, hash) {
          cb(err, hash)
        })
      }
    }



    cont.para({
      ab: follow(alice, bob),
      ac: follow(alice, carol),
      ba: follow(bob, alice),
      bc: follow(bob, carol),
    }) (function (err, f) {

      cont.para({
        alice:  all(ssb.feedsLinkedFrom(alice.id, 'follow')),
        bob:    all(ssb.feedsLinkedFrom(bob.id, 'follow')),
        _alice: all(ssb.feedsLinkedTo(alice.id, 'follow')),
        _carol: all(ssb.feedsLinkedTo(carol.id, 'follow'))
      }) (function (err, r) {

        console.log(r)

        t.deepEqual(sort(r.alice), sort([
          {source: alice.id, rel: 'follow', dest: bob.id, message: f.ab},
          {source: alice.id, rel: 'follow', dest: carol.id, message: f.ac}
        ]))

        t.deepEqual(sort(r.bob), sort([
          {source: bob.id, rel: 'follow', dest: alice.id, message: f.ba},
          {source: bob.id, rel: 'follow', dest: carol.id, message: f.bc}
        ]))

        t.deepEqual(sort(r._alice), sort([
          {source: bob.id, rel: 'follow', dest: alice.id, message: f.ba}
        ]))

        t.deepEqual(sort(r._carol), sort([
          {source: alice.id, rel: 'follow', dest: carol.id, message: f.ac},
          {source: bob.id, rel: 'follow', dest: carol.id, message: f.bc}
        ]), 'carol is followed by alice and bob')

        t.end()
      })
    })
  })

}

if(!module.parent)
  module.exports(require('../defaults'))

