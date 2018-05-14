'use strict'
var pull = require('pull-stream')
var path = require('path')
var ltgt = require('ltgt')
var u = require('../util')

var ViewLevel = require('flumeview-level')

module.exports = function (db) {

  var createIndex = ViewLevel(2, function (data) {
    return [[data.value.timestamp, data.value.author]]
  })

  return function (log, name) {
    var index = createIndex(log, name)
    index.methods.createFeedStream = 'source'
    index.createFeedStream = function (opts) {
      opts = u.options(opts)
      //mutates opts
      ltgt.toLtgt(opts, opts, function (value) {
        return [value, u.lo]
      }, u.lo, u.hi)

      var keys = opts.keys
      var values = opts.values
      opts.keys = false
      opts.values = true

      return pull(index.read(opts), u.Format(keys, values, opts.private === true))
    }

    return index

  }
}












