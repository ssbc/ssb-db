var pl = require('pull-level')
var pull = require('pull-stream')
var Feed = require('./feed')
var para = require('pull-paramap')
var Blake2s = require('blake2s')
var varint = require('varstruct').varint
var codec = require('./codec')

var first = new Buffer([2])
var last = new Buffer(41) //1 + 8 + 32
last.fill(255)
last[0] = 2
var firstLatest = new Buffer([3])
var lastLatest = new Buffer(33)
lastLatest.fill(255)
lastLatest[0] = 3


function bsum (value) {
  return new Blake2s().update(value).digest()
}


module.exports = function (db, keys) {

  var feeds = {}

  return {
    feed: function (id, keys) {
      if('string' === typeof id)
        id = new Buffer(id, 'hex')
      if(id.public)
        keys = id, id = bsum(keys.public)
      return Feed(db, keys)
    },
    latest: function () {
      return pull(
        pl.read(db, {gte: firstLatest, lte: lastLatest}),
        pull.map(function (data) {
          return {
            key: codec.LatestKey.decode(data.key).id,
            value: varint.decode(data.value)
          }
        })
      )
    },
    createFeedStream: function (opts) {
      opts = opts || {}
      opts.keys = false
      return pull(
        pl.read(db, {gt: first, lte: last, keys: false}),
        para(function (key, cb) {
          db.get(key, cb)
        }),
        Feed.decodeStream()
      )
    }
  }

}
