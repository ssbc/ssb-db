const test = require('tape')
const ssbKeys = require('ssb-keys')
const client = require('ssb-client')
const caps = require('ssb-caps')

const flumeProxy = require('./lib/flume-proxy')

const stack = require('secret-stack')({ caps })
  .use(require('../'))
  .use(require('ssb-master'))

var keys = ssbKeys.generate()

const server = stack({
  port: 45451,
  timeout: 2001,
  temp: 'connect',
  host: 'localhost',
  master: keys.id,
  keys,
  caps
})

// Have to wrap in setImmediate other
test('basic muxrpc test', (t) =>
  client(keys, {
    host: 'localhost',
    port: 45451,
    manifest: server.manifest(),
    caps
  }, (err, ssb) => {
    t.plan(5)
    t.error(err)
    const view = require('flumeview-level')

    // Use the remote log to create a `use()` function that makes local views.
    // This means you can create views from ssb-client, not just the server config!
    const proxy = flumeProxy(ssb.log)

    // Use a simple view that lets us look up messages by their key.
    const findByKey = proxy.use('example', view(1, ({ key }) => [key]))

    const content = { type: 'test', text: 'hello world' }

    t.comment('Publishing message...')
    ssb.publish(content, (publishErr, publishedMessage) => {
      t.error(publishErr)
      t.comment('Published message!')
      t.comment('Getting message...')
      const key = publishedMessage.key
      ssb.log.get(0, (getErr, val) => {
        t.error(getErr)
        t.comment('Got message!', val)
        t.comment('Querying view...')
        findByKey.get(key, (findErr, foundMessage) => {
          t.error(findErr)
          t.comment('Queried!')
          t.deepEqual(foundMessage.value.content, content)

          // Close proxy instance
          proxy.close(() => {
            // Close client connection
            ssb.close(true)
            // Close server instance
            server.close(true)
            t.end()
          })
        })
      })
    })
  })
)
