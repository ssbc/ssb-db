'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var cont     = require('cont')
var ssbKeys  = require('ssb-keys')
var createFeed = require('ssb-feed')


module.exports = function (opts) {

  var db = sublevel(level('test-ssb-related', {
    valueEncoding: opts.codec
  }))

  var ssb = require('../')(db, opts)

  var alice = createFeed(ssb, ssbKeys.generate(), opts)
  var bob   = createFeed(ssb, ssbKeys.generate(), opts)
  var charlie = createFeed(ssb, ssbKeys.generate(), opts)

  tape('simple', function (t) {

    alice.add({
      type: 'post',
      text: 'hello, world 1'
    }, function (err, msg) {
      if(err) throw err
      console.log(msg)

      bob.add({
        type: 'post',
        text: 'welcome! 1',
        'replies-to': msg.key
      }, function (err, msg2) {
        if(err) throw err

        ssb.relatedMessages({id: msg.key, count: true}, function (err, msgs) {

          console.log(msgs)

          t.deepEqual(msgs, {
            key: msg.key, value: msg.value,
            related: [
              msg2
            ],
            count: 1
          })

          t.end()
        })
      })
    })
  })

  tape('deeper', function (t) {

    alice.add({
      type: 'post',
      text: 'hello, world 2'
    }, function (err, msg) {
      if(err) throw err
      console.log(msg)

      bob.add({
        type: 'post',
        text: 'welcome! 2',
        'replies-to': msg.key
      }, function (err, msg2) {
        if(err) throw err

        charlie.add({
          type: 'post',
          text: 'hey hey 2',
          'replies-to': msg2.key
        }, function (err, msg3) {

          ssb.relatedMessages({id: msg.key, count: true}, function (err, msgs) {

            console.log(JSON.stringify(msgs, null, 2))

            t.deepEqual(msgs, {
              key: msg.key, value: msg.value,
              related: [
                {
                  key: msg2.key, value: msg2.value,
                  related: [
                    msg3
                  ],
                  count: 1
                }
              ],
              count: 2
            })

            t.end()

          })
        })
      })
    })
  })

  tape('shallow', function (t) {

    alice.add({
      type: 'post',
      text: 'hello, world 3'
    }, function (err, msg1) {
      if(err) throw err


      cont.para([
        bob.add({
          type: 'post',
          text: 'welcome! 3',
          'replies-to': msg1.key
        }),
        charlie.add({
          type: 'post',
          text: 'hey hey 3',
          'replies-to': msg1.key
        })
      ]) (function (err, ary) {
        if(err) throw err
        var msg2 = ary[0]
        var msg3 = ary[1]

        ssb.relatedMessages({id: msg1.key, count: true}, function (err, msgs) {

          console.log(JSON.stringify(msgs, null, 2))

          t.deepEqual(msgs, {
            key: msg1.key, value: msg1.value,
            related: [
              msg2, msg3
            ],
            count: 2
          })
          t.end()
        })
      })
    })
  })

  tape('parent, no counts', function (t) {

    alice.add({
      type: 'post',
      text: 'hello, world 4'
    }, function (err, msg) {
      if(err) throw err
      console.log(msg)

      bob.add({
        type: 'post',
        text: 'welcome! 4',
        'replies-to': msg.key
      }, function (err, msg2) {
        if(err) throw err

        ssb.relatedMessages({id: msg.key, parent: true}, function (err, msgs) {

          console.log(JSON.stringify(msgs, null, 2))

          t.deepEqual(msgs, {
            key: msg.key, value: msg.value,
            related: [
              {key: msg2.key, value: msg2.value, parent: msg.key}
            ]
          })

          t.end()
        })
      })
    })
  })


  tape('missing root message', function (t) {

    var msg1Key = '%HH88p+bzbBxVdse9gihlylVvM7uqswKXxcQfYCR5DGU=.sha256'
    // alice.add({
    //   type: 'post',
    //   text: 'hello, world 2'
    // }, function (err, msg) {
    //   if(err) throw err
    //   console.log(msg)

      bob.add({
        type: 'post',
        text: 'welcome! 2',
        'replies-to': msg1Key
      }, function (err, msg2) {
        if(err) throw err

        charlie.add({
          type: 'post',
          text: 'hey hey 2',
          'replies-to': msg2.key
        }, function (err, msg3) {

          ssb.relatedMessages({id: msg1Key, count: true}, function (err, msgs) {

            console.log(JSON.stringify(msgs, null, 2))

            t.deepEqual(msgs, {
              key: msg1Key, value: undefined,
              related: [
                {
                  key: msg2.key, value: msg2.value,
                  related: [
                    msg3
                  ],
                  count: 1
                }
              ],
              count: 2
            })

            t.end()

          })
        })
      })
    })
  // })

}



if(!module.parent)
  module.exports(require('../defaults'))

