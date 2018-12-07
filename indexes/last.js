var pull = require('pull-stream')
var pCont = require('pull-cont')
var Reduce = require('flumeview-reduce')

module.exports = function () {
  var createIndex = Reduce(1, function (acc, data) {
    if (!acc) acc = {}
    acc[data.value.author] = {
      id: data.key,
      sequence: data.value.sequence,
      ts: data.value.timestamp
    }
    return acc
  })

  return function (log, name) {
    var index = createIndex(log, name)
    index.methods.latest = 'source'

    index.latest = function (opts) {
      return pCont(function (cb) {
        index.get([], function (err, val) {
          if (err) return cb(err)
          cb(null, pull.values(Object.keys(val || {}).map(function (author) {
            return {
              id: author,
              sequence: val[author].sequence,
              ts: val[author].ts
            }
          })))
        })
      })
    }

    return index
  }
}
