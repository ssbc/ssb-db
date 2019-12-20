'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var cont = require('cont')
var typewise = require('typewiselite')
var ssbKeys = require('ssb-keys')

var createSSB = require('./util')
var createFeed = require('ssb-feed')

function sort (a) {
  return a.sort(function (a, b) {
    return (
      typewise(a.source, b.source) ||
    typewise(a.rel, b.rel) ||
    typewise(a.dest, b.dest) ||
    typewise(a.message, b.message)
    )
  })
}

module.exports = function (opts) {
  var ssb = createSSB('test-ssb-links')

  var all = function (stream) {
    return function (cb) {
      pull(stream, pull.collect(cb))
    }
  }

  var alice = createFeed(ssb, ssbKeys.generate(), opts)
  var bob = createFeed(ssb, ssbKeys.generate(), opts)
  var carol = createFeed(ssb, ssbKeys.generate(), opts)

  function sortTS (ary) {
    return ary.sort(function (a, b) {
      return (
        a.timestamp - b.timestamp ||
        typewise(a.key, b.key) ||
        typewise(a.author, b.author)
      )
    })
  }
  function toKV (data) {
    return { key: data.key, value: data.value }
  }
  tape('reply to a message', function (t) {
    alice.add({ type: 'msg', value: 'hello world' }, function (err, msg) {
      if (err) throw err
      msg = toKV(msg)
      bob.add({
        type: 'msg',
        reply: msg.key,
        text: 'okay then'
      }, function (err, reply1) {
        if (err) throw err
        reply1 = toKV(reply1)

        carol.add({
          type: 'msg',
          reply: msg.key,
          text: 'whatever'
        }, function (err, reply2) {
          if (err) throw err
          reply2 = toKV(reply2)

          console.log('LINKS', {
            dest: msg.key,
            rel: 'reply',
            meta: false,
            keys: false,
            values: true
          })

          cont.series([
            function (cb) {
              all(ssb.links({
                dest: msg.key,
                rel: 'reply',
                meta: false,
                keys: false,
                values: true
              }))(function (err, ary) {
                if (err) throw err
                t.deepEqual(sortTS(ary), sortTS([reply1.value, reply2.value]))
                cb()
              })
            },
            function (cb) {
              all(ssb.links({
                dest: msg.key,
                rel: 'reply',
                keys: true,
                meta: false,
                values: true
              }))(function (err, ary) {
                if (err) throw err

                t.deepEqual(sortTS(ary), sortTS([reply1, reply2]))

                cb()
              })
            },
            function (cb) {
              all(ssb.links({
                dest: msg.key,
                rel: 'reply',
                values: true
              }))(function (err, ary) {
                if (err) throw err

                t.deepEqual(sort(ary), sort([
                  {
                    source: reply1.value.author,
                    rel: 'reply',
                    dest: msg.key,
                    key: reply1.key,
                    value: reply1.value
                  },
                  {
                    source: reply2.value.author,
                    rel: 'reply',
                    dest: msg.key,
                    key: reply2.key,
                    value: reply2.value
                  }
                ]))
                cb()
              })
            }
          ])(function (err) {
            if (err) throw err; t.end()
          })
        })
      })
    })
  })

  tape('follow another user', function (t) {
    function follow (a, b) {
      return function (cb) {
        a.add('follow', { follow: b.id }, function (err, msg) {
          cb(err, msg.key)
        })
      }
    }

    cont.para({
      ab: follow(alice, bob),
      ac: follow(alice, carol),
      ba: follow(bob, alice),
      bc: follow(bob, carol)
    })(function (err, f) {
      if (err) throw err
      cont.para({
        alice: all(ssb.links({ source: alice.id, dest: '@' })),
        bob: all(ssb.links({ source: bob.id, dest: 'feed' })),
        _alice: all(ssb.links({ dest: alice.id, source: '@' })),
        _carol: all(ssb.links({ dest: carol.id, source: 'feed' }))
      })(function (err, r) {
        if (err) throw err

        console.log({
          alice: alice.id,
          bob: bob.id,
          carol: carol.id

        })

        t.deepEqual(sort(r.alice), sort([
          { source: alice.id, rel: 'follow', dest: bob.id, key: f.ab },
          { source: alice.id, rel: 'follow', dest: carol.id, key: f.ac }
        ]))

        t.deepEqual(sort(r.bob), sort([
          { source: bob.id, rel: 'follow', dest: alice.id, key: f.ba },
          { source: bob.id, rel: 'follow', dest: carol.id, key: f.bc }
        ]))

        t.deepEqual(sort(r._alice), sort([
          { source: bob.id, rel: 'follow', dest: alice.id, key: f.ba }
        ]))

        t.deepEqual(sort(r._carol), sort([
          { source: alice.id, rel: 'follow', dest: carol.id, key: f.ac },
          { source: bob.id, rel: 'follow', dest: carol.id, key: f.bc }
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
            rel: 'follow'
          }),
          pull.collect(function (_, ary) {
            cb(null, ary.length > 0)
          })
        )
      }
    }

    cont.para({
      alice_bob: follows(alice.id, bob.id),
      alice_carol: follows(alice.id, carol.id),
      bob_alice: follows(bob.id, alice.id),
      bob_carol: follows(bob.id, carol.id),
      carol_alice: follows(carol.id, alice.id),
      carol_bob: follows(carol.id, bob.id)
    })(function (err, result) {
      if (err) throw err
      t.deepEqual(result, {
        alice_bob: true,
        alice_carol: true,
        bob_alice: true,
        bob_carol: true,
        carol_alice: false,
        carol_bob: false
      })
      t.end()
    })
  })

  tape('scan links with unknown rel', function (t) {
    alice.add({
      type: 'poke',
      poke: bob.id
    }, function (err) {
      if (err) throw err
      all(ssb.links({
        source: alice.id, dest: bob.id, values: true
      }))(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 2)
        t.deepEqual(ary.map(function (e) {
          return e.value.content
        }), [
          { type: 'follow', follow: bob.id },
          { type: 'poke', poke: bob.id }
        ])
        t.end()
      })
    })
  })
}

if (!module.parent) { module.exports({}) }
