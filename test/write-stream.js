'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var ssbKeys  = require('ssb-keys')


module.exports = function (opts) {
  var db = sublevel(level('test-ssb-feed', {
    valueEncoding: opts.codec
  }))

  var ssb = require('../')(db, opts)

  var create = require('../message')(ssbKeys)

  tape('write-stream', function (t) {
    var keys = ssbKeys.generate()

    var init = create(keys, 'init', {public: keys.public}, null)
    var q = [init]

    var l = 5
    while(l--) {
      var prev = q[q.length - 1]
      q.push(create(keys, 'msg', {count: l}, prev))
    }

    console.log(q)

    pull(
      pull.values(q),
      pull.asyncMap(function (data, cb) {
        setTimeout(function () {
          cb(null, data)
        }, ~~(Math.random()*500))
      }),
      ssb.createWriteStream(function (err) {
        if(err) throw err
        t.end()
      })
    )

  })


  tape('write-stream, overwrite', function (t) {

    var keys = ssbKeys.generate()

    var init = create(keys, 'init', {public: keys.public}, null)
    var q = [init]

    var l = 5
    while(l--) {
      var prev = q[q.length - 1]
      q.push(create(keys, 'msg', {count: l}, prev))
    }

    q.push(q[3])
    q.push(q[4])

    console.log(q)

    pull(
      pull.values(q),
      pull.asyncMap(function (data, cb) {
        setTimeout(function () {
          cb(null, data)
        }, ~~(Math.random()*500))
      }),
      ssb.createWriteStream(function (err) {
        if(err) throw err
        t.end()
      })
    )

  })


}

if(!module.parent)
  module.exports(require('../defaults'))

