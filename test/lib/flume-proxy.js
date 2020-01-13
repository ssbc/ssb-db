const flume = require('flumedb')
const obv = require('obv')
const path = require('path')
const pull = require('pull-stream')

let createFakeFilename

try {
  const os = require('os')
  const fs = require('fs')

  createFakeFilename = () => {
    const result = path.join(
    fs.mkdtempSync(path.join(
        os.tmpdir(),
        'ssb-db-')
      ),
      'log.flumeproxy'
    )
    console.log(`saving view to file ${result}`)
    return result
  }
} catch (e) {
  // We're probably running in a browser.
  createFakeFilename = () => null
}

module.exports = (remote) => {
  // Create local instance of flumedb that depends on the remote log.
  // Views will be created locally but the log will remain remote.
  const since = obv()

  console.log('starting since stream')
  console.log(remote.sinceStream)
  pull(
    remote.createSequenceStream(),
    pull.drain((value) => {
      console.log({since: value})
      since.set(value)
    })
  )

  const proxy = flume({
    stream: (opts, cb) => remote.createLogStream(
      { raw: true, ...opts },
      cb
    ),
    since,
    get: (seq, cb) => remote.get({ id: seq }, cb),
    filename: createFakeFilename()
  })

  const _use = proxy.use

  let pending = 0
  let onReadyCb = null

  // Match _flumeUse() API from ssb-db
  proxy._flumeUse = (name, createView) => {
    pending += 1
    _use(name, createView)

    proxy.views[name].ready(() => {
      console.log(`${name} ready`)
      pending -= 1
      if (pending === 0 && onReadyCb != null) {
        onReadyCb()
        onReadyCb = null
      }
    })

    return proxy.views[name]
  }

  setInterval(() => {
    Object.entries(proxy.views).forEach(([key, value]) => {
      console.log(key, `${Math.round(value.since.value / since.value * 100)}%`)
    })
  }, 1000)

  proxy.onReady = (cb) => {
    onReadyCb = cb
  }

  return proxy
}
