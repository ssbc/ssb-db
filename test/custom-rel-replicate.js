'use strict';

var pull = require('pull-stream')
var cont = require('cont')
var tape = require('tape')
var w = require('./util')(require('../defaults'))

var ssb1 = w.createDB('simple-following1.db')
var feed1 = ssb1.createFeed()

var ssb2 = w.createDB('simple-following2.db')
var feed2 = ssb2.createFeed()

var count = 0;

// Let's add some messages

tape('replicate some messages', function (t) {

  t.plan(8)

  cont.para([
    feed2.add({ type: 'follow', $feed: feed1.id, $rel: 'replicate' }),
    feed1.add('msg', 'hello there! ' + count++),
    feed1.add('msg', 'hello there! ' + count++),
    feed1.add('msg', 'hello there! ' + count++),
    feed1.add('msg', 'hello there! ' + count++),
    feed1.add('msg', 'hello there! ' + count++),
  ]) (function (err) {
      if(err) throw err
    // Adding a `follows` message causes feed2 to replicate messages added to feed1

      var a = feed1.createReplicationStream({$rel: 'replicate'})
      var b = feed2.createReplicationStream({$rel: 'replicate'}, function () {

      pull(
        ssb2.createLogStream(),
        pull.drain(function (message) {
          console.log('SSB2: ', message)
        })
      )

      })

      // pull-stream provides us with this convenient way
      //  to connect duplex streams
      pull(
        a,
        pull.through(console.log.bind(null, '>')),
        b,
        pull.through(console.log.bind(null, '<')),
        a
      )
    })

    pull(
      ssb2.createLogStream({ live: true }),
      pull.drain(function (message) {
        t.ok(message)
      })
    )

})
