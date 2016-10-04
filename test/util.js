var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var pull      = require('pull-stream')
var tape      = require('tape')
var createFeed = require('ssb-feed')
var ssbKeys   = require('ssb-keys')

var SSB       = require('../')
//var u         = require('../util')
var w         = require('./util')
var u = w


function rand (n) {
  var a = []
  while(n--)
    a.push(Math.random())
  return a
}


module.exports = function (opts) {

  var create = require('ssb-feed/util').create

  function createDB(name) {
    return SSB(sublevel(level(name, {
      valueEncoding: require('../codec')
    })), opts)
  }

  var MESSAGE = new Buffer('msg')

  function load (ssb, keys, n, cb) {
    var prev
    ssb.getLatest(keys.public, function (err, prev) {
      if(err) return cb(err)
      pull(
        pull.values(rand(n)),
        pull.asyncMap(function (r, cb) {
          ssb.add(prev =
            create(keys, 'msg', ''+r, prev), cb)
        }),
        pull.drain(null, cb)
      )
    })
  }

//  function init (ssb, n, cb) {
//    var keys = opts.keys.generate()
//    var prev
//
//    ssb.add(prev = create(keys, 'init', keys.public), function () {
//      pull(
//        pull.values(rand(n)),
//        pull.asyncMap(function (r, cb) {
//          ssb.add(prev =
//            create(keys, 'msg', ''+r, prev), cb)
//        }),
//        pull.drain(null, cb)
//      )
//    })
//      return keys
//  }
//
  function init2 (ssb, n, cb) {
    var feed = createFeed(ssb, ssbKeys.generate(), opts)
    var prev

    pull(
      pull.values(rand(n)),
      pull.asyncMap(function (r, cb) {
        feed.add('msg', ''+r, cb)
      }),
      pull.drain(null, cb)
    )

    return feed
  }



  function compareDbs (a, b, cb) {

    var cbs = u.groups(next)

    pull(a.createFeedStream(), pull.collect(cbs()))
    pull(b.createFeedStream(), pull.collect(cbs()))

    function next(err, ary) {
      cb(err, ary && ary[0], ary && ary[1])
    }
  }

  return {
    createDB: createDB,  init2: init2,
    compareDbs: compareDbs, load: load
  }

}
