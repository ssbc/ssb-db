'use strict';

var pull      = require('pull-stream')
var tape      = require('tape')

var u         = require('../util')
var replicate = require('../replicate')

var toStream  = require('pull-stream-to-stream')

var net       = require('net')

//create a instance with a feed
//then have another instance follow it.

function rand (n) {
  var a = []
  while(n--)
    a.push(Math.random())
  return a
}

module.exports = function (opts) {

  var w = require('./util')(opts)

  tape('simple replicate', function (t) {

    var sbs1 = w.createDB('sbs-replicate1')
    var sbs2 = w.createDB('sbs-replicate2')

    var cb1 = u.groups(done)

    var f1 = w.init(sbs1, 5, cb1())
    var f2 = w.init(sbs2, 4, cb1())

    sbs2.follow(opts.hash(f1.public), cb1())
    sbs1.follow(opts.hash(f2.public), cb1())

    var ary = [], n = 1

    function done (err) {
      console.log('initialized')

      if(err) throw err
      var cb2 = u.groups(done2)

      var server = net.createServer(function (stream) {

        stream
          .pipe(toStream( replicate(sbs1, cb2()) ))
          .pipe(stream)

      }).listen(null, function () {

        var b = replicate(sbs2, cb2())

    console.log(b)

//        pull(a,
//          pull.through(function (e) {console.log('>>>', e); ary.push(e)}),
//          b,
//          pull.through(function (e) {console.log('<<<', e)}),
//          a)
//

        var stream = net.connect(server.address().port)
        stream.pipe(toStream( replicate(sbs2, cb2()) )).pipe(stream)
      })

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

}

if(!module.parent)
  module.exports(require('../defaults'))
