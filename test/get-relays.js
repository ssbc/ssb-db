'use strict';

var pull     = require('pull-stream')
var tape     = require('tape')
var server   = require('../server')
var cont     = require('cont')
var compare = require('typewiselite')

function sort (ary) {
  return ary.sort(function (a, b) {
    return compare(a.id, b.id) || compare(a.address, b.address)
  })
}

function all(stream, cb) {
  pull(stream, pull.collect(cb))
}


module.exports = function (opts) {
  var w = require('./util')(opts)

  tape('create a ssb and retrive the relays for a given feed', function (t) {

    var ssb = w.createDB('get-relays')

    var alice = ssb.createFeed()
    var bob   = ssb.createFeed()
    var carol = ssb.createFeed()

    cont.series([
      alice.add('pub', {address:{host: 'localhost', port:65000}}),
      bob  .add('pub', {address:{host: 'localhost', port:65001}}),
      carol.add('pub', {address:{host: 'localhost', port:65002}}),
      alice.add('flw', {$feed: bob.id,   $rel: 'follow'}),
      alice.add('flw', {$feed: carol.id, $rel: 'follow'}),
      bob  .add('flw', {$feed: alice.id, $rel: 'follow'})
    ]) (function () {

    cont.para([
      function (cb) {
        all(server.getRelays(ssb, alice.id), function (err, ary) {
          t.deepEqual(sort(ary), sort([
    //        {id: alice.id, address: {host: 'localhost', port: 65000}},
            {id: bob.id, address:   {host: 'localhost', port: 65001}},
            {id: carol.id, address: {host: 'localhost', port: 65002}},
          ]))
          cb()
        })
      },
      function (cb) {
        all(server.getRelays(ssb, bob.id), function (err, ary) {
          t.deepEqual(sort(ary), sort([
            {id: alice.id, address: {host: 'localhost', port: 65000}},
  //          {id: bob.id, address: {host: 'localhost', port:65001}},
          ]))
          cb()
        })
      },
      function (cb) {
        all(server.getRelays(ssb, carol.id), function (err, ary) {
          t.deepEqual(sort(ary), sort([
//            {id: carol.id, address: {host:'localhost', port:65002}},
          ]))
          cb()
        })
      }
    ]) (function () {
      t.end()
    })

    })
  })
}

if(!module.parent) {
  module.exports(require('../defaults'))
}
