
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

exports.await = function () {
  var waiting = [], value
  return {
    get: function () { return value },
    set: function (_value) {
      value = _value
      while(waiting.length)
        waiting.shift()(null, value)
    },
    await: function (cb) {
      if(value !== undefined) cb(null, value)
      else waiting.push(cb)
    }
  }
}



