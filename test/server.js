
var server = require('../server')
var cont = require('cont')
var net = require('net')
// create 3 servers
// give them all pub servers (on localhost)
// and get them to follow each other...

module.exports = function (opts) {

  var u = require('./util')(opts)

  var dbA = u.createDB('test-alice')
  var alice = dbA.createFeed()

  var dbB = u.createDB('test-bob')
  var bob = dbB.createFeed()

  var dbC = u.createDB('test-carol')
  var carol = dbC.createFeed()


  cont.para([
    alice.add('relay', {address: {host: 'localhost', port: 45451}}),
    bob  .add('relay', {address: {host: 'localhost', port: 45452}}),
    carol.add('relay', {address: {host: 'localhost', port: 45453}}),

    alice.add('flw', {$feed: bob.id,   $rel: 'follow'}),
    alice.add('flw', {$feed: carol.id, $rel: 'follow'}),

    bob  .add('flw', {$feed: alice.id, $rel: 'follow'}),
    bob  .add('flw', {$feed: carol.id, $rel: 'follow'}),

    carol.add('flw', {$feed: alice.id, $rel: 'follow'}),
    carol.add('flw', {$feed: bob.id,   $rel: 'follow'})
  ]) (function () {

    //since the other servers do not have 

    var serverA = server(dbA, alice, {
      port: 45451, host: 'localhost',
    })

    var serverB = server(dbB, bob, {
      port: 45452, host: 'localhost',
      seeds: [{port: 45451, host: 'localhost'}]
    })

    var serverC = server(dbC, carol, {
      port: 45453, host: 'localhost',
      seeds: [{port: 45451, host: 'localhost'}]
    })

  })

}

if(!module.parent)
  module.exports(require('../defaults'))
