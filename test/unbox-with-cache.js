/*
  This file exists because we were seeing strange behaviour around indexing
  of encrypted messages.
  The bug was tracked down to the unbox cache in autobox.js, which was storing
  a reference to a state which was being mutated elsewhere.
  These tests are left to guard against this bug recurring
  */

const tape = require('tape')
const pull = require('pull-stream')
const plugins = [
  require('ssb-backlinks'),
  require('ssb-tribes')
]
const createSsb = require('./util/create-ssb')
const cloneDeep = require('lodash.clonedeep')

// This test uses get() from SSB-DB to unbox the published message.
// It seems to work fine, and `msg.value.content` is always an object.
tape('unbox.withCache - async', (t) => {
  const name = `ghost-get-${Date.now()}`
  const a = createSsb(name, { temp: false }, plugins)

  const asyncGet = (node, key, cb) => node.get({ id: key, private: true, meta: true }, cb)

  a.tribes.create({}, (err, { groupId }) => {
    t.error(err, 'no create() err')
    a.publish({ type: 'test', recps: [groupId] }, (err, { key }) => {
      t.error(err)

      asyncGet(a, key, (err, msg) => {
        t.error(err)
        t.equal(typeof msg.value.content, 'object')
        a.close((err) => {
          t.error(err)
          const b = createSsb(name, { temp: false, keys: a.keys }, plugins)
          asyncGet(b, key, (err, msg) => {
            t.error(err)
            t.equal(typeof msg.value.content, 'object')
            b.close(t.end)
          })
        })
      })
    })
  })
})

// When we use stream-based methods like `createUserStream`, `backlinks.read`,
// `query.read`, or others, we see strange behavior where the unboxer doesn't
// properly unbox the message. In this case we see `msg.value.content` as a
// string.
tape('unbox.withCache - source', (t) => {
  const name = `ghost-read-${Date.now()}`
  const a = createSsb(name, { temp: false }, plugins)

  // Same as get() but uses read() under the hood.
  const streamGet = (node, key, cb) => pull(
    node.createUserStream({ id: a.id, private: true, meta: true }),
    pull.filter((x) => x.key === key),
    pull.collect((err, arr) => {
      cb(err, arr[0])
    })
  )

  a.tribes.create({}, (err, { groupId }) => {
    t.error(err, 'no create() err')
    a.publish({ type: 'test', recps: [groupId] }, (err, { key }) => {
      t.error(err)

      streamGet(a, key, (err, msg) => {
        t.error(err)
        t.equal(typeof msg.value.content, 'object')
        a.close((err) => {
          t.error(err)
          const b = createSsb(name, { temp: false, keys: a.keys }, plugins)
          streamGet(b, key, (err, msg) => {
            t.error(err)
            t.equal(typeof msg.value.content, 'object')
            b.close(t.end)
          })
        })
      })
    })
  })
})

// This test ensures that one query doesn't mutate the results of another
// query. This was written to illustrate a problem where `unboxValue()` would
// **mutate the results of other queries** and re-box messages that were meant
// to be private.
tape('shared mutable state (source)', (t) => {
  const ssb = createSsb(`shared-mutable-state-${Date.now}`, {}, [require('ssb-private1')])

  ssb.publish({ type: 'test', recps: [ssb.id]}, (err) => {
    t.error(err)

    pull(
      ssb.createUserStream({ id: ssb.id, reverse: true, limit: 1, private: true }),
      pull.collect((err, privateMessages) => {
        t.error(err)
        const copy = cloneDeep(privateMessages)
        pull(
          ssb.createUserStream({ id: ssb.id, reverse: true, limit: 1 }),
          pull.collect((err) => {
            t.error(err)
            t.deepEqual(privateMessages, copy, 'unrelated query should not mutate original results')
            ssb.close(t.end)
          })
        )
      })
    )
  })
})
