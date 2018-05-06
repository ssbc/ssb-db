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
          //very important: test that reboxed messages still verify
          //this was broken in 11.3, fixed by arj03.
          ary.forEach(function (data) {
            t.ok(ssbKeys.verifyObj(data.value.author, null, data.value))
          })
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


  tape('retrive already decrypted messages via private: true', function (t) {

    pull(
      ssb.messagesByType({type:'secret', private: true}),
      pull.collect(function (err, ary) {
        if(err) throw err
        var content = ary[0].value.content
        t.deepEqual(content, {type: 'secret', okay: true}, 'alice can decrypt')
        ssb.get(ary[0].key, function (err, msg) {
          if(err) throw err
          t.ok(msg)
          t.deepEqual(
            ssbKeys.unboxBody(msg.content, ary[0].value.unbox),
            {type: 'secret', okay: true}
          )
          t.end()
        })
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

  tape('test unbox message not addressed to us', function (t) {

    feed.add(ssbKeys.box({
      type: 'secret', okay: true, hidden: alice.id
      }, [bob.public]
    ), function (err, data) {
      ssb.get({id:data.key, private: true}, function (err, msg) {
        console.log(err, msg, data)
        //assert that this message is undecrypted
        //(it was not addressed to us)
        t.equal(typeof data.value.content, 'string')
        var key = ssbKeys.unboxKey(data.value.content, bob).toString('base64')
        t.ok(key)
        ssb.get({
          id:data.key, private: true, unbox: key
        }, function (err, msg2) {
          console.log(msg2)
          t.deepEqual(msg2.content, {
            type: 'secret', okay: true,
            hidden: alice.id
          })
          t.end()
        })
      })
    })
  })

}

if(!module.parent)
  module.exports(require('../defaults'))

