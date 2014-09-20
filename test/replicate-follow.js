'use strict';

var pull      = require('pull-stream')
var tape      = require('tape')
var net       = require('net')

var u         = {groups: require('./group')}
var replicate = require('../replicate')
var cat       = require('pull-cat')

//create a instance with a feed
//then have another instance follow it.

function rand (n) {
  var a = []
  while(n--)
    a.push(Math.random())
  return a
}
var z = 0

module.exports = function (opts, duplexPipe, name) {
  var s = z++
  var w = require('./util')(opts)

  //used to hash the feed output to make assertion failures easier to eyeball.
  function hash(msg) {
    return opts.hash(opts.codec.encode(msg)).toString('hex')
  }

  function log(name) {
    return function (sent, recv) {
      console.error(name, (100*sent).toPrecision(3), (100*recv).toPrecision(3))
    }
  }

  function follow(me, other, cb) {
    me.add('flw', {follow: {$feed: other, $rel: 'follow'}}, cb)
  }

  function followers(ssb, id) {
    return cat([
      pull.values([id]),
      pull(
        ssb.feedsLinkedFrom(id, 'follow'),
        pull.map(function (link) {
          return link.dest
        })
      )
    ])
  }

  function createReplicationStream (ssb, id, name, cb) {
    return replicate(ssb, {
          progress: log(name),
          latest: function () { return followers(ssb, id) }
        }, cb)
  }

  function createSimple(n,m) {
    tape(name + ': simple replicate ' + JSON.stringify([n,m]), function (t) {
      var s = ''+ z++

      var ssb1 = w.createDB('sbs-replicate1_' + name + s)
      var ssb2 = w.createDB('sbs-replicate2_' + name + s)

      var cb1 = u.groups(done)

      var alice = w.init2(ssb1, n, cb1())
      var bob = w.init2(ssb2, m, cb1())

      follow(alice, bob.id, cb1())
      follow(bob, alice.id, cb1())

      var ary = [], n = 1

      function done (err) {

        if(err) throw err
        var cb2 = u.groups(done2)

        var a = alice.createReplicationStream ({progress: log('A')}, cb2())
        var b = bob.createReplicationStream ({progress: log('B')}, cb2())

        duplexPipe(a, b)

        function done2 (err) {
          if(err) throw err
          //now check that the databases have really been updated.

          var cbs = u.groups(done3)

          pull(ssb1.createFeedStream(), pull.collect(cbs()))
          pull(ssb2.createFeedStream(), pull.collect(cbs()))

          function done3 (err, ary) {
            if(err) throw err
            t.deepEqual(ary[0].map(hash), ary[1].map(hash))
            t.end()
          }
        }
      }
    })

  }

  createSimple(1, 1)
  createSimple(1, 2)
  createSimple(3, 2)

  function runReplication (ssb1, ssb2, alice, bob, cb) {

    var cb2 = u.groups(done2)

    var a = alice.createReplicationStream ({progress: log('A')}, cb2())
    var b = bob.createReplicationStream ({progress: log('B')}, cb2())

    duplexPipe(a, b)

    function done2 (err) {
      if(err) throw err
      //now check that the databases have really been updated.

      var cbs = u.groups(next)

      pull(ssb1.createFeedStream(), pull.collect(cbs()))
      pull(ssb2.createFeedStream(), pull.collect(cbs()))

      function next (err, ary) {
        cb(err, ary)
      }
    }
  }

  tape(name + ': replicate when already in sync', function (t) {
    var s = ''+ z++

    var ssbA = w.createDB('sbs-replicate1_' + name + s)
    var ssbB = w.createDB('sbs-replicate2_' + name + s)

    var cb1 = u.groups(next)

    var alice = w.init2(ssbA, 5, cb1())
    var bob = w.init2(ssbB, 4, cb1())

    follow(bob, alice.id, cb1())
    follow(alice, bob.id, cb1())

    function next (err) {
      if(err) throw err

      runReplication(ssbA, ssbB, alice, bob, function (err, ary) {
        t.deepEqual(ary[0].map(hash), ary[1].map(hash))
        //*******************************************

        console.log('replicate when already in sync!')
        runReplication(ssbA, ssbB, alice, bob, function (err, ary) {

          t.deepEqual(ary[0].map(hash), ary[1].map(hash))
          console.log('replicated!!!')
          t.end()

        })
      })
    }
  })

  tape(name + ': replicate when already in sync', function (t) {

    var s = ''+ z++

    var ssbA = w.createDB('sbs-replicate1_' + name + s)
    var ssbB = w.createDB('sbs-replicate2_' + name + s)

    var cb1 = u.groups(next)

    var alice = w.init2(ssbA, 5, cb1())
    var bob = w.init2(ssbB, 4, cb1())

    follow(alice, bob.id, cb1())
    follow(bob, alice.id, cb1())

    function next (err) {
      if(err) throw err

      runReplication(ssbA, ssbB, alice, bob, function (err, ary) {
        t.deepEqual(ary[0].map(hash), ary[1].map(hash))
        //*******************************************
        var cb2 = u.groups(next)

        w.load(ssbA, alice.keys, 3, cb2())
        w.load(ssbA, bob.keys, 2, cb2())

        function next () {

          console.log('replicate after updating')
          runReplication(ssbA, ssbB, alice, bob, function (err, ary) {

            t.deepEqual(ary[0].map(hash), ary[1].map(hash))
            console.log('replicated!!!')
            t.end()
          })
        }
      })
    }
  })

  tape(name + ': 3-way replicate', function (t) {

    var ssbA = w.createDB('sbs-3replicate1_' + name + s)
    var ssbB = w.createDB('sbs-3replicate2_' + name + s)
    var ssbC = w.createDB('sbs-3replicate3_' + name + s)

    var cb1 = u.groups(done)

    var alice = w.init2(ssbA, 10, cb1())
    var bob   = w.init2(ssbB, 15, cb1())
    var carol = w.init2(ssbC, 20, cb1())

    follow(alice, bob.id, cb1())
    follow(alice, carol.id, cb1())

    follow(bob, alice.id, cb1())
    follow(bob, carol.id, cb1())

    follow(carol, alice.id, cb1())
    follow(carol, bob.id, cb1())

    var ary = []

    function done (err) {
      if(err) throw err
      var cb2 = u.groups(done2)

      var a = alice.createReplicationStream ({progress: log('A')}, cb2())
      var b = bob.createReplicationStream ({progress: log('B')}, cb2())

      duplexPipe(a, b)

      function done2 (err) {
        if(err) throw err
        //now check that the databases have really been updated.

        var cb3 = u.groups(done3)

        var c = carol.createReplicationStream ({progress: log('C')}, cb3())
        var b2 = bob.createReplicationStream ({progress: log('B')}, cb3())

        duplexPipe(c, b2)

        function done3 (err) {
          if(err) throw err

          var cbs = u.groups(done4)

          pull(ssbB.createFeedStream(), pull.collect(cbs()))
          pull(ssbC.createFeedStream(), pull.collect(cbs()))

          function done4 (err, ary) {
            if(err) throw err

            t.deepEqual(ary[0].map(hash), ary[1].map(hash))

            console.log('replicated!!!')
            t.end()
          }
        }
      }
    }
  })

}

if(!module.parent) {
  var opts = require('../defaults')

  module.exports(opts, function (a, b) {
    pull(a, b, a)
  }, 'pull-stream')

  var toStream = require('pull-stream-to-stream')
  module.exports(opts, function (a, b) {
    var server = net.createServer(function (stream) {
      stream.pipe(toStream(a)).pipe(stream)
    }).listen(function () {
      var stream = net.connect(server.address().port)
      stream.pipe(toStream(b)).pipe(stream)
      stream.on('close', function () {
        server.close()
      })
    })
  }, 'net')

}
