
var EventEmitter = require('events').EventEmitter

var pl = require('pull-level')
var pull = require('pull-stream')

var cont = require('cont')

function isHash (h) {
  return Buffer.isBuffer(h) && h.length == 32
}

function isString (s) {
  return 'string' === typeof s
}

function isFunction (f) {
  return 'function' === typeof f
}

var varstruct = require('varstruct')
var vmatch = require('varstruct-match')

function isHash(h) {
  return Buffer.isBuffer(h) && h.length == 32
}

// this is used to index the followers
var codec = exports.codec = {}

codec.Follow = varstruct({
  friend: varstruct.buffer(32),
  follow: varstruct.Int8, //1 or 0 for unfollow
  //a list of relays
  relays: varstruct.varstring(varstruct.varint),
  //a comment
  comment: varstruct.varstring(varstruct.varint),
})

codec.Relay = varstruct({
  relays: varstruct.varstring(varstruct.varint),
  comment: varstruct.varstring(varstruct.varint),
  owner: varstruct.buffer(32)
})

codec.FollowIndex = varstruct({
  //the message the follow occured in.
  messageId: varstruct.buffer(32),
  follow: varstruct.Int8
})

exports.name = 'friend'

exports.options = {
  valueEncoding: 'binary'
}

exports.init = function (ssb, followDb) {

  var emitter = new EventEmitter()

  followDb.options.valueEncoding = 'binary'

//  var followDb = ssb.sublevel('flw', {valueEncoding: 'binary'})
  var incoming = followDb.sublevel('in')
  var outgoing = followDb.sublevel('out')

  emitter.follow = cont(function (feed, obj, cb) {
    if(!obj || !isHash(obj.friend))
      return cb(new Error('must provide a friend id to follow'))

    if(obj.follow !== 0) obj.follow = 1

    obj.comment = obj.comment || ''
    obj.relays = obj.relays || []

    //THOUGHT: we need validation on every message, before write, after read.
    //         a bug that puts in an invalid message won't be pretty.
    //         probably also try-catch around things, and just skip that one.

    console.log(obj)
    console.log(codec.Follow.encode(obj))
    feed.add('friend', codec.Follow.encode(obj), cb)
  })

  emitter.unfollow = cont(function (feed, obj, cb) {
    obj.follow = 0
    return emitter.follow(feed, obj, cb)
  })

  ssb.pre(function (op, add) {
    if('put' !== op.type) return
    if(op.value.type.toString() !== 'friend') return

    var obj = codec.Follow.decode(op.value.message)

    var type = obj.follow ? 'put' : 'del'
    add({
      key: [op.value.author, obj.friend], value: op.key,
      prefix: outgoing, type: type
    })
    add({
      key: [obj.friend, op.value.author], value: op.key,
      prefix: incoming, type: type
    })
  })

  emitter.follows = function (source) {
    return pull(
      pl.read(outgoing, {gte: [source, null], lte: [source, undefined]}),
      pull.map(function (op) {
        return op.key[1]
      })
    )
  }

  emitter.followers = function (dest) {
    return pull(
      pl.read(incoming, {gte: [dest, null], lte: [dest, undefined]}),
      pull.map(function (op) {
        return op.key[1]
      })
    )
  }

  return emitter
}

