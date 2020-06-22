'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var createSSB = require('./util/create-ssb')

function run (opts) {
  tape('createFeedStream (simple)', function (t) {
    var ssb = createSSB('test-ssb-feed')

    ssb.publish({ type: 'msg', value: 'hello there!' }, function (err, msg) {
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
          ssb.close(err => {
            t.error(err, 'ssb.close - createFeedStream (simple)')
            t.end()
          })
        })
      )
    })
  })

  tape('createFeedStream (live)', function (t) {
    var ssb = createSSB('test-ssb-feed2')

    var nDrains = 0
    var nAdds = 2
    ssb.publish({ type: 'msg', value: 'hello there!' }, function (err, msg1) {
      if (err) throw err
      var lasthash = msg1.key
      function addAgain () {
        ssb.publish({ type: 'msg', value: 'message ' + nDrains }, function (err, msgX) {
          if (err) throw err
          t.equal(msgX.value.previous, lasthash)
          lasthash = msgX.key
          nAdds++
          console.log('add', nAdds)
          if (err) throw err
          if (nAdds > 7) {
            throw new Error('Should have had 5 drains by now.')
          }
        })
      }
      var int = setInterval(addAgain, 350)
      pull(
        ssb.createFeedStream({ live: true }),
        pull.drain(function (ary) {
          nDrains++
          console.log('drain', nDrains)
          if (nDrains === 5) {
            clearInterval(int)
            ssb.close(err => {
              t.error(err, 'ssb.close - createFeedStream (live)')
              t.end()
            })
          }
        })
      )
      addAgain()
    })
  })

  tape('createFeedStream (live, parallel add)', function (t) {
    var ssb = createSSB('test-ssb-feed3')

    var nDrains = 0
    var nAdds = 2
    var l = 7
    ssb.publish({ type: 'msg', value: 'hello there!' }, function (err, msg1) {
      if (err) throw err

      var lasthash = msg1.key
      function addAgain () {
        ssb.publish({ type: 'msg', value: 'message ' + nDrains }, function (err, msgX) {
          t.equal(msgX.value.previous, lasthash)
          lasthash = msgX.key
          nAdds++
          console.log('add', nAdds)
          if (err) throw err
          if (nAdds > 7) {
            // throw new Error('Should have had 5 drains by now.')
          }
        })
        if (--l) addAgain()
      }

      pull(
        ssb.createFeedStream({ live: true }),
        pull.drain(function (ary) {
          nDrains++
          console.log('drain', nDrains)
          if (nDrains === 5) {
            t.assert(true)
            ssb.close(err => {
              t.error(err, 'ssb.close - createFeedStream (live parallel add)')
              t.end()
            })
          }
        })
      )
      addAgain()
    })
  })
  tape('createFeedStream (keys only)', function (t) {
    const ssb = createSSB('test-ssb-feed4')

    ssb.publish({ type: 'msg', value: 'hello there!' }, function (err, msg) {
      t.error(err)
      t.ok(msg)
      pull(
        ssb.createFeedStream({ values: false }),
        pull.collect(function (err, ary) {
          t.error(err)
          t.equal(ary.length, 1)
          t.ok(typeof ary[0] === 'string')
          ssb.close(err => {
            t.error(err, 'ssb.close - createFeedStream (keys only)')
            t.end()
          })
        })
      )
    })
  })

  tape('createFeedStream (values only)', function (t) {
    var ssb = createSSB('test-ssb-feed5')

    ssb.publish({ type: 'msg', value: 'hello there!' }, function (err, msg) {
      if (err) throw err
      t.assert(!!msg)
      pull(
        ssb.createFeedStream({ keys: false }),
        pull.collect(function (err, ary) {
          if (err) throw err
          t.equal(ary.length, 1)
          t.ok(typeof ary[0].content.type === 'string')
          ssb.close(err => {
            t.error(err, 'ssb.close - createFeedStream (values only)')
            t.end()
          })
        })
      )
    })
  })
}

run()
