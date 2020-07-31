const test = require('tape')
const { promisify: p } = require('util')
const { isMsg } = require('ssb-ref')
const ssb = require('../').init({}, { temp: true })

const getFeedState = p(ssb.getFeedState)
const publish = p(ssb.publish)

const myKey = ssb.keys.id
const otherKey = '@zwRbK6ZFefbMDtPcM+q3Kdvwzr+RU9K0e/UFSFzlhuQ=.ed25519'

test('getFeedState', async (t) => {
  var initialState = await getFeedState(myKey)
  t.deepEqual(initialState, { id: null, sequence: 0 }, 'empty feed')

  await publish({ type: 'boop' })

  var laterState = await getFeedState(ssb.keys.id)
  t.equal(laterState.sequence, 1, 'sequence increases after publish')
  t.true(isMsg(laterState.id), 'msgId present after publish')

  var otherState = await getFeedState(otherKey)
  t.deepEqual(otherState, { id: null, sequence: 0 }, 'returns null for remote feeds it does not know about')

  try {
    await getFeedState('cat')
  } catch (e) {
    t.match(e.message, /Param 0 must by of type feedId/)
    // NOTE typo in auto-validation : by !== be
  }

  t.end()
})
