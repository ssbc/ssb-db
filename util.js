const debug = require('debug')('ssb:secure-scuttlebutt:util')
var Map = require('pull-stream/throughs/map')
const console = require('console')

// opts standardized to work like levelup api
function stdopts (opts) {
  debug('stdopts: %o', opts)
  opts = opts || {}
  opts.keys   = opts.keys   !== false //default keys to true
  opts.values = opts.values !== false //default values to true
  return opts
}

function msgFmt (keys, values, obj) {
  debug('msgFmt: %o', opts)
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
  // setting `privateProps` for backward-compatibility
  const privateProps = ['cyphertext', 'private', 'unbox']

  const metaProps = privateProps.concat('meta')
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

const reboxValue = exports.reboxValue =  function (value, isPrivate) {
  if (isPrivate === true) return value

  const privateProps = ['cyphertext', 'private', 'unbox']

  var o = {}
  for (var key in value) {
    if (key == 'content')
      o[key] = value.cyphertext || value.content
    else if (!privateProps.includes(key))
      o[key] = value[key]
  }

  return o
}

var rebox = exports.rebox = function (data, isPrivate) {
  return isPrivate === true ? data : {
    key: data.key,
    value: reboxValue(data.value, isPrivate),
    timestamp: data.timestamp,
    rts: data.rts
  }
}

exports.Format = exports.formatStream = function (keys, values, opts) {
  debug('formatStream(keys, values, %o)', opts)
  let isPrivate = false
  let isOriginal = false

  if (typeof opts === 'boolean') {
    // backward-compat with legacy `isPrivate`
    isPrivate = opts
  } else {
    isPrivate = opts.private === true
    isOriginal = opts.original === true
    if (isPrivate && isOriginal) {
      throw new Error('opts.private and opts.original are mutually exclusive')
    }
  }

  if (typeof isPrivate !== 'boolean') throw new Error('isPrivate must be explicit')

  let extractData
  let extractValue

  if (isOriginal) {
    extractData = originalData
    extractValue = originalValue
  } else {
    extractData = rebox
    extractValue = reboxValue
  }

  return Map(function (data) {
    if (data.sync) return data
    return keys && values ? extractData(data.value, isPrivate) : keys ? data.value.key : extractValue(data.value.value, isPrivate)
  })
}
