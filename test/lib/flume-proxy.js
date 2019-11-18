const flume = require('flumedb')
const fs = require('fs')
const obv = require('obv')
const os = require('os')
const path = require('path')
const pull = require('pull-stream')

module.exports = (remoteLog) => {
  // Create local instance of flumedb that depends on the remote log.
  // Views will be created locally but the log will remain remote.
  const since = obv()

  pull(
    remoteLog.since(),
    pull.drain((value) => {
      since.set(value)
    })
  )

  const proxy = flume({
    stream: remoteLog.stream,
    since,
    get: remoteLog.get,
    filename: path.join(
      fs.mkdtempSync(path.join(
        os.tmpdir(),
        'ssb-db-')
      ),
      'log.flumeproxy'
    )
  })

  const _use = proxy.use

  // Rewrite use() to match _flumeUse() API
  proxy.use = (name, createView) => {
    _use(name, createView)
    return proxy.views[name]
  }

  return proxy
}
