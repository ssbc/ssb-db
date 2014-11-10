'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var cont     = require('cont')
var typewise = require('typewiselite')

module.exports = function (opts) {

  var db = sublevel(level('test-ssb-withdrawslink', {
    valueEncoding: require('../codec')
  }))

  var create = require('../message')(opts)
  var ssb = require('../')(db, opts)

  var alice = ssb.createFeed()
  var bob   = ssb.createFeed()


  tape('delete reply', function (t) {

    alice.add('msg', 'hello world', function (err, msg, msg_hash) {

        console.log(msg, msg_hash)

        bob.add('msg', {
          reply: {$msg: msg_hash, $rel: 'reply'},
          content: 'okay then'
        }, function (err, reply1, reply_hash) {
          console.log(reply1, reply_hash)
         
          pull(
            ssb.messagesLinkedToMessage(msg_hash, 'reply'),
            pull.collect(function (err, ary) {
              t.equal(ary[0].content.content, 'okay then')

              bob.add('nmjk', {
                $rel: 'withdraws',
                $msg: reply_hash
              }, function(err, withdraw, withdraw_hash) {
                if (err) throw err
                console.log(withdraw, withdraw_hash)

                pull(
                  ssb.messagesLinkedToMessage(msg_hash, 'reply'),
                  pull.collect(function (err, ary) {
                    if (err) throw err
                    t.equal(ary.length, 0)
                    t.end()
                  })
                )
              })
            })
          )

        })

    })

  })

  tape('delete follow', function (t) {

    console.log('FOLLOWING', bob.id)
    alice.add('flw', { $feed: bob.id, $rel: 'follow' }, function(err, follow, follow_hash) {
      console.log(follow_hash)

      pull(ssb.feedsLinkedFromFeed(alice.id, 'follow'), pull.collect(function(err, followers) {
        t.equal(followers.length, 1)
        t.equal(followers[0].source.toString('hex'), alice.id.toString('hex'))

        console.log('UNFOLLOWING')
        alice.add('nmjk', { $rel: 'withdraws', $msg: follow_hash }, function(err, withdraw, withdraw_hash) {
          console.log(withdraw_hash)

          pull(ssb.feedsLinkedFromFeed(alice.id, 'follow'), pull.collect(function(err, followers) {
            t.equal(followers.length, 0)
            t.end()
          }))
        })
      }))
    })
  })

}

if(!module.parent)
  module.exports(require('../defaults'))

