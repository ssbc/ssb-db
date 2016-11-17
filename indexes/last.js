var pull = require('pull-stream')
var path = require('path')
var ltgt = require('ltgt')
var u = require('../util')

var ViewLevel = require('flumeview-level')

function isNumber (n) {
  return typeof n === 'number'
}

function toSeq (latest) {
  return isNumber(latest) ? latest : latest.sequence
}

module.exports = function () {

  //TODO: rewrite as a flumeview-reduce
  var createIndex = ViewLevel(1, function (data) {
    return [data.value.author]
  })

  return function (log, name) {
    var index = createIndex(log, name)
    index.methods.latest = 'source'

    index.latest = function (opts) {
      opts = opts || {}
      if(opts.gt == null)
        opts.gt = new Buffer([0])
      return pull(
        index.read(opts),
        pull.map(function (data) {
          var d = {id: data.key, sequence: toSeq(data.value.value), ts: data.value.timestamp }
          return d
        })
      )
    }

    return index

  }
}


