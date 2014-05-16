var pl = require('pull-level')
var pull = require('pull-stream')
var Feed = require('./feed')
var para = require('pull-paramap')

var first = new Buffer([2])
var last = new Buffer(41) //1 + 8 + 32
last.fill(255)
last[0] = 2

module.exports = function (db) {

  return {
    feed: function (keys) {
      return Feed(db, keys)
    },
    createFeedStream: function (opts) {
      opts = opts || {}
      opts.keys = false
      return pull(
        pl.read(db, {gt: first, lte: last, keys: false}),
        para(function (key, cb) {
          console.log('LOOKUP', key)
          db.get(key, cb)
        }),
        Feed.decodeStream()
      )
    }
  }

}
