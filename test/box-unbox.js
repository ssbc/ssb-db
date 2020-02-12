'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var ssbKeys = require('ssb-keys')

var createSSB = require('./create-ssb')

module.exports = function (opts) {
  var alice = ssbKeys.generate()
  var bob = ssbKeys.generate()
  var charles = ssbKeys.generate()

  var ssb = createSSB('test-ssb', { keys: alice })
  var ssb2 = createSSB('test-ssb2', { keys: charles })

  var feed = ssb.createFeed(alice)

  tape('add encrypted message', function (t) {
    var boxed = ssbKeys.box({ type: 'secret', okay: true }, [alice.public, bob.public])

    ssb.post(function (msg) {
      t.equal('string', typeof msg.value.content, 'messages should not be decrypted')
    })

    feed.add(boxed, function (err, msg) {
      if (err) throw err
      t.notOk(err)

      pull(
        ssb.messagesByType('secret'),
        pull.collect(function (err, ary) {
          if (err) throw err
          console.log('ALICE', alice.id)
          console.log('SSB', ssb.id)
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

  tape('add encrypted message (using recps: [feedId])', function (t) {
    const content = {
      type: 'poke',
      reason: 'why not',
      recps: [ feed.id ]
    }
    feed.publish(content, (err, msg) => {
      t.true(typeof msg.value.content === 'string', 'encrypted string')
      t.true(msg.value.content.endsWith('.box'), 'of type .box')

      const plain = ssbKeys.unbox(msg.value.content, alice.private)
      t.deepEqual(plain, content, 'can be decrypted')

      t.end()
    })
  })

  tape('add encrypted message (using recps: String)', function (t) {
    ssb.post(function (msg) {
      t.equal('string', typeof msg.value.content, 'messages should not be decrypted')
    })

    // secret message sent to self
    feed.add({ type: 'secret2', secret: "it's a secret!", recps: feed.id }, function (err, msg) {
      if (err) throw err
      t.notOk(err)

      pull(
        ssb.messagesByType('secret2'),
        pull.collect(function (err, ary) {
          if (err) throw err
          t.equal(ary.length, 1)
          var ctxt = ary[0].value.content

          // bob can also decrypt
          var content = ssbKeys.unbox(ctxt, alice.private)
          t.deepEqual(
            content,
            { type: 'secret2', secret: "it's a secret!", recps: [alice.id] },
            'alice can decrypt'
          )

          t.end()
        })
      )
    })
  })

  tape('error on invalid recps', function (t) {
    feed.add({
      recps: true, type: 'invalid'
    }, function (err) {
      t.ok(err)
      feed.add({
        recps: [], type: 'invalid'
      }, function (err) {
        t.ok(err)
        feed.add({
          recps: [feed.id, true], type: 'invalid'
        }, function (err) {
          t.ok(err)
          t.end()
        })
      })
    })
  })

  tape('retreive already decrypted messages', function (t) {
    pull(
      ssb.messagesByType({ type: 'secret', private: true }),
      pull.collect(function (err, ary) {
        if (err) throw err
        var content = ary[0].value.content
        t.deepEqual(content, { type: 'secret', okay: true }, 'alice can decrypt')

        t.end()
      })
    )
  })

  tape('test indexes on end-to-end messages', function (t) {
    feed.add(ssbKeys.box({
      type: 'secret', okay: true
    }, [alice.public, bob.public]
    ), function (err, msg) {
      if (err) throw err
      feed.add(ssbKeys.box({
        type: 'secret', post: 'wow', reply: msg.key
      }, [alice.public, bob.public]
      ), function (err, msg2) {
        if (err) throw err
        pull(
          ssb.links({ dest: msg.key, type: 'msg', keys: false }),
          pull.collect(function (err, ary) {
            if (err) throw err
            t.deepEqual(ary, [{
              source: msg2.value.author,
              rel: 'reply',
              dest: msg.key
            }])
            t.end()
          })
        )
      })
    })
  })

  tape('addBoxer', function (t) {
    const boxer = (content, recps) => {
      if (!recps.every(r => r === '!test')) return null

      return Buffer.from(JSON.stringify(content)).toString('base64') + '.box.hah'
    }
    ssb.addBoxer(boxer)

    const content = {
      type: 'poke',
      reason: 'why not',
      recps: [ '!test' ]
    }
    feed.publish(content, (err, msg) => {
      if (err) throw err
      t.true(typeof msg.value.content === 'string', 'encrypted string')
      t.true(msg.value.content.endsWith('.box.hah'), 'of type .box.hah')

      // manually check we can "unbox"
      const base64 = msg.value.content.replace('.box.hah', '')
      const plain = JSON.parse(
        Buffer.from(base64, 'base64').toString('utf8')
      )
      t.deepEqual(plain, content, 'can be decrypted')

      t.end()
    })
  })

  tape('addUnboxer', function (t) {
    const unboxer = {
      key: function (ciphertext) {
        if (!ciphertext.endsWith('.box.hah')) return null

        return '"the key"'
      },
      value: function (ciphertext, key) {
        const base64 = ciphertext.replace('.box.hah', '')
        return JSON.parse(
          Buffer.from(base64, 'base64').toString('utf8')
        )
      }
    }
    ssb.addUnboxer(unboxer)

    const content = {
      type: 'poke',
      reason: 'why not',
      recps: [ '!test' ]
    }
    const ciphertext = Buffer.from(JSON.stringify(content)).toString('base64') + '.box.hah'

    feed.publish(ciphertext, (err, msg) => {
      ssb.get({ id: msg.key, private: true, meta: true }, (err, msg) => {
        if (err) throw err
        t.deepEqual(msg.value.content, content, 'auto unboxing works')
        t.end()
      })
    })
  })
}

if (!module.parent) { module.exports({}) }
