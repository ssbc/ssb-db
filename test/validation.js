'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var explain = require('explain-error')
var generate = require('ssb-keys').generate
var hash = require('ssb-keys').hash
var v = require('ssb-validate')
var createSSB = require('./util')

module.exports = function (opts) {
  var create = require('ssb-feed/util').create
  var ssb = createSSB('test-ssb-validate')

  tape('simple', function (t) {
    var keys = generate()
    console.log('keys', keys)
    var prev
    var messages = [
      prev = create(keys, null, { type: 'init', public: keys.public }),
      prev = create(keys, 'msg', 'hello', prev),
      prev = create(keys, 'msg', 'hello2', prev)
    ]
    ssb.queue(messages[0], function () {})
    ssb.queue(messages[1], function () {})
    ssb.queue(messages[2], function () {
      t.end()
    })
  })

  tape('add & validate', function (t) {
    var keys = generate()
    var prev
    ssb.add(
      prev = create(keys, null, { type: 'init', public: keys.public }),
      function (err) {
        if (err) throw explain(err, 'init failed')

        ssb.add(
          prev = create(keys, 'msg', 'hello', prev),
          function (err) {
            if (err) throw explain(err, 'hello failed')

            ssb.add(
              prev = create(keys, 'msg', 'hello2', prev),
              function (err) {
                if (err) throw explain(err, 'hello2 failed')
                pull(
                  ssb.createFeedStream({ keys: false }),
                  pull.collect(function (err, ary) {
                    if (err) throw explain(err, 'createFeedStream failed')
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
    var keys = generate()
    var prev
    var calls = 0
    ssb.add(
      prev = create(keys, null, { type: 'init', public: keys.public }),
      function (err) {
        if (err) throw err
        calls++
      }
    )
    ssb.add(
      prev = create(keys, 'msg', 'hello', prev),
      function (err) {
        if (err) throw err
        calls++
      }
    )
    ssb.add(
      prev = create(keys, 'msg', 'hello2', prev),
      function (err) {
        if (err) throw err
        calls++
      }
    )
    setTimeout(function () {
      ssb.add(
        prev = create(keys, 'msg', 'hello3', prev),
        function (err) {
          if (err) throw err
          calls++
          t.equal(calls, 4)
          t.end()
        }
      )
    })
  })

  // when an add fails, you should still be able to add another
  // message if you wait until it has returned.

  tape('too big', function (t) {
    var keys = generate()
    var feed = ssb.createFeed(keys)
    var str = ''
    for (var i = 0; i < 808; i++) str += '1234567890'
    feed.add({ type: 'msg', value: str }, function (err, msg) {
      if (!err) throw new Error('too big was allowed')
      console.log(err)
      feed.add({ type: 'msg', value: 'this ones cool tho' }, function (err) {
        if (err) throw err
        t.end()
      })
    })
  })

  // git-ssb is known to change the order of the message
  tape('dict order', function (t) {
    var keys = generate()
    var prev
    ssb.add(
      prev = create(keys, null, { type: 'init', public: keys.public }),
      function (err) {
        if (err) throw explain(err, 'init failed')

        ssb.add(
          prev = require('ssb-keys').signObj(keys, null, {
            previous: ('%' + hash(JSON.stringify(prev, null, 2))),
            sequence: prev ? prev.sequence + 1 : 1,
            author: keys.id,
            timestamp: require('monotonic-timestamp')(),
            hash: 'sha256',
            content: { type: 'msg', value: 'hello' }
          }),
          function (err) {
            if (err) throw explain(err, 'hello failed')

            ssb.add(
              prev = create(keys, 'msg', 'hello2', prev),
              function (err) {
                if (err) throw explain(err, 'hello2 failed')

                var state = {
                  feeds: {}, queue: []
                }

                pull(
                  ssb.createFeedStream({ keys: false }),
                  pull.drain(function (msg) {
                    try {
                      state = v.append(state, null, msg)
                    } catch (ex) {
                      t.fail(ex)
                      return false
                    }
                  }, function () {
                    if (state.queue.length > 0) { t.pass('validate passes') }
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
}

if (!module.parent) { module.exports(require('../')) }
