const tape = require('tape')
const createSsb = require('./util/create-ssb')

// If you write faster than the database can save messages, it adds them to
// some kind of queue, which eventually gets 'flushed'. Unfortunately it looks
// like when you publish more than 1000 messages very quickly, the 1000th
// message comes back as `undefined` rather than `{ key, value }` like it
// should.
tape('test ', (t) => {
  const ssb = createSsb();

  [...new Array(1024)].forEach(() => {
    ssb.publish({ type: 'test' }, (err, entry) => {
      t.error(err)
      t.ok(entry)
    })
  })
})

