const test = require('tape')
const flumeProxy = require('./lib/flume-proxy')

const view = require('flumeview-level')
const ssb = require('../').init({}, { temp: true })

test('basic localFlumeUse() support', (t) => {
  // Use the remote log to create a `use()` function that makes local views.
  // This means you can create views from ssb-client, not just the server config!
  const proxy = flumeProxy(ssb)

  // Use a simple view that lets us look up messages by their key.
  const findByKey = proxy.use('example', view(1, ({ key }) => [key]))

  const content = { type: 'test', text: 'hello world' }

  ssb.publish(content, (err, publishedMessage) => {
    t.error(err, 'publish() successq')
    const key = publishedMessage.key

    findByKey.get(key, (findErr, foundMessage) => {
      t.error(findErr, 'get() success')
      t.deepEqual(foundMessage.value.content, content, 'content match')
      t.end()
    })
  })
})
