var cont = require('cont')
var Message = require('./message')
var pull = require('pull-stream')
var cat = require('pull-cat')

function isFunction (f) {
  return 'function' === typeof f
}

function isString (s) {
  return 'string' === typeof s
}

module.exports = function (ssb, keys, opts) {

  var create = Message(opts)
  var prev = null
  var id = opts.hash(keys.public)

  var getting = null
  function getPrev(next) {
    ssb.getLatest(id, next)
  }

  function noop () {}

  var queue
  return {
    id: id,
    init: function (cb) {
      this.add({type: 'init', value: keys.public}, cb)
    },
    add: cont(function (type, message, cb) {
      if(isFunction(message))
        cb = message, message = type
      else
        message = {type: type, value: message}
    type = message.type

    if(!(isString(type) && type.length <= 32 && type.length >= 3))
      return cb(new Error(
        'type must be a string' +
        '3 <= type.length < 32, was:' + type
      ))

      if(!queue) {
        queue = []
        getPrev(function (err, _prev) {
          prev = _prev
          if(!prev && type !== 'init')
            queue.unshift({message: {type: 'init', value: keys.public}, cb: noop})
          write()
        })
      }

      queue.push({message: message, cb: cb})

      if(prev) write()

      function write () {
        while(queue.length) {
          var m = queue.shift()
          prev = create(keys, null, m.message, prev)
          ssb.add(prev, m.cb)
        }
      }
      return this
    }),
    keys: keys,
    createReplicationStream: function (opts, cb) {
      opts = opts || {}
      if(!opts.latest)
        opts.latest = function () {
          return cat([
            pull.values([id]),
            pull(
              ssb.feedsLinkedFrom(id, opts.rel || 'follow'),
              pull.map(function (link) {
                return link.dest
              })
            )
          ])
        }
      return ssb.createReplicationStream(opts, cb)
    }
  }
}
