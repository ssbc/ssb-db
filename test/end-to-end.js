'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var ssbKeys = require('ssb-keys')

var createSSB = require('./util')

module.exports = function (opts) {
  var alice = ssbKeys.generate()
  var bob = ssbKeys.generate()
  var charles = ssbKeys.generate()

  var ssb = createSSB('test-ssb', { keys: alice })
  var ssb2 = createSSB('test-ssb2', { keys: charles })

  function UnboxStream(keys) {
    pull.map(function (data) {
      var ctxt = data.value.content
      var content = ssbKeys.unbox(ctxt, keys.private)
      var msg = data.value
      var _msg = {}
      for(var k in msg)
        _msg[k] = msg[k]
      _msg.content = content

      return {key: data.key, value: _msg, timestamp: data.timestamp}
    })
  }

  tape('ssb.id is main id', function (t) {
    t.equal(ssb.id, alice.id)
    t.end()
  })

  tape('add encrypted message', function (t) {
    var boxed = ssbKeys.box({ type: 'secret', okay: true }, [alice.public, bob.public])

    ssb.post(function (msg) {
      t.equal('string', typeof msg.value.content, 'messages should not be decrypted')
    })

    ssb.publish(boxed, function (err, msg) {
      if (err) throw err
      t.notOk(err)
      console.log(msg)
      pull(
        ssb.createRawLogStream({seqs: false, private: false}),
//        UnboxStream(alice),
        pull.collect(function (err, ary) {
          var msg = ary[0].value
          var ctxt = msg.content
          var content = ssbKeys.unbox(ctxt, alice.private)

          t.deepEqual(content, { type: 'secret', okay: true }, 'alice can decrypt')

          // bob can also decrypt
          var content2 = ssbKeys.unbox(ctxt, bob.private)
          t.deepEqual(content, { type: 'secret', okay: true }, 'bob can decrypt')

          var pmsg = ssb.unbox(ary[0])
          t.notOk(msg.unbox, 'did not mutate original message')
          var unboxKey = pmsg.value.unbox
          t.equal(typeof unboxKey, 'string')
          t.ok(pmsg)
          t.deepEqual(pmsg.value.content, content2)

          console.log('boxed', ary[0].value)
          ssb2.add(ary[0].value, function (err) {
            if (err) throw err
            ssb2.get({ id: pmsg.key, private: true }, function (err, _msg) {
              if (err) throw err
              console.log('LOAD', _msg)
              t.deepEqual(_msg, msg) // not decrypted
              t.equal(typeof _msg.content, 'string')
              //              return t.end()
              var pmsg2 = ssb2.unbox({ value: _msg }, unboxKey)
              t.deepEqual(pmsg2.value, pmsg.value)

              ssb2.get({ id: pmsg.key, private: true, unbox: unboxKey }, function (err, __msg) {
                if (err) throw err
                t.deepEqual(__msg, pmsg.value)
                ssb2.get(pmsg.key + '?unbox=' + unboxKey, function (err, __msg) {
                  if (err) throw err
                  t.deepEqual(__msg, pmsg.value)
                  t.end()
                })
              })
            })
          })
        })
      )
    })
  })

  tape('add encrypted message', function (t) {
    ssb.post(function (msg) {
      t.equal('string', typeof msg.value.content, 'messages should not be decrypted')
    })

    // secret message sent to self
    ssb.publish({
      recps: ssb.id,
      type: 'secret2',
      secret: "it's a secret!"
    }, function (err, msg) {
      if (err) throw err
      t.notOk(err)
      console.log(msg)
      t.equal(typeof msg.value.content, 'string')
      t.end()
    })
  })

  tape('error on invalid recps', function (t) {
    ssb.publish({
      recps: true, type: 'invalid'
    }, function (err) {
      t.ok(err)
      ssb.publish({
        recps: [], type: 'invalid'
      }, function (err) {
        t.ok(err)
        ssb.publish({
          recps: [ssb.id, true], type: 'invalid'
        }, function (err) {
          t.ok(err)
          t.end()
        })
      })
    })
  })

  tape('retreive already decrypted messages', function (t) {
    pull(
      ssb.createRawLogStream({ seqs: false, private: true }),
      pull.filter(function (data) {
        return data.value.content.type === 'secret'
      }),
      pull.collect(function (err, ary) {
        if (err) throw err
        var content = ary[0].value.content
        t.deepEqual(content, { type: 'secret', okay: true }, 'alice can decrypt')

        t.end()
      })
    )
  })

}

if (!module.parent) { module.exports({}) }
















