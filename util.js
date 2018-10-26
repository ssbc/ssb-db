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
  if (value.meta) {
    if (value.meta.original) {
      Object.entries(value.meta.original).forEach(entry => {
        value[entry[0]] = entry[1]
      })
    }
    delete value.meta
  }

  // Delete unboxer metadata, which exists for backward-compatibility.
  delete value.cyphertext
  delete value.private
  delete value.unbox

  return value
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

/**
 * Backs up a value from `msg.value` to `msg.value.meta.original` in a simple
 * and idiomatic way. This works regardless of whether `msg.value.meta` exists
 * and should be used any time values are modified with `addMap()`.
 *
 * @param {object} msgValue - the `value` property of a message (usually `msg.value`)
 * @param {string} property - name property that should be backed up
 *
 * @example
 * metaBackup({ type: 'post', content: 'hello world', 'content')
 * // => { meta: { original: { content: 'hello world' } } }
 *
 * @example
 * var msg = { value: { type: 'post', content: 'bar' } }
 * msg.value.meta = metaBackup(msg.value, 'content')
 * msg.value.content = 'foo was here'
 * msg.value.meta.original.content // => 'bar'
 *
 * @returns {object} Returns a `meta` object with the property backed up.
 */
exports.metaBackup = (msgValue, property) => {
  const original = { [property]: msgValue[property] }

  if (!msgValue.meta) {
    msgValue.meta = { original }
  } else if (!msgValue.meta.original) {
    msgValue.meta.original = original
  } else if (!msgValue.meta.original[property]) {
    msgValue.meta.original[property] = original[property]
  }

  return msgValue.meta
}
