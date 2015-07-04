'use strict';

var contpara  = require('cont').para
var pull      = require('pull-stream')
var pl        = require('pull-level')
var paramap   = require('pull-paramap')
var timestamp = require('monotonic-timestamp')
var assert    = require('assert')
var ltgt      = require('ltgt')
var mlib      = require('ssb-msgs')
var explain   = require('explain-error')
var mynosql   = require('mynosql')
var pdotjson  = require('./package.json')
var createFeed = require('ssb-feed')
var cat       = require('pull-cat')
var mynosql   = require('mynosql')
var isRef     = require('ssb-ref')
var ssbKeys   = require('ssb-keys')

var isFeedId = isRef.isFeedId
var isHash = isRef.isHash
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

function all (stream) {
  return function (cb) {
    pull(stream, pull.collect(cb))
  }
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function getVMajor () {
  var version = require('./package.json').version
  return (version.split('.')[0])|0
}

module.exports = function (db, opts, keys) {

  db = mynosql(db)
  var sysDB   = db.sublevel('sys')
  var logDB   = db.sublevel('log')
  var feedDB  = db.sublevel('fd')
  var clockDB = db.sublevel('clk')
  var lastDB  = db.sublevel('lst')
  var indexDB = db.sublevel('idx')
  var appsDB  = db.sublevel('app')

  function get (db, key) {
    return function (cb) { db.get(key, cb) }
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

// local time is now handled by 
//    add({
//      key: localtime, value: id,
//      type: 'put', prefix: logDB
//    })

    indexMsg(add, localtime, id, msg)

  })

  function indexMsg (add, localtime, id, msg) {
    var content = (keys && isString(msg.content))
      ? ssbKeys.unbox(msg.content, keys)
      : msg.content

    if(!content) return

    if(isString(content.type))
      add({
        key: ['type', content.type.toString().substring(0, 32), localtime],
        value: id, type: 'put', prefix: indexDB
      })

    mlib.indexLinks(content, function (link, rel) {
      if(isFeedId(link.feed)) {
        add({
          key: ['feed', msg.author, rel, link.feed, msg.sequence, id],
          value: link,
          type: 'put', prefix: indexDB
        })
        add({
          key: ['_feed', link.feed, rel, msg.author, msg.sequence, id],
          value: link,
          type: 'put', prefix: indexDB
        })
      }

      if(isHash(link.msg)) {
        // do not need forward index here, because
        // it's cheap to just read the message.
        add({
          key: ['_msg', link.msg, rel, id], value: link,
          type: 'put', prefix: indexDB
        })
      }

      //TODO, add ext links

      if(isHash(link.ext)) {
        // do not need forward index here, because
        // it's cheap to just read the message.
        add({ //feed to file.
          key: ['ext', id, rel, link.ext], value: link,
          type: 'put', prefix: indexDB
        })
        add({ //file from feed.
          key: ['_ext', link.ext, rel, id], value: link,
          type: 'put', prefix: indexDB
        })

      }

    })
  }

  db.createFeed = function (keys) {
    return createFeed(db, keys, opts)
  }

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
      cb && cb(err, { key: hash, value: msg })
    })
  }

  db.needsRebuild = function (cb) {
    sysDB.get('vmajor', function (err, dbvmajor) {
      dbvmajor = (dbvmajor|0) || 0
      cb(null, dbvmajor < getVMajor())
    })
  }

  db.rebuildIndex = function (cb) {
    // remove all entries from the index
    pull(
      pl.read(indexDB, { keys: true, values: false }),
      paramap(function (key, cb) { indexDB.del(key, cb) }),
      pull.drain(null, next)
    )

    function next (err) {
      if (err)
        return cb(err)

      // replay the log
      pull(
        db.createLogStream({ keys: true, values: true }),
        pull.map(function (msg) {
          var ops = []
          function add (item) { ops.push(item) }
          indexMsg(add, msg.timestamp, msg.key, msg.value)
          return ops
        }),
        pull.flatten(),
        pl.write(indexDB, next2)
      )
      function next2 (err) {
        if (err)
          return cb(err)

        sysDB.put('vmajor', getVMajor(), cb)
      }
    }
  }

  // opts standardized to work like levelup api
  function stdopts (opts) {
    opts = opts || {}
    if (opts.keys !== false)
      opts.keys = true
    if (opts.values !== false)
      opts.values = true
    return opts
  }
  function msgFmt (keys, values, obj) {
    if (keys && values)
      return obj
    if (keys)
      return obj.key
    if (values)
      return obj.value
    return null // i guess?
  }

  //TODO: eventually, this should filter out authors you do not follow.
  db.createFeedStream = function (opts) {
    opts = stdopts(opts)
    var _keys = opts.keys
    var _values = opts.values
    opts.keys = false
    opts.values = true

    return pull(
      pl.read(feedDB, opts),
      paramap(function (key, cb) {
        if(key.sync) return cb(key)
        db.get(key, function (err, msg) {
          if (err) cb(err)
          else cb(null, msgFmt(_keys, _values, { key: key, value: msg }))
        })
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
    var _keys = true, _values = true
    if(!isFeedId(id)) {
      var opts = stdopts(id)
      id       = opts.id
      seq      = opts.sequence || opts.seq || 0
      live     = !!opts.live
      _keys    = opts.keys
      _values  = opts.values
    }

    return pull(
      pl.read(clockDB, {
        gte:  [id, seq],
        lte:  [id, MAX_INT],
        live: live,
        keys: false,
        sync: opts && opts.sync,
        onAbort: opts && opts.onAbort
      }),
      paramap(function (key, cb) {
        if(key.sync) return cb(null, key)
        db.get(key, function (err, msg) {
          if (err) cb(err)
          else cb(null, msgFmt(_keys, _values, { key: key, value: msg }))
        })
      })
    )
  }


  db.createUserStream = function (opts) {
    opts = stdopts(opts)
    ltgt.toLtgt(opts, opts, function (value) {
      return [opts.id, value]
    }, LO, HI)
    var _keys = opts.keys
    var _values = opts.values

    opts.keys = false
    opts.values = true
    return pull(
      pl.read(clockDB, opts),
      paramap(function (key, cb) {
        if(key.sync) return cb(key)
        db.get(key, function (err, msg) {
          if (err) cb(err)
          else cb(null, msgFmt(_keys, _values, { key: key, value: msg }))
        })
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
    return createFeed(db, keys, opts)
  }

  db.createLatestLookupStream = function () {
    return paramap(function (id, cb) {
      if(id.sync) return cb(null, id)
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
    opts = stdopts(opts)
    var live = opts.live || opts.tail
    var _opts = {
      gt : opts.gt || 0
    }
    var old = pull(
      pl.read(logDB, _opts),
      paramap(function (data, cb) {
        if(data.sync) return cb(null, data)
        var key = data.value
        var seq = data.key
        db.get(key, function (err, value) {
          if (err) cb(err)
          else cb(null, msgFmt(opts.keys, opts.values, {key: key, value: value, timestamp: seq}))
        })
      })
    )
    if(!live) return old

    return cat([old, pull.values([{sync: true}]), pl.live(db)])

  }

  var HI = undefined, LO = null

  db.messagesByType = function (opts) {
    if(!opts)
      throw new Error('must provide {type: string} to messagesByType')

    if(isString(opts))
      opts = {type: opts}

    opts = stdopts(opts)
    var _keys   = opts.keys
    var _values = opts.values
    opts.values = true

    ltgt.toLtgt(opts, opts, function (value) {
      return ['type', opts.type, value]
    }, LO, HI)

    return pull(
      pl.read(indexDB, opts),
      paramap(function (data, cb) {
        var id = _keys ? data.value : data
        db.get(id, function (err, msg) {
          var ts = opts.keys ? data.key[2] : undefined
          cb(null, msgFmt(_keys, _values, {key: id, ts: ts, value: msg}))
        })
      }),
      pull.filter()
    )
  }

  function idOpts (fn) {
    return function (hash, rel) {
      //legacy interface.
      if(isRef(hash))
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
        lte: ['_msg', hash, rel || HI, HI],
        live: opts.live,
        reverse: opts.reverse,
        limit: opts.limit
      }),
      paramap(function (op, cb) {
        if(!op.key[3]) return cb()
        db.get(op.key[3], function (err, msg) {
          if (opts.keys && msg)
            cb(null, { key: op.key[3], value: msg })
          else
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
          limit: opts.limit,
          sync: opts.sync,
          onAbort: opts.onAbort
        }),
        pull.map(function (op) {
          if(op.sync) return op
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

  //get all messages that link to a given message.
  db.relatedMessages = function (opts, cb) {
    if(isString(opts)) opts = {key: opts}
    if(!opts) throw new Error('opts *must* be object')
    var key = opts.id || opts.key

    var n = 1
    var msgs = {key: key, value: null}
    db.get(key, function (err, msg) {
      msgs.value = msg
      done(err)
    })

    related(msgs)

    function related (msg) {
      n++
      all(db.messagesLinkedToMessage({
        id: msg.key, rel: opts.rel, keys: true
      })) (function (err, ary) {
        if(ary && ary.length) {
          ary.sort(function (a, b) {
            return compare(a.value.timestamp, b.value.timestamp) || compare(a.key, b.key)
          })
          msg.related = ary
          ary.forEach(related)
        }
        done(err)
      })
    }

    function count (msg) {
      if(!msg.related)
        return msg
      var c = 0
      msg.related.forEach(function (_msg) {
        if(opts.parent) _msg.parent = msg.key
        c += 1 + (count(_msg).count || 0)
      })
      if(opts.count) msg.count = c
      return msg
    }

    function done (err) {
      if(err && n > 0) {
        n = -1
        return cb(err)
      }
      if(--n) return
      cb(null, count(msgs))
    }
  }

  return db
}
