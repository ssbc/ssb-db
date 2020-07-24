const tape = require('tape')
const createSsb = require('./util/create-ssb')
const { promisify } = require('util')

// If you write faster than the database can save messages, it adds them to
// some kind of queue, which eventually gets 'flushed'. Unfortunately it looks
// like when you publish more than 1000 messages very quickly, the 1000th
// message comes back as `undefined` rather than `{ key, value }` like it
// should.
tape('test ', (t) => {
  const ssb = createSsb();

  // We write 7919 messages, which should be bigger than any cache. It's also a
  // prime number and shouldn't line up perfectly with any batch sizes.
  const messages = 7919

  const assertsPerMessage = 4;
  t.plan(messages * assertsPerMessage);

  Promise.all([...new Array(messages)].map(async (_, i) => {
    const entry = await promisify(ssb.publish)({ type: 'test' })
    t.equal(typeof entry, 'object')
    t.equal(typeof entry.key, 'string')
    t.equal(typeof entry.value, 'object')
    t.equal(entry.value.sequence, i + 1)
  })).then(() => {
    ssb.close(t.end)
  })
})

