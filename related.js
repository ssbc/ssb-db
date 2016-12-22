var compare   = require('typewiselite')
var pull      = require('pull-stream')

function isString (s) {
  return 'string' === typeof s
}

function all (stream) {
  return function (cb) {
    pull(stream, pull.collect(cb))
  }
}

module.exports = function (db) {
  return function (opts, cb) {
    if(isString(opts)) opts = {key: opts}
    if(!opts) throw new Error('opts *must* be object')
    var key = opts.id || opts.key
    var depth = opts.depth || Infinity
    var seen = {}

    //filter a list of rel, used to avoid 'branch' rel in patchwork,
    //which causes messages to be queried twice.
    var n = 1
    var msgs = {key: key, value: null}
    db.get(key, function (err, msg) {
      msgs.value = msg
      if (err && err.notFound)
        err = null // ignore not found
      done(err)
    })

    related(msgs, depth)

    function related (msg, depth) {
      if(depth <= 0) return
      if (n<0) return
      n++
      all(db.links({dest: msg.key, rel: opts.rel, keys: true, values:true, meta: false, type:'msg'}))
      (function (err, ary) {
        if(ary && ary.length) {
          msg.related = ary = ary.sort(function (a, b) {
            return compare(a.value.timestamp, b.value.timestamp) || compare(a.key, b.key)
          }).filter(function (msg) {
            if(seen[msg.key]) return
            return seen[msg.key] = true
          })
          ary.forEach(function (msg) { related (msg, depth - 1) })
        }
        done(err)
      })
    }

    function count (msg) {
      if(!msg.related)
        return msg
      var c = 0
      msg.related.forEach(function (_msg) {
        if(opts.parent) _msg.parent = msg.key
        c += 1 + (count(_msg).count || 0)
      })
      if(opts.count) msg.count = c
      return msg
    }

    function done (err) {
      if(err && n > 0) {
        n = -1
        return cb(err)
      }
      if(--n) return
      cb(null, count(msgs))
    }
  }
}

