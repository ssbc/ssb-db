var pull = require('pull-stream')
var ltgt = require('ltgt')
var ViewLevel = require('flumeview-level')

var u = require('../util')
var Format = u.formatStream

function isString (s) {
  return typeof s === 'string'
}

module.exports = function () {
  function indexMsg (localtime, id, msg) {
    var content = msg.content

    // couldn't decrypt, this message wasn't for us
    if (isString(content)) return []

    var a = []

    if (isString(content.type)) {
      a.push(['type', content.type.toString().substring(0, 32), localtime])
    }

    return a
  }

  var createIndex = ViewLevel(2, function (data) {
    return indexMsg(data.timestamp, data.key, data.value)
  })

  return function (log, name) {
    var index = createIndex(log, name)

    index.methods = {
      messagesByType: 'source',
    }

    index.messagesByType = function (opts) {
      if (!opts) { throw new Error('must provide {type: string} to messagesByType') }

      if (isString(opts)) { opts = { type: opts } }

      opts = u.options(opts)
      var keys = opts.keys !== false
      var values = opts.values !== false
      opts.values = true

      ltgt.toLtgt(opts, opts, function (value) {
        return ['type', opts.type, value]
      }, u.lo, u.hi)

      return pull(
        index.read(opts),
        Format(keys, values, opts.private)
      )
    }

    return index
  }
}
