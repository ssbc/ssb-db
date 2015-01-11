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

function isObject (o) {
  return o && 'object' === typeof o && !Array.isArray(o)
}

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
      if(isHash(link.feed)) {
        add({
          key: ['feed', msg.author, link.rel, link.feed, msg.sequence, id],
          value: link,
          type: 'put', prefix: indexDB
        })
        add({
          key: ['_feed', link.feed, link.rel, msg.author, msg.sequence, id],
          value: link,
          type: 'put', prefix: indexDB
        })
      }

      if(isHash(link.msg)) {
        // do not need forward index here, because
        // it's cheap to just read the message.
        add({
          key: ['_msg', link.msg, link.rel, id], value: link,
          type: 'put', prefix: indexDB
        })
      }

      //TODO, add ext links

      if(isHash(link.ext)) {
        // do not need forward index here, because
        // it's cheap to just read the message.
        add({ //feed to file.
          key: ['ext', id, link.rel, link.ext], value: link,
          type: 'put', prefix: indexDB
        })
        add({ //file from feed.
          key: ['_ext', link.ext, link.rel, id], value: link,
          type: 'put', prefix: indexDB
        })

      }

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
    var _keys = opts.keys
    opts.keys = false
    return pull(
      pl.read(feedDB, opts),
      paramap(function (key, cb) {
        if (_keys)
          db.get(key, function (err, msg) {
            if (err) cb(err)
            else cb(null, { key: key, value: msg })
          })
        else
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
    var keys = false
    if(!isHash(id)) {
      live = !!id.live
      seq = id.sequence || id.seq || 0
      keys = id.keys || false
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
        if (keys)
          db.get(key, function (err, msg) {
            if (err) cb(err)
            else cb(null, { key: key, value: msg })
          })
        else
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
        if (opts.keys)
          db.get(key, function (err, value) {
            cb(err, {key: key, value: value, timestamp: seq})
          })
        else
          db.get(key, cb)
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
    return function (hash, rel) {
      //legacy interface.
      if(isHash(hash))
        return fn({id: hash, rel: rel})

      if(!isObject(hash)) throw new Error('must have opts')

      return fn(hash)
    }
  }

  db.messagesLinkedToMessage = idOpts(function (opts) {
    var hash = opts.id || opts.hash
    var rel = opts.rel
    return pull(
      pl.read(indexDB, {
        gte: ['_msg', hash, rel || LO, LO],
        lte: ['_msg', hash, rel || LO, HI],
        live: opts.live,
        reverse: opts.reverse,
        limit: opts.limit
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

  function index (type) {
    var back = type[0] === '_'
    return idOpts(function (opts) {
      var id = opts.id || opts.hash
      var rel = opts.rel
      return pull(
        pl.read(indexDB, {
          gte: [type, id || LO, rel || LO, LO],
          lte: [type, id || HI, rel || HI, HI],
          live: opts.live,
          reverse: opts.reverse,
          limit: opts.limit
        }),
        pull.map(function (op) {
          return {
            source: op.key[back ? 3 : 1], dest: op.key[back ? 1 : 3],
            rel: op.key[2], message: op.key[5]
          }
        })
      )
    })
  }

  db.messagesLinkedToFeed =
  db.feedsLinkedToFeed = index('_feed')

  db.messagesLinkedFromFeed =
  db.feedsLinkedFromFeed = index('feed')

  db.feedsLinkedToExternal = index('_ext')

  db.externalsLinkedFromFeed = index('ext')

  return db
}
