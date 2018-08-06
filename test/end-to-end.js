'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var ssbKeys  = require('ssb-keys')

var createFeed = require('ssb-feed')
var createSSB  = require('./util')

module.exports = function (opts) {

  var alice = ssbKeys.generate()
  var bob = ssbKeys.generate()

  var ssb = createSSB('test-ssb', {keys: alice})

  var feed = ssb.createFeed(alice)

  tape('add encrypted message', function (t) {

    var boxed = ssbKeys.box({type: 'secret', okay: true}, [alice.public, bob.public])

    ssb.post(function (msg) {
      t.equal('string', typeof msg.value.content, 'messages should not be decrypted')
    })

    feed.add(boxed, function (err, msg) {
      if(err) throw err
      t.notOk(err)

      pull(
        ssb.messagesByType('secret'),
        pull.collect(function (err, ary) {
          if(err) throw err
          var ctxt = ary[0].value.content
          var content = ssbKeys.unbox(ctxt, alice.private)
          t.deepEqual(content, {type: 'secret', okay: true}, 'alice can decrypt')

          //bob can also decrypt
          var content2 = ssbKeys.unbox(ctxt, bob.private)
          t.deepEqual(content, {type: 'secret', okay: true}, 'bob can decrypt')

          t.end()
        })
      )
    })
  })


  tape('add encrypted message', function (t) {

    ssb.post(function (msg) {
      t.equal('string', typeof msg.value.content, 'messages should not be decrypted')
    })

    //secret message sent to self
    feed.add({
      recps: feed.id,
      type: 'secret2', secret: "it's a secret!"
    }, function (err, msg) {
      if(err) throw err
      t.notOk(err)

      pull(
        ssb.messagesByType('secret2'),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 1)
          var ctxt = ary[0].value.content

          //bob can also decrypt
          var content = ssbKeys.unbox(ctxt, alice.private)
          t.deepEqual(content, {
            type: 'secret2', secret: "it's a secret!",
            recps: [alice.id]
          }, 'alice can decrypt')

          t.end()
        })
      )

    })

  })

  tape('error on invalid recps', function (t) {
    feed.add({
      recps: true, type:'invalid'
    }, function (err) {
      t.ok(err)
      feed.add({
        recps: [], type:'invalid'
      }, function (err) {
        t.ok(err)
        feed.add({
          recps: [feed.id, true], type:'invalid'
        }, function (err) {
          t.ok(err)
          t.end()
        })
      })
    })

  })

  tape('retrive already decrypted messages via private: true', function (t) {

    pull(
      ssb.messagesByType({type:'secret', private: true}),
      pull.collect(function (err, ary) {
        if(err) throw err
        var content = ary[0].value.content
        t.deepEqual(content, {type: 'secret', okay: true}, 'alice can decrypt')

        t.end()
      })
    )

  })


  tape('test indexes on end-to-end messages', function (t) {


    feed.add(ssbKeys.box({
      type: 'secret', okay: true
      }, [alice.public, bob.public]
    ), function (err, msg) {
      feed.add(ssbKeys.box({
          type: 'secret', post: 'wow', reply: msg.key
        }, [alice.public, bob.public]
      ), function (err, msg2) {

        pull(
          ssb.links({dest: msg.key, type: 'msg', keys: false}),
          pull.collect(function (err, ary) {
            t.deepEqual(ary, [{
              source: msg2.value.author, rel: 'reply',
              dest: msg.key
            }])
            t.end()
          })
        )
      })
    })
  })

}

if(!module.parent)
  module.exports(require('../defaults'))

