var Follower = require('../follower')
var pull = require('pull-stream')
var path = require('path')
var ltgt = require('ltgt')
var u = require('../util')

module.exports = function (db) {

  var indexPath = path.join(db.location, 'feed')
  var index = Follower(db, indexPath, 1, function (data) {
    if(data.sync) return
    return {
      key: [data.value.timestamp, data.value.author],
      value: data.key, type: 'put'
    }
  })

  index.createFeedStream = function (opts) {
    opts = u.options(opts)
    //mutates opts
    ltgt.toLtgt(opts, opts, function (value) {
      return [value, u.lo]
    }, u.lo, u.hi)

    var _keys = opts.keys
    var _values = opts.values
    opts.keys = false
    opts.values = true

    return pull(
      index.read(opts),
      pull.through(console.log),
      db.lookup(_keys, _values) //XXX
    )
  }

  return index

}






