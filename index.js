'use strict';

var contpara  = require('cont').para
var pull      = require('pull-stream')
var pl        = require('pull-level')
var paramap   = require('pull-paramap')
var timestamp = require('monotonic-timestamp')
var Feed      = require('./feed')
var assert    = require('assert')
var ltgt      = require('ltgt')
var mlib      = require('ssb-msgs')
var explain   = require('explain-error')
//this makes msgpack a valid level codec.

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

module.exports = function (db, opts) {

  var isHash = opts.isHash

  var logDB   = db.sublevel('log')
  var feedDB  = db.sublevel('fd')
  var clockDB = db.sublevel('clk')
  var lastDB  = db.sublevel('lst')
  var indexDB = db.sublevel('idx')
  var appsDB  = db.sublevel('app')

  function get (db, key) {
    return function (cb) { db.get(encode(key), cb) }
  }

  db.opts = opts

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

    var localtime = timestamp()

    // index messages in the order _received_
    // this will be used to pass to plugins which
    // must create their indexes asyncly.
    add({
      key: localtime, value: id,
      type: 'put', prefix: logDB
    })

    add({
      key: ['type', msg.content.type.toString().substring(0, 32), localtime],
      value: id, type: 'put', prefix: indexDB
    })

    mlib.indexLinks(msg.content, function (link) {
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
        if(err) return cb(explain(err, 'do not have first message in feed:' + id))

        db.get(hash, function (err, msg) {
          if(err) return cb(err)
          cb(null, msg.content.public)
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

  //TODO: eventually, this should filter out authors you do not follow.
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
      pl.read(lastDB, opts),
      pull.map(function (data) {
        var d = {id: data.key, sequence: data.value}
        return d
      })
    )
  }

  db.createHistoryStream = function (id, seq, live) {
    if(!isHash(id)) {
      live = !!id.live
      seq = id.sequence || id.seq || 0
      id = id.id
    }
    return pull(
      pl.read(clockDB, {
        gte:  [id, seq],
        lte:  [id, MAX_INT],
        live: live,
        keys: false
      }),
      paramap(function (key, cb) {
        db.get(key, cb)
      })
    )
  }

  //writeStream - used in replication.
  db.createWriteStream = function (cb) {
    return pull(
      paramap(function (data, cb) {
        db.add(data, cb)
      }),
      pull.drain(null, cb)
    )
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
    var live = opts.live || opts.tail
    var _opts = {
      gt : opts.gt || 0, live: live || false
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

  db.messagesByType = function (opts) {
    if(!opts)
      throw new Error('must provide {type: string} to messagesByType')
    if(isString(opts))
      opts = {type: opts}

    ltgt.toLtgt(opts, opts, function (value) {
      return ['type', opts.type, value]
    }, LO, HI)
    //default keys to false
    var keys = opts.keys = opts.keys === true
    return pull(
      pl.read(indexDB, opts),
      paramap(function (data, cb) {
        var id = keys ? data.value : data
        db.get(id, function (err, msg) {
          cb(null, keys ? {key: id, ts: data.key[2], value: msg} : msg)
        })
      }),
      pull.filter()
    )
  }

  function idOpts (fn) {
    return function (opts, rel) {
      if(!opts) throw new Error('must have opts')
      //legacy interface.
      if(isHash(opts))
        return fn(opts, rel)

      return fn(opts.id, opts.rel)
    }
  }

  db.messagesLinkedToMessage = idOpts(function (hash, rel) {
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
  })

  db.messagesLinkedToFeed =
  db.feedsLinkedToFeed = idOpts(function (id, rel) {

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
  })

  db.messagesLinkedFromFeed =
  db.feedsLinkedFromFeed = idOpts(function (id, rel) {
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
  })

  return db
}
