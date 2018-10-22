var Map = require('pull-stream/throughs/map')

// opts standardized to work like levelup api
function stdopts (opts) {
  opts = opts || {}
  opts.keys   = opts.keys   !== false //default keys to true
  opts.values = opts.values !== false //default values to true
  return opts
}

function msgFmt (keys, values, obj) {
  if (keys && values)
    return obj
  if (keys)
    return obj.key
  if (values)
    return obj.value
  return null // i guess?
}

exports.options = stdopts
exports.format = msgFmt

exports.lo = null
exports.hi = undefined

exports.wait = function () {
  var waiting = [], value
  return {
    get: function () { return value },
    set: function (_value) {
      value = _value

      var l = waiting.length;
      for (var i = 0; i < l; ++i)
        waiting[i](null, value)
      waiting = waiting.slice(l)
    },
    wait: function (cb) {
      if(value !== undefined) cb(null, value)
      else waiting.push(cb)
    }
  }
}

const originalValue = exports.originalValue = function (value) {
  // setting `oldProps` for backward-compatibility with old metadta
  const oldProps = ['cyphertext', 'private', 'unbox']

  const metaProps = oldProps.concat('meta')
  const original = value.meta && value.meta.original || {}

  var o = {}
  for (var key in value) {
    if (!metaProps.includes(key))
      o[key] = original[key] || value[key]
  }

  return o
}

var originalData = exports.originalData = function (data) {
  return {
    key: data.key,
    value: originalValue(data.value),
    timestamp: data.timestamp,
    rts: data.rts
  }
}

exports.Format = exports.formatStream = function (keys, values, isOriginal) {
  let extract

  if (isOriginal) {
    extract = data => {
      return keys && values ? originalData(data.value) : keys ? data.value.key : originalValue(data.value.value)
    }
  } else {
    extract = data => {
      return keys && values ? data.value : keys ? data.value.key : data.value.value
    }
  }

  return Map(function (data) {
    if (data.sync) return data
    return extract(data)
  })
}
