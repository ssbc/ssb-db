'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var ssbKeys  = require('ssb-keys')
var createFeed = require('ssb-feed')

module.exports = function (opts) {

  var db = sublevel(level('test-ssb-feed', {
    valueEncoding: require('../codec')
  }))

  var alice = ssbKeys.generate()
  var bob = ssbKeys.generate()

  var ssb = require('../')(db, opts, alice)

  var feed = ssb.createFeed(alice)

  tape('add encrypted message', function (t) {

    var boxed = ssbKeys.box({type: 'secret', okay: true}, [alice.public, bob.public])

    feed.add(boxed, function (err, msg) {

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

  function toKV (data) { return {key: data.key, value: data.value}}

  //LEGACY: move this test into a legacy section.
  //patchwork@3 doesn't need this, can probably kill it now.
  tape('related-messages', function (t) {
    feed.add(ssbKeys.box({
      type: 'secret', okay: true
      }, [alice.public, bob.public]
    ), function (err, msg) {
      msg = toKV(msg)
      feed.add(ssbKeys.box({
          type: 'secret', post: 'wow', reply: msg.key
        }, [alice.public, bob.public]
      ), function (err, msg2) {
        msg2 = toKV(msg2)
        console.log("MSG2", msg2)
        ssb.relatedMessages({key: msg.key, rel: 'reply'},
          function (err, msgs) {
            console.log("MSGS", msgs)
            msg.related = [msg2]
            console.log(msg)
            t.deepEqual(msgs, msg)
            t.end()
            
          })
      })
    })

  })

}

if(!module.parent)
  module.exports(require('../defaults'))

