const test = require('tape')
const ssbClient = require('ssb-client')
const caps = require('ssb-caps')

// HACK
const client = (...args) => setTimeout(() => ssbClient(...args))

const flumeProxy = require('./lib/flume-proxy')

const magic = (ssb) => {
  console.log('magic started')
  // Use the remote log to create a `use()` function that makes local views.
  // This means you can create views from ssb-client, not just the server config!
  const localFlume = flumeProxy(ssb)
  const _close = ssb.close

  ssb._flumeUse = localFlume._flumeUse
  ssb.close = () => {
    console.log('api.close() called')
    localFlume.close(() => {}) // MAGIC NO-OP
    _close()
  }

  const self =  {
    use: (plugin) => {
      ssb[plugin.name] = plugin.init(ssb)
      return self
    },
    onReady: localFlume.onReady
  }

  return self
}

test('magic muxrpc test', (t) => {
  client({
    remote: 'unix:/home/christianbundy/.ssb/socket~noauth:+oaWWDs8g73EZFUMfW37R/ULtFEjwKN/DczvdYihjbU=',
    manifest: {
      whoami: 'sync',
      get: 'async',
      about: {
        socialValue: 'async'
      },
      sinceStream: 'source',
      createLogStream: 'source',
      progress: 'sync'
    },
    caps
  }, (err, ssb) => {
    console.log('connected')
    if (err) throw err
    console.log(ssb)

    console.log('about to magic')

    magic(ssb)
      .use(require('ssb-backlinks'))
      .use(require('ssb-about'))
      .onReady(() => {
        console.log('ready!')

        t.comment('Publishing message...')
        ssb.whoami((meErr, { id }) => {
          t.error(meErr)
          ssb.get({ id: 0 }, (getErr, val) => {
            t.error(getErr)
            t.comment('Got message!', val)
            t.comment('Querying view...')

            setInterval(() => {
              ssb.about.socialValue({ key: 'name', dest: id }, (findErr, foundMessage) => {
                if (err) {
                  console.log(err)
                }

                ssb.close()

                console.log(foundMessage)
              })
            }, 1000)
          })
        })
      })
  })
})
