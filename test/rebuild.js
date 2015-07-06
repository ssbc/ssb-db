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

  var db = sublevel(level('test-ssb-rebuild', {
    valueEncoding: opts.codec
  }))

  var ssb = require('../')(db, opts)

  var alice = createFeed(ssb, ssbKeys.generate(), opts)
  var bob   = createFeed(ssb, ssbKeys.generate(), opts)
  var carol = createFeed(ssb, ssbKeys.generate(), opts)
  var msg, reply1, reply2


  tape('needs rebuild', function (t) {
    ssb.needsRebuild(function (err, b) {
      t.assert(!err)
      t.equal(b, true)
      t.end()
    })
  })

  tape('reply to a message', function (t) {

    alice.add('msg', 'hello world', function (err, m) {
        msg = m

        console.log(msg)

        bob.add('msg', {
          reply: {msg: msg.key},
          content: 'okay then'
        }, function (err, r1) {
          reply1 = r1
          console.log(reply1)
          carol.add('msg', {
            reply: {msg: msg.key},
            content: 'whatever'
          }, function (err, r2) {
            reply2 = r2
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

  function dumpIndex (cb) {
    db.sublevel('idx').createReadStream({ 
        keys   :  true
      , values :  true
    })
    .on('data', console.log)
    .on('error', cb) 
    .on('close', cb)
  }

  tape('rebuild index', function (t) {
    dumpIndex(function () {
      ssb.rebuildIndex(function (err) {
        t.assert(!err)
        pull(
          ssb.messagesLinkedToMessage(msg.key, 'reply'),
          pull.collect(function (err, ary) {
            ary.sort(function (a, b) { return a.timestamp - b.timestamp })

            t.deepEqual(ary, [reply1.value, reply2.value])
            dumpIndex(function() { t.end() })
          })
        )
      })
    })
  })

  tape('doesnt need rebuild anymore', function (t) {
    ssb.needsRebuild(function (err, b) {
      t.assert(!err)
      t.equal(b, false)
      t.end()
    })
  })

}


if(!module.parent)
  module.exports(require('../defaults'))

