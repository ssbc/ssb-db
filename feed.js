var cont = require('cont')
var Message = require('./message')
var pull = require('pull-stream')
var cat = require('pull-cat')

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
      this.add('init', keys.public, cb)
    },
    add: cont(function (type, message, cb) {
      if(!queue) {
        queue = []
        getPrev(function (err, _prev) {
          prev = _prev
          if(!prev && type !== 'init')
            queue.unshift({type: 'init', message: keys.public, cb: noop})
          write()
        })
      }

      queue.push({type: type, message: message, cb: cb})

      if(prev) write()

      function write () {
        while(queue.length) {
          var m = queue.shift()
          prev = create(keys, m.type, m.message, prev)
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
