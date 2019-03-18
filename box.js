var ssbKeys = require('ssb-keys')
var u = require('./util')

function isString (s) {
  return typeof s === 'string'
}

var isArray = Array.isArray
function isFunction (f) { return typeof f === 'function' }

function unbox (data, unboxers, key) {
  var plaintext
  if (data && isString(data.value.content)) {
    for (var i = 0; i < unboxers.length; i++) {
      var unboxer = unboxers[i]

      if (isFunction(unboxer)) {
        plaintext = unboxer(data.value.content, data.value)
      } else {
        if (!key) key = unboxer.key(data.value.content, data.value)
        if (key) plaintext = unboxer.value(data.value.content, key)
      }

      if (plaintext) {
        var msg = {}
        for (var k in data.value) { msg[k] = data.value[k] }

        // set `meta.original.content`
        msg.meta = u.metaBackup(msg, 'content')

        // modify content now that it's saved at `meta.original.content`
        msg.content = plaintext

        // set meta properties for private messages
        msg.meta.private = true
        if (key) { msg.meta.unbox = key.toString('base64') }

        // backward-compatibility with previous property location
        // this property location may be deprecated in favor of `msg.meta`
        msg.cyphertext = msg.meta.original.content
        msg.private = msg.meta.private
        if (key) { msg.unbox = msg.meta.unbox }

        return { key: data.key, value: msg, timestamp: data.timestamp }
      }
    }
  }
  return data
}


module.exports = function (keys, opts) {

  var mainUnboxer = {
    key: function (content) { return ssbKeys.unboxKey(content, keys) },
    value: function (content, key) { return ssbKeys.unboxBody(content, key) }
  }

  function _unbox (data, key) {
    return unbox(data, unboxers, key)
  }

  var unboxers = [ mainUnboxer ]

  const unboxerMap = (msg, cb) => cb(null, _unbox(msg))
  const maps = [ unboxerMap ]
  const chainMaps = (val, cb) => {
    // assumes `maps.length >= 1`
    if (maps.length === 1) {
      maps[0](val, cb)
    } else {
      let idx = -1 // haven't entered the chain yet
      const next = (err, val) => {
        idx += 1
        if (err || idx === maps.length) {
          cb(err, val)
        } else {
          maps[idx](val, next)
        }
      }
      next(null, val)
    }
  }

  return {
    map: chainMaps,
    addUnboxer: function (unboxer) {
      unboxers.push(unboxer)
    },
    unbox: _unbox,
    addMap: function (fn) {
      maps.push(fn)
    }
  }
}

