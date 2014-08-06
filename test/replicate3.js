'use strict';

var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var pull      = require('pull-stream')
var ecc       = require('eccjs')
var tape      = require('tape')

var SSB       = require('../')
var u         = require('../util')
var replicate = require('../replicate')

var codec     = require('../codec')
var JSONB     = require('json-buffer')

//create a instance with a feed
//then have another instance follow it.

function rand (n) {
  var a = []
  while(n--)
    a.push(Math.random())
  return a
}

module.exports = function (opts) {

  var create = require('../message')(opts)

  function createDB(name) {
    return SSB(sublevel(level(name, {
      valueEncoding: 
        require('../codec')
//      {
//        encode: JSONB.stringify,
//        decode: JSONB.parse,
//        buffer: false
//      }
    })), opts)
  }

  var MESSAGE = new Buffer('msg')

  function init (ssb, n, cb) {
    var keys = opts.keys.generate()
    var prev

    ssb.add(prev = create(keys, 'init', keys.public), function () {
      pull(
        pull.values(rand(n)),
        pull.asyncMap(function (r, cb) {
          ssb.add(prev =
            create(keys, 'msg', ''+r, prev), cb)
        }),
        pull.drain(null, cb)
      )
    })
      return keys
  }

  function compareDbs (a, b, cb) {

    var cbs = u.groups(next)

    pull(a.createFeedStream(), pull.collect(cbs()))
    pull(b.createFeedStream(), pull.collect(cbs()))

    function next(err, ary) {
      cb(err, ary && ary[0], ary && ary[1])
    }
  }

  tape('simple replicate', function (t) {

    var sbs1 = createDB('sbs-replicate1')
    var sbs2 = createDB('sbs-replicate2')

    var cb1 = u.groups(done)

    var f1 = init(sbs1, 5, cb1())
    var f2 = init(sbs2, 4, cb1())

    sbs2.follow(opts.hash(f1.public), cb1())
    sbs1.follow(opts.hash(f2.public), cb1())

    var ary = [], n = 1

    function done (err) {
      console.log('initialized')

      if(err) throw err
      var cb2 = u.groups(done2)

      var a = replicate(sbs1, cb2())
      var b = replicate(sbs2, cb2())

      pull(a,
        pull.through(function (e) {console.log('>>>', e); ary.push(e)}),
        b,
        pull.through(function (e) {console.log('<<<', e)}),
        a)

      function done2 (err) {
        console.log('REPLICATED')
        if(err) throw err
        //now check that the databases have really been updated.

        var cbs = u.groups(next)

        pull(sbs1.createFeedStream(), pull.collect(cbs()))
        pull(sbs2.createFeedStream(), pull.collect(cbs()))

        function next (err, ary) {
          if(err) throw err

          t.deepEqual(ary[0], ary[1])

          console.log('replicated!!!')
          t.end()
        }
      }
    }
  })
  return

  tape('3-way replicate', function (t) {

    var sbs1 = createDB('sbs-3replicate1')
    var sbs2 = createDB('sbs-3replicate2')
    var sbs3 = createDB('sbs-3replicate3')

    var cb1 = u.groups(done)

    var f1 = init(sbs1, 10, cb1())
    var f2 = init(sbs2, 15, cb1())
    var f3 = init(sbs3, 20, cb1())

    sbs1.follow(opts.hash(f2.public), cb1())
    sbs1.follow(opts.hash(f3.public), cb1())

    sbs2.follow(opts.hash(f1.public), cb1())
    sbs2.follow(opts.hash(f3.public), cb1())

    sbs3.follow(opts.hash(f1.public), cb1())
    sbs3.follow(opts.hash(f2.public), cb1())


    var ary = []

    function done (err) {
      if(err) throw err
      var cb2 = u.groups(done2)

      var a = replicate(sbs1, cb2())
      var b = replicate(sbs2, cb2())

      pull(
        a,
        pull.through(function (e) {console.log('>>>', e)}),
        b,
        pull.through(function (e) {console.log('>>>', e)}),
        a
      )

      function done2 (err) {
        if(err) throw err
        //now check that the databases have really been updated.

        var cb3 = u.groups(done3)

        var c = sbs3.createReplicationStream(cb3())
        var d = sbs2.createReplicationStream(cb3())

        pull(
          c,
          pull.through(function (e) {console.log('>>>', e)}),
          d,
          pull.through(function (e) {console.log('>>>', e)}),
          c
        )

        function done3 (err) {
          if(err) throw err

          var cbs = u.groups(next)

          pull(sbs2.createFeedStream(), pull.collect(cbs()))
          pull(sbs3.createFeedStream(), pull.collect(cbs()))

          function next (err, ary) {
            if(err) throw err

            t.deepEqual(ary[0], ary[1])

            console.log('replicated!!!')
            t.end()
          }
        }
      }
    }
  })


}

if(!module.parent)
  module.exports(require('../defaults'))
