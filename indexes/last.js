//var Follower = require('../follower')
var pull = require('pull-stream')
var path = require('path')
var ltgt = require('ltgt')
var u = require('../util')

var ViewLevel = require('flumeview-level')

function isNumber (n) {
  return typeof n === 'number'
}

function toSeq (latest) {
  return isNumber(latest) ? latest : latest.sequence
}

module.exports = function () {

  return ViewLevel(1, function (data) {
    return [data.value.author]
  })

//  var indexPath = path.join(db.location, 'last')
//  var index = Follower(db, indexPath, 1, function (data) {
//    if(data.sync) return
//
//    return {
//      key: data.value.author, value: {sequence: data.value.sequence, ts: data.timestamp },
//      type: 'put'
//    }
//  })
//
  index.latest = function (opts) {
    opts = opts || {}
//    if(!(opts.gt || opts.gte))
//      opts.gt = '\x00'
    return pull(
      index.read(opts),
      pull.map(function (data) {
        var d = {id: data.key, sequence: toSeq(data.value)/*, ts: data.value.ts*/ }
        return d
      })
    )
  }

  return index

}



