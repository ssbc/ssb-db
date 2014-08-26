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

    var ssb1 = w.createDB('ssb-replicate1')
    var ssb2 = w.createDB('ssb-replicate2')

    ssb1.id = 1
    ssb2.id = 2

    var cb1 = u.groups(done)

    var f1 = w.init(ssb1, 1, cb1())
    var f2 = w.init(ssb2, 0, cb1())

    ssb2.follow(opts.hash(f1.public), cb1())
    ssb1.follow(opts.hash(f2.public), cb1())

    var ary = [], n = 1

    function done (err) {
      if(err) throw err
      var cb2 = u.groups(done2)

      var server = net.createServer(function (stream) {
        stream.on('data', console.log)
        stream
          .pipe(toStream( replicate(ssb1, cb2()) ))
          .pipe(stream)

      }).listen(null, function () {
        var stream = net.connect(server.address().port)
        stream.pipe(toStream( replicate(ssb2, cb2()) )).pipe(stream)
      })

      function done2 (err) {
        server.close()
        console.log('REPLICATED')
        if(err) throw err
        //now check that the databases have really been updated.

        var cbs = u.groups(next)

        pull(ssb1.createFeedStream(), pull.collect(cbs()))
        pull(ssb2.createFeedStream(), pull.collect(cbs()))

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
