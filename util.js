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

var reboxValue = exports.reboxValue = function (value, isPrivate) {
  if (isPrivate === true) return value

  var o = {}
  for (var key in value) {
    if (key == 'content')
      o[key] = value.cyphertext || value.content
    else if (key != 'cyphertext' && key != 'private' && key != 'unbox')
      o[key] = value[key]
  }

  return o
}

var rebox = exports.rebox = function (data, isPrivate) {
  return isPrivate === true ? data : {
    key: data.key, value: reboxValue(data.value, isPrivate),
    timestamp: data.timestamp,
    rts: data.rts
  }
}

exports.Format =
exports.formatStream = function (keys, values, isPrivate) {
  if('boolean' !== typeof isPrivate) throw new Error('isPrivate must be explicit')
  return Map(function (data) {
    if(data.sync) return data
    return keys && values ? rebox(data.value, isPrivate) : keys ? data.value.key : reboxValue(data.value.value, isPrivate)
  })
}

