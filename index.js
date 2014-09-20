'use strict';

var contpara  = require('continuable-para')
var pull      = require('pull-stream')
var pl        = require('pull-level')
var paramap   = require('pull-paramap')
var replicate = require('./replicate')
var timestamp = require('monotonic-timestamp')
var Feed      = require('./feed')
var assert    = require('assert')
var msgpack   = require('msgpack-js')

//this makes msgpack a valid level codec.
msgpack.buffer = true

//var u         = require('./util')

//53 bit integer
var MAX_INT  = 0x1fffffffffffff


function isString (s) {
  return 'string' === typeof s
}

function isFunction (f) {
  return 'function' === typeof f
}

var isBuffer = Buffer.isBuffer
var isArray = Array.isArray
function isObject (o) { return o && 'object' === typeof o }


function traverse (obj, each) {
  if(Buffer.isBuffer(obj) || !isObject(obj)) return
  if(!isArray(obj)) each(obj)
  for(var k in obj) {
    if(isObject(obj[k])) traverse(obj[k], each)
  }
}

function indexLinks (msg, each) {
  traverse(msg, function (obj) {
    if(obj.$rel && (obj.$msg || obj.$ext || obj.$feed)) each(obj)
  })
}

module.exports = function (db, opts) {

  var logDB   = db.sublevel('log')
  var feedDB  = db.sublevel('fd')
  var clockDB = db.sublevel('clk')
  var lastDB  = db.sublevel('lst')
  var indexDB = db.sublevel('idx', {valueEncoding: msgpack})
  var appsDB  = db.sublevel('app')

  function get (db, key) {
    return function (cb) { db.get(encode(key), cb) }
  }

  db.opts = opts

  var isHash = opts.isHash

  var validation = require('./validation')(db, opts)

  db.pre(function (op, add, _batch) {
    var msg = op.value
    var id = op.key
    // index by sequence number
    add({
      key: [msg.author, msg.sequence], value: id,
      type: 'put', prefix: clockDB
    })

    // index my timestamp, used to generate feed.
    add({
      key: [msg.timestamp, msg.author], value: id,
      type: 'put', prefix: feedDB
    })

    // index the latest message from each author
    add({
      key: msg.author, value: msg.sequence,
      type: 'put', prefix: lastDB
    })

    // index messages in the order _received_
    // this will be used to pass to plugins which
    // must create their indexes asyncly.
    add({
      key: timestamp(), value: id,
      type: 'put', prefix: logDB
    })

    indexLinks(msg.message, function (link) {

      if(isHash(link.$feed)) {
        add({
          key: ['feed', msg.author, link.$rel, link.$feed, msg.sequence, id],
          value: link,
          type: 'put', prefix: indexDB
        })
        add({
          key: ['_feed', link.$feed, link.$rel, msg.author, msg.sequence, id],
          value: link,
          type: 'put', prefix: indexDB
        })
      }

      if(isHash(link.$msg)) {
        // do not need forward index here, because
        // it's cheap to just read the message.

        add({
          key: ['_msg', link.$msg, link.$rel, id], value: link,
          type: 'put', prefix: indexDB
        })
      }

      //TODO, add $ext links

    })

  })

  db.getPublicKey = function (id, cb) {
    function cont (cb) {
      clockDB.get([id, 1], function (err, hash) {
      if(err) return cb(err)
        db.get(hash, function (err, msg) {
          if(err) return cb(err)
          cb(null, msg.message)
        })
      })
    }
    return cb ? cont(cb) : cont
  }

  //msg must be an already valid message, with signature.
  //since creating this involves some state (it must increment
  //the sequence and point to the previous message)
  //it's recommended to append messages via a Feed object
  //which will manage that for you. (see feed.js)

  db.add = function (msg, cb) {
    //check that msg is valid (follows from end of database)
    //then insert into database.
    var n = 1
    validation.validate(msg, function (err, msg, hash) {
      if(--n) throw new Error('called twice')
      cb && cb(err, msg, hash)
    })
  }

  db.createFeedStream = function (opts) {
    opts = opts || {}
    opts.keys = false
    return pull(
      pl.read(feedDB, opts),
      paramap(function (key, cb) {
        db.get(key, cb)
      })
    )
  }

  db.latest = function (opts) {
    return pull(
      pl.read(lastDB),
      pull.map(function (data) {
        var d = {id: data.key, sequence: data.value}
        return d
      })
    )
  }

  db.follow = function (other, cb) {
    if(!isHash(other)) return cb(new Error('follow *must* be called with id'))
    lastDB.put(other, 0, cb)
  }

  db.unfollow = function (other, cb) {
    lastDB.del(other, cb)
  }

  db.isFollowing = function (other, cb) {
    lastDB.get(other, cb)
  }

  db.following = function () {
    return pl.read(lastDB)
  }

  db.createHistoryStream = function (id, seq, live) {
    return pull(
      pl.read(clockDB, {
        gte:  [id, seq],
        lte:  [id, MAX_INT],
        tail: live, live: live,
        keys: false
      }),
      paramap(function (key, cb) {
        db.get(key, cb)
      })
    )
  }

  db.createWriteStream = function (cb) {
    return pull(
      paramap(function (data, cb) {
        db.add(data, cb)
      }),
      pull.drain(null, cb)
    )
  }

  db.createReplicationStream = function (opts, cb) {
    if(!cb) cb = opts, opts = {}
    return replicate(db, opts, cb || function (err) {
      if(err) throw err
    })
  }

  db.createFeed = function (keys) {
    if(!keys)
      keys = opts.keys.generate()
    return Feed(db, keys, opts)
  }

  db.createLatestLookupStream = function () {
    return paramap(function (id, cb) {
      return lastDB.get(id, function (err, seq) {
        cb(null, {id: id, sequence: err ? 0 : seq})
      })
    })
  }

  db.getLatest = function (id, cb) {
    lastDB.get(id, function (err, v) {
      if(err) return cb(err)
      clockDB.get([id, v], function (err, hash) {
        if(err) return cb(err)
        db.get(hash, cb)
      })
    })
  }

  db.createLogStream = function (opts) {
    opts = opts || {}
    var _opts = {
      gt : opts.gt || 0, tail: opts.tail || false
    }
    return pull(
      pl.read(logDB, _opts),
      paramap(function (data, cb) {
        var key = data.value
        var seq = data.key
        db.get(key, function (err, value) {
          cb(err, {key: key, value: value, timestamp: seq})
        })
      })
    )
  }

  var HI = undefined, LO = null

  db.messagesLinkedTo = function (hash, rel) {
    return pull(
      pl.read(indexDB, {
        gte: ['_msg', hash, rel || LO, LO],
        lte: ['_msg', hash, rel || LO, HI],
      }),
      paramap(function (op, cb) {
        if(!op.key[3]) return cb()
        db.get(op.key[3], function (err, msg) {
          cb(null, msg)
        })
      }),
      pull.filter(Boolean)
    )
  }

  db.feedsLinkedTo = function (id, rel) {
    return pull(
      pl.read(indexDB, {
        gte: ['_feed', id, rel || LO, LO],
        lte: ['_feed', id, rel || HI, HI]
      }),
      pull.map(function (op) {
        return {
          source: op.key[3], dest: op.key[1],
          rel: op.key[2], message: op.key[5]
        }
      })
    )
  }

  db.feedsLinkedFrom = function (id, rel) {
    return pull(
      pl.read(indexDB, {
        gte: ['feed', id, rel || LO, LO],
        lte: ['feed', id, rel || HI, HI]
      }),
      pull.map(function (op) {
        return {
          source: op.key[1], dest: op.key[3],
          rel: op.key[2], message: op.key[5]
        }
      })
    )
  }

  return db
}
