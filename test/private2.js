const createSSB = require('./util/create-ssb')
const tape = require('tape')
const { promisify } = require('util')

tape('partial index', async (t) => {
  const name = `test-ssb-partial-index-${Date.now()}`

  t.plan(6)

  const ssb = createSSB(name, { temp: false })
  const { key } = await promisify(ssb.publish)({ type: 'test' })
  t.pass('published')

  await promisify(ssb.rebuild)()
  t.pass('rebuilt')

  await promisify(ssb.close)()
  t.pass('closed')

  const ssb2 = createSSB(name, { temp: false }, [require('ssb-private2')])

  const result = await promisify(ssb2.get)(key)
  t.ok(result)

  await promisify(ssb2.publish)({ type: 'test' })
  t.pass('published again')

  await promisify(ssb2.close)()
  t.pass('closed again')
})

/* Note - this sequence of actions sets the database in a state which could get it in a locked state
 * In particular ssb-private2 requires boxer and unboxer initialistion, and they can depened on one
 * another, so if you're not careful.
 */
