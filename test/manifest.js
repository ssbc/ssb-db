'use strict'
var tape = require('tape')
var { manifest, init } = require('../')

module.exports = function () {
  tape('manifest', t => {
    const _api = {}
    const opts = {
      path: `/tmp/ssb-manifest-test-${Date.now()}-${Math.random()}`
    }
    const api = init(_api, opts)

    Object.keys(api).forEach(m => console.log(m))

    Object.keys(manifest).forEach(method => {
      t.equal(typeof api[method], 'function', `api.${method}`)
    })

    t.end()
  })
}

if (!module.parent) { module.exports({}) }
