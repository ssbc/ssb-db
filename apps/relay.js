var EventEmitter = require('events').EventEmitter
var codec = require('./codec')
var pl = require('pull-level')
var pull = require('pull-stream')

var cont = require('cont')

function isHash (h) {
  return Buffer.isBuffer(h) && h.length == 32
}

module.exports = function (ssb, friends) {

  var relayDb = ssb.sublevel('rly')

  var relays = new EventEmitter()

  ssb.pre(function (op, add) {
    if(op.value.type !== 'relay') return

    var data = codec.Relay.decode(op.value.message)

    add({
      key: op.value.author, value: op.key,
      type: 'put', prefix: relayDb
    })
  })

  relays.announce = cont(function (feed, opts, cb) {
    opts = opts || {}
    if(!isHash(opts.owner))
      return cb(new Error('must have relay owner'))

    var data = codec.Relay.encode({
      relays: opts.relays || '',
      comment: opts.comments || '',
      owner: opts.owner
    })
    feed.add('relay', data, cb)
  })

//  relays.relayers = cont(function (friend, cb) {
//    relayDb.get(friend, function (err, value) {
//      if(err) return cb(err)
//      ssb.get(value, cb)
//    })
//  })

  relays.allRelays = function (opts) {
    opts = opts || {}
    opts.keys = false
    return pull(
      pl.read(relayDb, opts),
      pull.mapAsync(function (key, cb) {
        ssb.get(value, cb)
      })
    )
  }

  //get the immeditale relay for this node.
  relays.get = function (id, cb) {
    relayDb.get(id, function (err, value) {
      if(err) return cb()
      ///look up the message
      ssb.get(value, function (err, msg) {
        if(err) return cb(err)
        cb(null, codec.Relay.decode(msg.message), msg)
      })
    })
  }

  //1. look up friends, check if each one has a relay.

  //get all the friends who are easy to relay with.
  //traverse all your friends from the start, and check whether they have a relay.
  relays.relayable = function (start) {
    return pull(
      friends.follows(start),
      pull.mapAsync(function (id, cb) {
        relays.get(id, function (err, value) {
          if(err) return cb()
          cb(null, value)
        })
      }),
      pull.filter(Boolean)
    )
  }

  // you don't have to follow the relay, but you do have to know about
  // it to connect to it. maybe nodes can announce hints about where to get
  // their data? that would be given in the introduction token.

  // then it would be easy to give out introductions for others, too

  // So, hopefully multiple parties relay you, and you can mention a hint
  // that a,b,c can relay you. that way if someone doesn't actually follow
  // the relay then you can be relayed by them?

  // Or... maybe the answer is just to connect to the relays you know about?

  // no. each node announces a relay it is reachable at, along with
  // the relay's owner id.
  // then nodes can replicate that information, AND will be able to follow
  // the owner of that relay. Rewarding that relay owner with more followers.

  // ---

  // so what queries do I need to be able to do for this?
  // friends -> their relays

  // then pick a relay, and replicate.
  // TODO figure out smart way to choose best relays.

  // basically, just track how much data you are getting from each node.
  // it's just back pressure. nodes need a way to slow each other down.
  // and to give each other a boost. They each have an expectation for QoS
  // and they can intentionally underdeliver, or they can go faster as a reward.
  // it's the same as bit torrent throtteling, or bitswap or stream backpressure.
  //
  // or dancing.

  // okay so how do we build apps into ssb?
}
