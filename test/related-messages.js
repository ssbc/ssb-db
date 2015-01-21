'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var cont     = require('cont')

module.exports = function (opts) {

  tape('simple', function (t) {

    var db = sublevel(level('test-ssb-related', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var alice = ssb.createFeed()
    var bob = ssb.createFeed()
    var charlie = ssb.createFeed()

    alice.add({
      type: 'post',
      text: 'hello, world'
    }, function (err, msg) {
      if(err) throw err
      console.log(msg)

      bob.add({
        type: 'post',
        text: 'welcome!',
        'parent': { msg: msg.key, rel: 'replies-to' }
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

    var db = sublevel(level('test-related2', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var alice = ssb.createFeed()
    var bob = ssb.createFeed()
    var charlie = ssb.createFeed()


    alice.add({
      type: 'post',
      text: 'hello, world'
    }, function (err, msg) {
      if(err) throw err
      console.log(msg)

      bob.add({
        type: 'post',
        text: 'welcome!',
        'parent': { msg: msg.key, rel: 'replies-to' }
      }, function (err, msg2) {
        if(err) throw err

        charlie.add({
          type: 'post',
          text: 'hey hey',
          'parent': { msg: msg2.key, rel: 'replies-to' }
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

    var db = sublevel(level('test-related3', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var alice = ssb.createFeed()
    var bob = ssb.createFeed()
    var charlie = ssb.createFeed()


    alice.add({
      type: 'post',
      text: 'hello, world'
    }, function (err, msg1) {
      if(err) throw err


      cont.para([
        bob.add({
          type: 'post',
          text: 'welcome!',
          'parent': { msg: msg1.key, rel: 'replies-to' }
        }),
        charlie.add({
          type: 'post',
          text: 'hey hey',
          'parent': { msg: msg1.key, rel: 'replies-to' }
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


}

if(!module.parent)
  module.exports(require('../defaults'))

