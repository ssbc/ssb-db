'use strict'
var pull = require('pull-stream')
var ltgt = require('ltgt')
var u = require('../util')

var ViewLevel = require('flumeview-level')

function resolveTimestamp (msg) {
  // fallback to sync time if no user timestamp or timestamp is after sync time
  if (!msg.value.timestamp || msg.timestamp < msg.value.timestamp) {
    return msg.timestamp
  } else {
    return msg.value.timestamp
  }
}

module.exports = function (db) {
  var createIndex = ViewLevel(3, function (data) {
    return [[resolveTimestamp(data), data.value.author]]
  })

  return function (log, name) {
    var index = createIndex(log, name)
    index.methods.createFeedStream = 'source'
    index.createFeedStream = function (opts) {
      opts = u.options(opts)
      // mutates opts
      ltgt.toLtgt(opts, opts, function (value) {
        return [value, u.lo]
      }, u.lo, u.hi)

      var keys = opts.keys
      var values = opts.values
      opts.keys = true
      opts.values = true

      return pull(
        index.read(opts),
        pull.through(item => {
          if (item.value && item.key) {
            // make resolved timestamp available
            item.value.rts = item.key[0]
          }
        }),
        u.Format(keys, values, opts.private)
      )
    }

    return index
  }
}
