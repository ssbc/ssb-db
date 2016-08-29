var ref    = require('ssb-ref')
var path = require('path')
var Follower = require('../follower')
var pull = require('pull-stream')
//53 bit integer
var MAX_INT  = 0x1fffffffffffff
var u = require('../util')

module.exports = function (db, opts) {

  var indexPath = path.join(opts.path, 'clock')
  var index = Follower(db, indexPath, 1, function (data) {
    if(data.sync) return
    return {
      key: [data.value.author, data.value.sequence], value: data.key, type: 'put'
    }
  })

  index.createHistoryStream = function (id, seq, limit) {
//    var _keys = true, _values = true, limit
    var _keys = true, _values = true
    var opts
    if(!ref.isFeedId(id)) {
      opts    = u.options(id)
      id      = opts.id
      seq     = opts.sequence || opts.seq || 0
      limit   = opts.limit
      _keys   = opts.keys !== false
      _values = opts.values !== false
    }

    return pull(
      clockDB.read({
        gte:  [id, seq],
        lte:  [id, MAX_INT],
        live: opts && opts.live,
        old: opts && opts.old,
        keys: false,
        sync: false === (opts && opts.sync),
        limit: limit
      }),
      db.lookup(_keys, _values)
    )



    return index.read(opts)
  }

  return index


}



