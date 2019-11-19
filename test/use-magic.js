const test = require('tape')
const ssbKeys = require('ssb-keys')
const ssbClient = require('ssb-client')
const caps = require('ssb-caps')

// HACK
const client = (...args) => setTimeout(() => ssbClient(...args))

const flumeProxy = require('./lib/flume-proxy')

const keys = ssbKeys.generate()

const createServer = (port) => {
  const stack = require('secret-stack')({ caps })
    .use(require('../'))
    .use(require('ssb-master'))

  return stack({
    port,
    timeout: 2001,
    temp: `connect-${port}`,
    host: 'localhost',
    master: keys.id,
    keys,
    caps
  })
}

const magic = (ssb) => {
  console.log('magic started')
  // Use the remote log to create a `use()` function that makes local views.
  // This means you can create views from ssb-client, not just the server config!
  const localFlume = flumeProxy(ssb.log)

  const localStack = require('secret-stack')({ caps })
  localStack.use({
    name: 'flume-proxy',
    init: (api) => {
      api._flumeUse = localFlume.use
      const _close = api.close

      // NOTE: Does not take optional `(err, cb)` because I don't understand
      //       what those are meant to do and it seems to work fine as-is.
      api.close = () => {
        console.log('api.close() called')
        localFlume.close(() => {}) // MAGIC NO-OP
        _close()
      }
    }
  })

  console.log('magic done')
  return localStack
}

test('magic muxrpc test', (t) => {
  const server = createServer(45452)

  client(keys, {
    host: 'localhost',
    port: 45452,
    manifest: server.manifest(),
    caps
  }, (err, ssb) => {
    console.log('connected')
    t.error(err)

    console.log('about to magic')

    const localStack = magic(ssb)
      .use(require('ssb-backlinks'))
      .use(require('ssb-about'))

    const localApp = localStack()

    const content = { type: 'about', about: keys.id, name: 'Xander' }

    t.comment('Publishing message...')
    ssb.publish(content, (publishErr, publishedMessage) => {
      t.error(publishErr)
      t.comment('Published message!')
      t.comment('Getting message...')
      ssb.log.get(0, (getErr, val) => {
        t.error(getErr)
        t.comment('Got message!', val)
        t.comment('Querying view...')
        localApp.about.socialValue({ key: 'name', dest: keys.id }, (findErr, foundMessage) => {
          t.error(findErr)
          t.comment('Queried!')
          t.equal(foundMessage, content.name)

          localApp.close(() => {})
          ssb.close(true) // MAGIC `true`
          server.close()
          t.end()
        })
      })
    })
  })
})
