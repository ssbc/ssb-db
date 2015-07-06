'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var explain  = require('explain-error')

module.exports = function (opts) {

  var db = sublevel(level('test-ssb-validate', {
    valueEncoding: opts.codec
  }))

  var create = require('ssb-feed/util').create
  var ssb = require('../')(db, opts)

  var validate = require('ssb-feed/validator')(ssb)

  tape('simple', function (t) {
    var keys = opts.keys.generate()
    var id = opts.hash(keys.public)
    var prev
    var messages = [
      prev = create(keys, null, {type: 'init', public: keys.public}),
      prev = create(keys, 'msg', 'hello', prev),
      prev = create(keys, 'msg', 'hello2', prev)
    ]

    console.log(messages)

    var _msg = null
    messages.forEach(function (msg) {
      validate(msg, function (err) {
        console.log('HELLO', opts.hash('HELLLO'))
        if(_msg)
          t.deepEqual(opts.hash(opts.codec.encode(_msg)), msg.previous)
        _msg = msg
        if(err) throw err
        if(msg.sequence === 3)
          t.end()
      })
    })
  })

  tape('add & validate', function (t) {
    var keys = opts.keys.generate()
    var id = opts.hash(keys.public)
    var prev
    ssb.add(
      prev = create(keys, null, {type: 'init', public: keys.public}),
      function (err) {
        if(err) throw explain(err, 'init failed')

        ssb.add(
          prev = create(keys, 'msg', 'hello', prev),
          function (err) {
            if(err) throw explain(err, 'hello failed')

            ssb.add(
              prev = create(keys, 'msg', 'hello2', prev),
              function (err) {
                if(err) throw explain(err, 'hello2 failed')
                pull(
                  db.createFeedStream({ keys: false }),
                  pull.collect(function (err, ary) {
                    if(err) throw explain(err, 'createFeedStream failed')
                    t.deepEqual(ary.pop(), prev)
                    t.end()
                  })
                )
              }
            )
          }
        )
      }
    )
  })

  tape('race: should queue', function (t) {
    var keys = opts.keys.generate()
    var id = opts.hash(keys.public)
    var prev, calls = 0
    ssb.add(
      prev = create(keys,null, {type:  'init', public: keys.public}),
      function (err) {
        if(err) throw err
        calls ++
      }
    )
    ssb.add(
      prev = create(keys, 'msg', 'hello', prev),
      function (err) {
        if(err) throw err
        calls ++
      }
    )
    ssb.add(
      prev = create(keys, 'msg', 'hello2', prev),
      function (err) {
        if(err) throw err
        calls ++
      }
    )
    setTimeout(function () {
      ssb.add(
        prev = create(keys, 'msg', 'hello3', prev),
        function (err) {
          if(err) throw err
          calls ++
          t.equal(calls, 4)
          t.end()
        }
      )
    })


  })

  //when an add fails, you should still be able to add another
  //message if you wait until it has returned.

  tape('too big', function (t) {
    var keys = opts.keys.generate()
    var feed = ssb.createFeed(keys)
    var str = ''
    for (var i=0; i < 808; i++) str += '1234567890'
    feed.add({ type: 'msg', value: str }, function (err, msg) {
      if(!err) throw new Error('too big was allowed')
      console.log(err)
      feed.add({ type: 'msg', value: 'this ones cool tho' }, function (err) {
        if (err) throw err
        t.end()
      })
    })
  })
}

if(!module.parent)
  module.exports(require('../defaults'))
