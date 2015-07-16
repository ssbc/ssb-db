'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var cont     = require('cont')
var typewise = require('typewiselite')
var ssbKeys  = require('ssb-keys')
var createFeed = require('ssb-feed')

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

  var ssb = require('../')(db, opts)

  var all = function (stream) {
    return function (cb) {
      pull(stream, pull.collect(cb))
    }
  }

  var alice = createFeed(ssb, ssbKeys.generate(), opts)
  var bob   = createFeed(ssb, ssbKeys.generate(), opts)
  var carol = createFeed(ssb, ssbKeys.generate(), opts)

  function sortTS (ary) {
    return ary.sort(function (a, b) {
      console.log(a, b)
      return (
          a.timestamp - b.timestamp
        || typewise(a.key, b.key)
        || typewise(a.author, b.author)
      )
    })
  }

  tape('reply to a message', function (t) {

    alice.add('msg', 'hello world', function (err, msg) {
      if(err) throw err
      bob.add('msg', {
        reply: {msg: msg.key},
        text: 'okay then'
      }, function (err, reply1) {
        if(err) throw err
        carol.add('msg', {
          reply: {msg: msg.key},
          text: 'whatever'
        }, function (err, reply2) {
          if(err) throw err

          cont.series([
            function (cb) {
              all(ssb.links({
                dest: msg.key, type: 'msg', rel: 'reply',
                meta: false, keys: false, values: true
              })) (function (err, ary) {
                if(err) throw err
                console.log(ary)
                console.log(reply1, reply2)
                t.deepEqual(sortTS(ary), sortTS([reply1.value, reply2.value]))
                cb()
              })
            },
            function (cb) {
              all(ssb.links({
                dest: msg.key, rel: 'reply', type: 'msg',
                keys: true, meta: false, values: true
              }))
                (function (err, ary) {
                  t.deepEqual(sortTS(ary), sortTS([reply1, reply2]))

                  cb()
                })
            },
            function (cb) {
              all(ssb.links({dest: msg.key, rel: 'reply', type: 'msg', values: true}))
                (function (err, ary) {
                  if(err) throw err
                  t.deepEqual(sort(ary), sort([
                    {
                      source: reply1.key, rel: 'reply',
                      dest: msg.key, key: reply1.key,
                      value: reply1.value
                    },
                    {
                      source: reply2.key, rel: 'reply',
                      dest: msg.key, key: reply2.key,
                      value: reply2.value
                    }
                  ]))
                  cb()
                })
            }
          ]) (function (err) {
            if(err) throw err; t.end()
          })
        })
      })
    })
  })

  tape('follow another user', function (t) {

    function follow (a, b) {
      return function (cb) {
        a.add('follow', {follow:{feed: b.id}}, function (err, msg) {
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
        alice:  all(ssb.links({source: alice.id, type:'feed', rel:'follow'})),
        bob:    all(ssb.links({source: bob.id, type: 'feed', rel: 'follow'})),
        _alice: all(ssb.links({dest: alice.id, rel:'follow', type: 'feed'})),
        _carol: all(ssb.links({dest: carol.id, rel: 'follow', type: 'feed'}))
      }) (function (err, r) {

        console.log({
          alice: alice.id,
          bob: bob.id,
          carol: carol.id,

        })

        t.deepEqual(sort(r.alice), sort([
          {source: alice.id, rel: 'follow', dest: bob.id, key: f.ab},
          {source: alice.id, rel: 'follow', dest: carol.id, key: f.ac}
        ]))

        t.deepEqual(sort(r.bob), sort([
          {source: bob.id, rel: 'follow', dest: alice.id, key: f.ba},
          {source: bob.id, rel: 'follow', dest: carol.id, key: f.bc}
        ]))

        t.deepEqual(sort(r._alice), sort([
          {source: bob.id, rel: 'follow', dest: alice.id, key: f.ba}
        ]))

        t.deepEqual(sort(r._carol), sort([
          {source: alice.id, rel: 'follow', dest: carol.id, key: f.ac},
          {source: bob.id, rel: 'follow', dest: carol.id, key: f.bc}
        ]), 'carol is followed by alice and bob')

        t.end()
      })
    })
  })

  tape('check for 1:1 relationships', function (t) {
    function follows (a, b) {
      return function (cb) {
        pull(
          ssb.links({
            source: a,
            dest: b,
            type: 'feed',
            rel: 'follow'
          }),
          pull.collect(function (_, ary) {
            cb(null, ary.length > 0)
          })
        )
      }
    }

    cont.para({
      alice_bob:   follows(alice.id, bob  .id),
      alice_carol: follows(alice.id, carol.id),
      bob_alice:   follows(bob  .id, alice.id),
      bob_carol:   follows(bob  .id, carol.id),
      carol_alice: follows(carol.id, alice.id),
      carol_bob:   follows(carol.id, bob  .id)
    })
    (function (err, result) {
      if(err) throw err
      t.deepEqual(result, {
        alice_bob: true,
        alice_carol: true,
        bob_alice: true,
        bob_carol: true,
        carol_alice: false,
        carol_bob: false,
      })
      t.end()
    })

  })

  tape('scan links with unknown rel', function (t) {
    alice.add({
      type: 'poke',
      poke: {feed: bob.id}
    }, function (err) {
      all(ssb.links({
        source: alice.id, dest: bob.id, type: 'feed',
        values: true
      }))
      (function (err, ary) {
        if(err) throw err
        t.equal(ary.length, 2)
        t.deepEqual(ary.map(function (e) {
          return e.value.content
        }), [
          {type: 'follow', follow: {feed: bob.id}},
          {type: 'poke', poke: {feed: bob.id}},
        ])
        t.end()

      })
    })

  })

}



if(!module.parent)
  module.exports(require('../defaults'))

