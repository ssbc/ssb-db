'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var ssbKeys = require('ssb-keys')
var box1 = require('ssb-private1/box1')
const { promisify } = require('util')

var { originalValue } = require('../util')
var createSSB = require('./util/create-ssb')

function simpleBox (content) {
  if (!content.recps.every(r => r === '!test')) return
  return Buffer.from(JSON.stringify(content)).toString('base64') + '.box.hah'
}
function simpleUnbox (ciphertext) {
  if (!ciphertext.endsWith('.box.hah')) return

  const base64 = ciphertext.replace('.box.hah', '')
  return JSON.parse(
    Buffer.from(base64, 'base64').toString('utf8')
  )
}

const originalTests = () => {
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

  // TODO many these tests are using the same ssb + feed, and some rely on reading
  // messages written in other tests ):
  // It would be good to make these tests more unit-test like to avoid confusing state

  var ssb = createSSB('test-ssb', { keys: alice })
  ssb.addBoxer(box1(alice).boxer)
  ssb.addUnboxer(box1(alice).unboxer)

  var ssb2 = createSSB('test-ssb2', { keys: charles })
  ssb2.addBoxer(box1(charles).boxer)
  ssb2.addUnboxer(box1(charles).unboxer)

  var feed = ssb.createFeed(alice)

  tape('error when trying to encrypt without boxer', (t) => {
    t.plan(2)
    const darlene = ssbKeys.generate()
    const darleneFeed = ssb.createFeed(darlene)
    darleneFeed.add(
      { type: 'error', recps: [alice, darlene] },
      (err, msg) => {
        t.ok(err)
        t.notOk(msg)
        t.end()
      })
  })

  tape('add pre-encrypted message', function (t) {
    var original = { type: 'secret', okay: true }
    var boxed = ssbKeys.box(original, [alice.public, bob.public])

    var postObserved
    var listener = ssb.post(msg => { postObserved = msg })

    feed.add(boxed, function (err) {
      if (err) throw err
      t.notOk(err)

      pull(
        ssb.messagesByType({ type: 'secret', private: true }),
        pull.collect(function (err, ary) {
          if (err) throw err

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
                  ssb2.close()
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
    feed.add({ type: 'secret2', secret: "it's a secret!", recps: feed.id }, function (err) {
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
          t.true(typeof postObserved.value.content === 'string', 'db.post obs messages should not be decrypted')

          t.end()
        })
      )
    })
  })

  tape('error on invalid recps', function (t) {
    feed.add({ recps: true, type: 'invalid' }, function (err) {
      t.ok(err)
      feed.add({ recps: [], type: 'invalid' }, function (err) {
        t.ok(err)
        feed.add({ recps: [feed.id, true], type: 'invalid' }, function (err) {
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

  tape.onFinish(ssb.close)
  // this is not great but works
  // previously there was just an ssb.close in the end of the longest running test ...
}
originalTests()

tape('methods which can unbox (security)', function (t) {
  var alice = ssbKeys.generate()
  var ssb = createSSB(undefined, { keys: alice })
  var feed = ssb.createFeed(alice)

  const boxer = {
    init: (done) => setTimeout(() => done(), 10),
    value: simpleBox
  }

  const unboxer = {
    init: (done) => setTimeout(() => done(), 10),
    key: function (ciphertext) {
      if (!ciphertext.endsWith('.box.hah')) return
      return '"the msgKey"'
    },
    value: function (ciphertext, _, readKey) {
      if (readKey !== '"the msgKey"') throw new Error('what?')
      return simpleUnbox(ciphertext)
    }
  }
  ssb.addBoxer(boxer)
  ssb.addUnboxer(unboxer)

  const content = {
    type: 'poke',
    reason: 'why not',
    recps: [ '!test' ],
    myFriend: alice.id// Necessary to test links()
  }
  feed.publish(content, (_, msg) => {
    ssb.get({ id: msg.key, private: true, meta: true }, async (err, msg) => {
      t.error(err)

      t.deepEqual(msg.value.content, content, 'auto unboxing works')

      const assertBoxed = (methodName, message) => {
        if (typeof message.key === 'string') {
          t.equal(message.key, msg.key, `${methodName}() returned correct message`)
          t.equal(typeof message.value.content, 'string', `${methodName}() does not unbox by default`)
        } else {
          t.equal(typeof message.content, 'string', `${methodName}() does not unbox by default`)
        }
      }

      const assertBoxedAsync = async (methodName, options) => {
        assertBoxed(methodName, await promisify(ssb[methodName])(options))
        if (typeof options === 'object' && Array.isArray(options) === false) {
          assertBoxed(methodName, await promisify(ssb[methodName])({ ...options, private: false }))
        }
      }

      // This tests the default behavior of `ssb.get()`, which should never
      // decrypt messages by default. This is **very important**.
      await assertBoxedAsync('get', msg.key)
      await assertBoxedAsync('get', { id: msg.key })
      await assertBoxedAsync('get', { id: msg.key, meta: true })
      await assertBoxedAsync('getAtSequence', [msg.value.author, msg.value.sequence])
      await assertBoxedAsync('getLatest', msg.value.author)

      const assertBoxedSourceOnce = (methodName, options) => new Promise((resolve) => {
        pull(
          ssb[methodName](options),
          pull.collect((err, val) => {
            t.error(err, `${methodName}() does not error`)
            switch (methodName) {
              case 'createRawLogStream':
                assertBoxed(methodName, val[0].value)
                break
              case 'createFeedStream':
              case 'createUserStream':
              case 'messagesByType':
                // Apparently some methods take `{ private: false }` to mean
                // "don't return any private messages". :/
                if (options.private === undefined) {
                  assertBoxed(methodName, val[0].value)
                }
                break
              default:
                assertBoxed(methodName, val[0])
            }
            resolve()
          })
        )
      })

      // Test the default **and** `{ private: false }`.
      const assertBoxedSource = async (methodName, options) => {
        await assertBoxedSourceOnce(methodName, options)
        await assertBoxedSourceOnce(methodName, { ...options, private: false })
      }

      await assertBoxedSource('createLogStream', { limit: 1, reverse: true })
      await assertBoxedSource('createHistoryStream', { id: msg.value.author, seq: msg.value.sequence, reverse: true })
      await assertBoxedSource('messagesByType', { type: 'poke', limit: 1, reverse: true })
      await assertBoxedSource('createFeedStream', { id: msg.value.author, seq: msg.value.sequence, reverse: true })
      await assertBoxedSource('createUserStream', { id: msg.value.author, seq: msg.value.sequence, reverse: true })
      await assertBoxedSource('links', { source: msg.value.author, limit: 1, values: true })
      await assertBoxedSource('createRawLogStream', { source: msg.value.author, limit: 1, reverse: true, values: true })

      ssb.close((err) => {
        t.error(err)
        t.end()
      })
    })
  })
})

tape('addBoxer (simple / deprecated)', function (t) {
  var alice = ssbKeys.generate()
  var ssb = createSSB(undefined, { keys: alice })

  var feed = ssb.createFeed(alice)
  ssb.addBoxer(simpleBox)

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

    ssb.close()
    t.end()
  })
})

tape('addBoxer { value }', function (t) {
  var alice = ssbKeys.generate()
  var ssb = createSSB(undefined, { keys: alice })

  var feed = ssb.createFeed(alice)

  ssb.addBoxer({ value: simpleBox })

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

    ssb.close()
    t.end()
  })
})

tape('addBoxer (first matching boxer)', function (t) {
  // this test checks the behaviour of registering multiple boxers
  // - what order do they get invoked
  // - does only the first one get invoked?

  t.plan(7)
  var alice = ssbKeys.generate()
  var ssb = createSSB(undefined, { keys: alice })

  var feed = ssb.createFeed(alice)

  const contentA = {
    type: 'pokeA',
    recps: [ '!test' ]
  }
  const boxerA = (content) => {
    if (!content.recps.every(r => r.startsWith('!'))) {
      t.deepEqual(content, contentB, 'boxerA cant box contentB')
      return
    }
    t.deepEqual(content, contentA, 'boxerA boxes contentA')
    return simpleBox(content)
  }
  const contentB = {
    type: 'pokeB',
    recps: [ '*test' ]
  }
  const boxerB = (content) => {
    t.deepEqual(content, contentB, 'boxerB boxes contentB')
    return 'blahblahblah.box.hah2'
  }

  ssb.addBoxer({ value: boxerA })
  ssb.addBoxer({ value: boxerB })

  feed.publish(contentA, (err, msg) => {
    t.error(err)
    t.true(msg.value.content.endsWith('.box.hah'), 'contentA published')

    feed.publish(contentB, (err, msg) => {
      t.error(err)
      t.true(msg.value.content.endsWith('.box.hah2'), 'contentB published')
      ssb.close()
    })
  })
})

tape('addBoxer { value, init }', function (t) {
  var alice = ssbKeys.generate()
  var ssb = createSSB(undefined, { keys: alice })
  var feed = ssb.createFeed(alice)

  var initDone = false
  ssb.addBoxer({
    value: simpleBox,
    init: (done) => setTimeout(
      () => {
        t.ok(true, 'boxer init called')
        initDone = true
        done()
      },
      500
    )
  })

  const content = {
    type: 'poke',
    reason: 'why not',
    recps: [ '!test' ]
  }
  feed.publish(content, (err, msg) => {
    t.error(err)
    t.true(initDone, 'init is done before publish')
    t.true(typeof msg.value.content === 'string', 'encrypted string')
    t.match(msg.value.content, /\.box\.hah$/, 'of type .box.hah')

    ssb.close()
    t.end()
  })
})

tape('addUnboxer (simple / depricated)', function (t) {
  var alice = ssbKeys.generate()
  var ssb = createSSB(undefined, { keys: alice })
  var feed = ssb.createFeed(alice)

  ssb.addUnboxer(simpleUnbox)

  const content = {
    type: 'poke',
    reason: 'why not',
    recps: [ '!test' ]
  }
  const ciphertext = simpleBox(content)
  feed.publish(ciphertext, (_, msg) => {
    ssb.get({ id: msg.key, private: true, meta: true }, (err, msg) => {
      if (err) throw err
      t.deepEqual(msg.value.content, content, 'auto unboxing works')
      t.end()
      ssb.close()
    })
  })
})

tape('addUnboxer { key, value }', function (t) {
  t.plan(6)
  var alice = ssbKeys.generate()
  var ssb = createSSB(undefined, { keys: alice })
  var feed = ssb.createFeed(alice)

  const content = {
    type: 'poke',
    reason: 'why not',
    recps: [ '!test' ]
  }
  const ciphertext = simpleBox(content)

  const isMsgVal = (val) => {
    if (val.content !== ciphertext) return false
    if (val.author !== alice.id) return false

    return true
  }

  ssb.addUnboxer({
    key: (_ciphertext, _val) => {
      t.equal(_ciphertext, ciphertext, 'unboxKey gets passed ciphertext')
      t.true(isMsgVal(_val), 'unboxKey gets passed msgVal')

      return 'the_read_key'
    },
    value: (_ciphertext, _val, _readKey) => {
      t.equal(_ciphertext, ciphertext, 'unboxValue gets passed ciphertext')
      t.true(isMsgVal(_val), 'unboxKey gets passed msgVal')
      t.deepEqual(_readKey, 'the_read_key', 'unboxKey gets passed the readyKey')

      return simpleUnbox(_ciphertext)
    }
  })

  feed.publish(ciphertext, (_, msg) => {
    ssb.get({ id: msg.key, private: true, meta: true }, (err, msg) => {
      if (err) throw err
      t.deepEqual(msg.value.content, content, 'auto unboxing works')
      ssb.close()
    })
  })
})

tape('addUnboxer { key, value, init }', function (t) {
  var alice = ssbKeys.generate()
  var ssb = createSSB(undefined, { keys: alice })
  var feed = ssb.createFeed(alice)

  const content = {
    type: 'poke',
    reason: 'why not',
    recps: [ '!test' ]
  }
  const ciphertext = simpleBox(content)

  var initDone = false
  ssb.addUnboxer({
    key: (_ciphertext, _val) => {
      return 'the_read_key'
    },
    value: (_ciphertext, _val, _readKey) => {
      t.deepEqual(_readKey, 'the_read_key', 'unboxKey gets passed the readyKey')
      return simpleUnbox(_ciphertext)
    },
    init: (done) => {
      setTimeout(
        () => {
          initDone = true
          done()
        },
        500
      )
    }
  })

  feed.publish(ciphertext, (_, msg) => {
    t.false(initDone, 'can publish while unboxer initialising')
    ssb.get({ id: msg.key, private: true, meta: true }, (err, msg) => {
      if (err) throw err
      t.true(initDone, 'waits till unboxer initialiser before get')
      t.deepEqual(msg.value.content, content, 'auto unboxing works')
      ssb.close()
      t.end()
    })
  })
})

tape('addBoxer + addUnboxer (both with init)', function (t) {
  t.plan(9)
  var alice = ssbKeys.generate()
  var ssb = createSSB(undefined, { keys: alice })
  var feed = ssb.createFeed(alice)

  let unboxerInitDone = false
  let boxerInitDone = false

  const boxer = {
    init: function (done) {
      setTimeout(() => {
        t.ok(true, 'calls boxer init')
        boxerInitDone = true
        done()
      }, 500)
    },
    value: (x) => Buffer.from(JSON.stringify(x))
      .toString('base64') + '.box.hah'
  }

  const unboxer = {
    init: function (done) {
      setTimeout(() => {
        t.ok(true, 'calls unboxer init')
        unboxerInitDone = true
        done()
      }, 1000)
    },
    key: function (ciphertext) {
      if (!ciphertext.endsWith('.box.hah')) return

      return '"the msgKey"'
    },
    value: function (ciphertext) {
      const base64 = ciphertext.replace('.box.hah', '')
      return JSON.parse(
        Buffer.from(base64, 'base64').toString('utf8')
      )
    }
  }
  ssb.addBoxer(boxer)
  ssb.addUnboxer(unboxer)
  t.false(boxerInitDone)
  t.false(unboxerInitDone)

  const content = {
    type: 'poke',
    reason: 'why not',
    recps: [ '!test' ],
    myFriend: alice.id// Necessary to test links()
  }
  feed.publish(content, (_, msg) => {
    t.true(boxerInitDone, 'boxer completed initialisation before publish')
    t.false(unboxerInitDone, 'unboxer did not completed initialisation before publish')

    ssb.get({ id: msg.key, private: true, meta: true }, async (err, msg) => {
      t.error(err)

      t.true(unboxerInitDone, 'unboxer completed initialisation before get')
      t.deepEqual(msg.value.content, content, 'auto unboxing works')
      ssb.close()
    })
  })
})
