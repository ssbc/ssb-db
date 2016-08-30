var ref    = require('ssb-ref')
var path = require('path')
var Follower = require('../follower')
var pull = require('pull-stream')
var ltgt = require('ltgt')
//53 bit integer
var MAX_INT  = 0x1fffffffffffff
var u = require('../util')

module.exports = function (db, opts) {

  var indexPath = path.join(db.location, 'clock')
  var index = Follower(db, indexPath, 1, function (data) {
    if(data.sync) return
    return {
      key: [data.value.author, data.value.sequence], value: data.key, type: 'put'
    }
  })

  index.createHistoryStream = function (opts) {
    var opts    = u.options(opts)
    var id      = opts.id
    var seq     = opts.sequence || opts.seq || 0
    var limit   = opts.limit
    return pull(
      index.read({
        gte:  [id, seq],
        lte:  [id, MAX_INT],
        live: opts && opts.live,
        old: opts && opts.old,
        keys: false,
        sync: false === (opts && opts.sync),
        limit: limit
      }),
      db.lookup(opts.keys !== false, opts.values !== false)
    )
  }

  index.createUserStream = function (opts) {
    opts = u.options(opts)
    //mutates opts
    ltgt.toLtgt(opts, opts, function (value) {
      return [opts.id, value]
    }, u.lo, u.hi)
    var keys = opts.keys, values = opts.values
    opts.keys = false
    opts.values = true
    console.log(opts)
    return pull(
      index.read(opts),
      db.lookup(keys, values)
    )
  }

  return index


}










