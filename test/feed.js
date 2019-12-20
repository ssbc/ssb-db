'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var ssbKeys = require('ssb-keys')
var createFeed = require('ssb-feed')
var createSSB = require('./util')

module.exports = function (opts) {
  tape('simple', function (t) {
    var ssb = createSSB('test-ssb-feed')
    var feed = ssb.createFeed(ssbKeys.generate())

    feed.add({ type: 'msg', value: 'hello there!' }, function (err, msg) {
      if (err) throw err
      t.assert(!!msg)
      t.assert(!!msg.key)
      t.assert(!!msg.value)
      pull(
        ssb.createFeedStream(),
        pull.collect(function (err, ary) {
          if (err) throw err
          t.equal(ary.length, 1)
          t.assert(!!ary[0].key)
          t.assert(!!ary[0].value)
          console.log(ary)
          t.end()
        })
      )
    })
  })

  tape('tail', function (t) {
    var ssb = createSSB('test-ssb-feed2')

    var feed = createFeed(ssb, ssbKeys.generate(), opts)

    console.log('add 1'); console.log('add 2')
    var nDrains = 0
    var nAdds = 2
    feed.add({ type: 'msg', value: 'hello there!' }, function (err, msg1) {
      if (err) throw err
      var lasthash = msg1.key
      function addAgain () {
        feed.add({ type: 'msg', value: 'message ' + nDrains }, function (err, msgX) {
          if (err) throw err
          t.equal(msgX.value.previous, lasthash)
          console.log(msgX.value.previous, lasthash)
          lasthash = msgX.key
          nAdds++
          console.log('add', nAdds)
          if (err) throw err
          if (nAdds > 7) {
            console.log('TIMEOUT')
            throw new Error('Should have had 5 drains by now.')
          }
        })
      }
      var int = setInterval(addAgain, 300)
      pull(
        ssb.createFeedStream({ tail: true }),
        pull.drain(function (ary) {
          nDrains++
          console.log('drain', nDrains)
          if (nDrains === 5) {
            t.assert(true)
            t.end()
            clearInterval(int)
          }
        })
      )
      addAgain()
    })
  })

  tape('tail, parallel add', function (t) {
    var ssb = createSSB('test-ssb-feed3')

    var feed = createFeed(ssb, ssbKeys.generate(), opts)

    console.log('add 1'); console.log('add 2')
    var nDrains = 0
    var nAdds = 2
    var l = 7
    feed.add({ type: 'msg', value: 'hello there!' }, function (err, msg1) {
      if (err) throw err

      var lasthash = msg1.key
      function addAgain () {
        console.log('ADD')
        feed.add({ type: 'msg', value: 'message ' + nDrains }, function (err, msgX) {
          t.equal(msgX.value.previous, lasthash)
          console.log(msgX.value.previous, lasthash)
          lasthash = msgX.key
          nAdds++
          console.log('add', nAdds)
          if (err) throw err
          if (nAdds > 7) {
            // console.log('TIMEOUT')
            // throw new Error('Should have had 5 drains by now.')
          }
        })
        if (--l) addAgain()
      }

      pull(
        ssb.createFeedStream({ tail: true }),
        pull.drain(function (ary) {
          nDrains++
          console.log('drain', nDrains)
          if (nDrains === 5) {
            t.assert(true)
            t.end()
          }
        })
      )
      addAgain()
    })
  })

  tape('keys only', function (t) {
    var ssb = createSSB('test-ssb-feed4')
    var feed = createFeed(ssb, ssbKeys.generate(), opts)

    feed.add({ type: 'msg', value: 'hello there!' }, function (err, msg) {
      if (err) throw err
      t.assert(!!msg)
      pull(
        ssb.createFeedStream({ values: false }),
        pull.collect(function (err, ary) {
          if (err) throw err
          t.equal(ary.length, 1)
          t.ok(typeof ary[0] === 'string')
          console.log(ary)
          t.end()
        })
      )
    })
  })

  tape('values only', function (t) {
    var ssb = createSSB('test-ssb-feed5')

    var feed = createFeed(ssb, ssbKeys.generate(), opts)

    feed.add({ type: 'msg', value: 'hello there!' }, function (err, msg) {
      if (err) throw err
      t.assert(!!msg)
      pull(
        ssb.createFeedStream({ keys: false }),
        pull.collect(function (err, ary) {
          if (err) throw err
          t.equal(ary.length, 1)
          t.ok(typeof ary[0].content.type === 'string')
          console.log(ary)
          t.end()
        })
      )
    })
  })
}

if (!module.parent) { module.exports({}) }
