'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var ssbKeys = require('ssb-keys')
var box1 = require('ssb-private1/box1')

var createSSB = require('./create-ssb')
var { originalValue } = require('../util')

module.exports = function (opts) {
  var alice = ssbKeys.generate()
  var bob = ssbKeys.generate()
  var charles = ssbKeys.generate()

  /* NOTE
   * This is an older test which was written when box1 encryption was part
   * of this model.
   * To ensure these tests still run, we've added box1 back in.
   *
   * For parts dependent on this, see lines commented with:
   *   DEPENDENCY - ssb-private1
   */

  var ssb = createSSB('test-ssb', { keys: alice })
  ssb.addBoxer(box1(alice).boxer)
  ssb.addUnboxer(box1(alice).unboxer)

  var ssb2 = createSSB('test-ssb2', { keys: charles })
  ssb2.addBoxer(box1(charles).boxer)
  ssb2.addUnboxer(box1(charles).unboxer)

  var feed = ssb.createFeed(alice)

  tape('error when trying to encrypt without boxer', (t) => {
    t.plan(2);
    const darlene = ssbKeys.generate()
    const darleneSSB = createSSB('test-ssb-darlene', { keys: darlene })
    const darleneFeed = ssb.createFeed(darlene)
    darleneFeed.add(
      { type: "error", recps: [alice, darlene] },
      (err, msg) => {
	t.ok(err);
	t.notOk(msg);
        t.end()
      })
  })

  tape('add pre-encrypted message', function (t) {
    var original = { type: 'secret', okay: true }
    var boxed = ssbKeys.box(original, [alice.public, bob.public])

    var postObserved
    var listener = ssb.post(msg => { postObserved = msg })

    feed.add(boxed, function (err, msg) {
      if (err) throw err
      t.notOk(err)

      pull(
        ssb.messagesByType({ type: 'secret', private: true }),
        pull.collect(function (err, ary) {
          if (err) throw err
          // console.log('ALICE', alice.id)
          // console.log('SSB', ssb.id)

          var pmsg = ary[0]
          var ctxt = pmsg.value.meta.original.content

          t.deepEqual(ssbKeys.unbox(ctxt, alice.private), original, 'alice can decrypt')
          t.deepEqual(ssbKeys.unbox(ctxt, bob.private), original, 'bob can decrypt')

          var unboxKey = pmsg.value.meta.unbox
          t.equal(typeof unboxKey, 'string', 'has unbox key')

          t.deepEqual(pmsg.value.content, original, 'did not mutate original message')

          const rawMsg = originalValue(pmsg.value) // puts all the ciphertext back in place, strips meta
          ssb2.add(rawMsg, function (err) {
            if (err) throw err

            /* DEPENDENCY - ssb-private1 */
            ssb2.get({ id: pmsg.key, private: true }, function (err, _msg) {
              if (err) throw err

              t.equal(typeof _msg.content, 'string', 'cipherstring content')
              t.deepEqual(_msg, rawMsg, 'not decrypted')

              /* DEPENDENCY - ssb-private1 */
              ssb2.get({ id: pmsg.key, private: true, unbox: unboxKey }, function (err, __msg) {
                if (err) throw err

                t.deepEqual(__msg, pmsg.value, 'same msg')
                /* DEPENDENCY - ssb-private1 */
                ssb2.get(pmsg.key + '?unbox=' + unboxKey, function (err, __msg) {
                  if (err) throw err
                  t.deepEqual(__msg, pmsg.value)

                  listener()
                  t.true(typeof postObserved.value.content === 'string', 'post obs messages should not be decrypted')
                  t.end()
                })
              })
            })
          })
        })
      )
    })
  })

  tape('add pre-encrypted message (suffix check)', function (t) {
    const junk = 'asdasdasdasd'
    feed.add(junk, function (err) {
      t.true(err.message.match(/encrypted string/), 'invalid strings miss suffix .box*')

      const validJunk = 'asdasdasdasd.box66'
      feed.add(validJunk, function (err) {
        t.false(err, 'valid strings have suffix .box*')

        t.end()
      })
    })
  })

  tape('add encrypted message (using recps: [feedId])', function (t) {
    /* DEPENDENCY - ssb-private1 */
    const content = {
      type: 'poke',
      reason: 'why not',
      recps: [ feed.id ]
    }
    feed.publish(content, (_, msg) => {
      t.true(typeof msg.value.content === 'string', 'encrypted string')
      t.true(msg.value.content.endsWith('.box'), 'of type .box')

      const plain = ssbKeys.unbox(msg.value.content, alice.private)
      t.deepEqual(plain, content, 'can be decrypted')

      t.end()
    })
  })

  tape('add encrypted message (using recps: String)', function (t) {
    /* DEPENDENCY - ssb-private1 */
    var postObserved
    var listener = ssb.post(msg => { postObserved = msg })

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

          listener()
          t.true(typeof postObserved.value.content === 'string', 'post obs messages should not be decrypted')

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
    /* DEPENDENCY - ssb-private1 */
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
    /* DEPENDENCY - ssb-private1 */
    var ciphertext = ssbKeys.box(
      { type: 'secret', okay: true },
      [alice.public, bob.public]
    )
    feed.add(ciphertext, function (err, msg) {
      if (err) throw err

      var ciphertext2 = ssbKeys.box(
        { type: 'secret', post: 'wow', reply: msg.key },
        [alice.public, bob.public]
      )
      feed.add(ciphertext2, function (err, msg2) {
        if (err) throw err

        pull(
          ssb.links({ dest: msg.key, type: 'msg', keys: false }),
          pull.collect(function (err, ary) {
            if (err) throw err
            t.deepEqual(ary, [{ source: msg2.value.author, rel: 'reply', dest: msg.key }])
            t.end()
          })
        )
      })
    })
  })

  tape('addBoxer', function (t) {
    const boxer = (content) => {
      if (!content.recps.every(r => r === '!test')) return

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

  tape('addUnboxer (simple)', function (t) {
    const unboxer = function (ciphertext, value) {
      if (!ciphertext.endsWith('.box.hah')) return

      const base64 = ciphertext.replace('.box.hah', '')
      return JSON.parse(
        Buffer.from(base64, 'base64').toString('utf8')
      )
    }
    ssb.addUnboxer(unboxer)

    const content = {
      type: 'poke',
      reason: 'why not',
      recps: [ '!test' ]
    }
    const ciphertext = Buffer.from(JSON.stringify(content)).toString('base64') + '.box.hah'

    feed.publish(ciphertext, (_, msg) => {
      ssb.get({ id: msg.key, private: true, meta: true }, (err, msg) => {
        if (err) throw err
        t.deepEqual(msg.value.content, content, 'auto unboxing works')
        t.end()
      })
    })
  })

  tape('addUnboxer (with init)', function (t) {
    var initDone = false

    const unboxer = {
      init: function (done) {
        setTimeout(() => {
          t.ok(true, 'calls init')
          initDone = true
          done()
        }, 500)
      },
      key: function (ciphertext, value) {
        if (!ciphertext.endsWith('.box.hah')) return

        return '"the msgKey"'
      },
      value: function (ciphertext, msgKey) {
        const base64 = ciphertext.replace('.box.hah', '')
        return JSON.parse(
          Buffer.from(base64, 'base64').toString('utf8')
        )
      }
    }
    ssb.addUnboxer(unboxer)
    t.false(initDone)

    const content = {
      type: 'poke',
      reason: 'why not',
      recps: [ '!test' ]
    }
    const ciphertext = Buffer.from(JSON.stringify(content)).toString('base64') + '.box.hah'

    feed.publish(ciphertext, (_, msg) => {
      t.true(initDone, 'unboxer completed initialisation before publish')

      ssb.get({ id: msg.key, private: true, meta: true }, (err, msg) => {
        if (err) throw err

        t.true(initDone, 'unboxer completed initialisation before get')
        t.deepEqual(msg.value.content, content, 'auto unboxing works')
        t.end()
      })
    })
  })
}

if (!module.parent) { module.exports({}) }
