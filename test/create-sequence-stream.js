const obv = require('obv')
const pull = require('pull-stream')
const test = require('tape')

const ssb = require('../').init({}, { temp: true })

test('createSequenceStream (initial sequence numbers)', (t) => {
  const since = obv()

  pull(
    ssb.createSequenceStream(),
    pull.drain(since.set)
  )

  since.once((val) => {
    t.equal(val, -1, 'since has correct init value')
  })

  ssb.publish({ type: 'test' }, (err, publishedMessage) => {
    t.error(err, 'publish() success')

    t.equal(since.value, 0, 'since is incremented')
    t.end()
  })
})

test('createSequenceStream (resume sequence stream later)', (t) => {
  const since = obv()

  pull(
    ssb.createSequenceStream(),
    pull.drain(since.set)
  )

  since.once((val) => {
    t.equal(val, 0, 'since has correct init value')
  })

  ssb.publish({ type: 'test' }, (err, publishedMessage) => {
    t.error(err, 'publish() success')

    ssb.get(since.value, (err, foundMessage) => {
      t.error(err, 'get() success')

      t.ok(since.value > 1, 'since is incremented')
      t.deepEqual(foundMessage, publishedMessage, 'sequence number works')
      t.end()
    })
  })
})
