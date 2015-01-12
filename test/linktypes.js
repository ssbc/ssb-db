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
    valueEncoding: opts.codec
  }))

  var create = require('../message')(opts)
  var ssb = require('../')(db, opts)

  var alice = ssb.createFeed()
  var bob   = ssb.createFeed()
  var carol = ssb.createFeed()


  tape('reply to a message', function (t) {

    alice.add('msg', 'hello world', function (err, msg) {

        console.log(msg)

        bob.add('msg', {
          reply: {msg: msg.key, rel: 'reply'},
          content: 'okay then'
        }, function (err, reply1) {
          console.log(reply1)
          carol.add('msg', {
            reply: {msg: msg.key, rel: 'reply'},
            content: 'whatever'
          }, function (err, reply2) {
            pull(
              ssb.messagesLinkedToMessage(msg.key, 'reply'),
              pull.collect(function (err, ary) {
                ary.sort(function (a, b) { return a.timestamp - b.timestamp })

                t.deepEqual(ary, [reply1.value, reply2.value])
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
        a.add('flw', {feed: b.id, rel: 'follow'}, function (err, msg) {
          cb(err, msg.key)
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
        alice:  all(ssb.feedsLinkedFromFeed(alice.id, 'follow')),
        bob:    all(ssb.feedsLinkedFromFeed(bob.id, 'follow')),
        _alice: all(ssb.feedsLinkedToFeed(alice.id, 'follow')),
        _carol: all(ssb.feedsLinkedToFeed(carol.id, 'follow'))
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

