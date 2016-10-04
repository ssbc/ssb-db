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
var pdotjson  = require('./package.json')
var createFeed = require('ssb-feed')
var cat       = require('pull-cat')
var ref       = require('ssb-ref')
var ssbKeys   = require('ssb-keys')
var Live      = require('pull-live')
var Notify    = require('pull-notify')
var compare   = require('typewiselite')
var peek      = require('level-peek')
var Validator = require('ssb-feed/validator')

var isFeedId = ref.isFeedId
var isMsgId  = ref.isMsgId
var isBlobId = ref.isBlobId

var u         = require('./util')
var stdopts   = u.options
var msgFmt    = u.format

//53 bit integer
var MAX_INT  = 0x1fffffffffffff

function isNumber (n) {
  return typeof n === 'number'
}

function isString (s) {
  return 'string' === typeof s
}

var isArray = Array.isArray

function isObject (o) {
  return o && 'object' === typeof o && !Array.isArray(o)
}

function all (stream) {
  return function (cb) {
    pull(stream, pull.collect(cb))
  }
}

function getVMajor () {
  var version = require('./package.json').version
  return (version.split('.')[0])|0
}

module.exports = function (db, opts, keys, path) {
  var sysDB   = db.sublevel('sys')
  var logDB   = db.sublevel('log')
  var feedDB  = require('./indexes/feed')(db)
  var clockDB = require('./indexes/clock')(db)
  var lastDB  = require('./indexes/last')(db)
  var indexDB = require('./indexes/links')(db, keys)
  var appsDB  = db.sublevel('app')

  function get (db, key) {
    return function (cb) { db.get(key, cb) }
  }

  db.opts = opts

  db.add = Validator(db, opts)

  var realtime = Notify()

  var await = u.await()
  var set = await.set
  await.set = null
  var waiting = []
  db.seen = await
  db.post(function (op) {
    set(Math.max(op.ts || op.timestamp, await.get()||0))
  })

  peek.last(logDB, {keys: true}, function (err, key) {
    set(Math.max(key || 0, await.get()||0))
  })

  db.pre(function (op, _add, _batch) {
    var msg = op.value
    var id = op.key
    // index by sequence number

    function add (kv) {
      _add(kv);
      kv._value = op.value
      realtime(kv)
    }

    var localtime = op.timestamp = timestamp()

    add({
      key: localtime, value: id,
      type: 'put', prefix: logDB
    })

  })


  db.needsRebuild = function (cb) {
    sysDB.get('vmajor', function (err, dbvmajor) {
      dbvmajor = (dbvmajor|0) || 0
      cb(null, dbvmajor < getVMajor())
    })
  }

  db.rebuildIndex = function (cb) {
    var n = 4, m = 4, ended
    feedDB.rebuild(next)
    clockDB.rebuild(next)
    lastDB.rebuild(next)
    indexDB.rebuild(next)

    function next (err) {
      if(err && !ended) cb(ended = err)
    }

    var m = 4
    feedDB.await(next2)
    clockDB.await(next2)
    lastDB.await(next2)
    indexDB.await(next2)

    function next2 () {
      if(ended) return
      if(--m) return
      ended = true
      sysDB.put('vmajor', getVMajor(), cb)
    }
  }

  function Limit (fn) {
    return function (opts) {
      if(opts && opts.limit && opts.limit > 0) {
        var limit = opts.limit
        var read = fn(opts)
        return function (abort, cb) {
          if(limit--) return read(abort, function (err, data) {
            if(data && data.sync) limit ++
            cb(err, data)
          })
          else read(true, cb)
        }
      }
      else
        return fn(opts)
    }
  }

  //TODO: eventually, this should filter out authors you do not follow.
  db.createFeedStream = Limit(feedDB.createFeedStream)
  //latest was stored as author: seq
  //but for the purposes of replication back pressure
  //we need to know when we last replicated with someone.
  //instead store as: {sequence: seq, ts: localtime}
  //then, peers can request a max number of posts per feed.

  function toSeq (latest) {
    return isNumber(latest) ? latest : latest.sequence
  }

  function lookup(keys, values) {
    return paramap(function (key, cb) {
      if(key.sync) return cb(null, key)
      if(!values) return cb(null, key)
      db.get(key, function (err, msg) {
        if (err) cb(err)
        else {
          cb(null, u.format(keys, values, { key: key, value: msg }))
        }
      })
    })
  }

  db.lookup = lookup

  db.createHistoryStream = Limit(clockDB.createHistoryStream)

  db.createUserStream = Limit(clockDB.createUserStream)


  //writeStream - used in replication.
  db.createWriteStream = function (cb) {
    return pull(
      paramap(function (data, cb) {
        db.add(data, function (err, msg) {
          if(err)
            db.emit('invalid', err, msg)
          cb()
        })
      }),
      pull.drain(null, cb)
    )
  }

  db.createFeed = function (keys) {
    if(!keys) keys = ssbKeys.generate()
    return createFeed(db, keys, opts)
  }

  db.latest = Limit(lastDB.latest)

  db.latestSequence = function (id, cb) {
    lastDB.get(id, cb)
  }

  db.getLatest = function (id, cb) {
    lastDB.get(id, function (err, v) {
      if(err) return cb()
      //callback null there is no latest
      clockDB.get([id, toSeq(v)], function (err, hash) {
        if(err) return cb()
        db.get(hash, function (err, msg) {
          if(err) cb()
          else cb(null, {key: hash, value: msg})
        })
      })
    })
  }

  db.createLogStream = Limit(Live(function (opts) {
    opts = stdopts(opts)
    var keys = opts.keys; delete opts.keys
    var values = opts.values; delete opts.values
    return pull(
      pl.old(logDB, stdopts(opts)),
      //lookup2(keys, values, 'timestamp')
      paramap(function (data, cb) {
        var key = data.value
        var seq = data.key
        db.get(key, function (err, value) {
          if (err) cb(err)
          else cb(null, msgFmt(keys, values, {key: key, value: value, timestamp: seq}))
        })
      })
    )
  }, function (opts) {
    return pl.live(db, stdopts(opts))
  }))

  var HI = undefined, LO = null

  db.messagesByType = Limit(indexDB.messagesByType)

  db.links = Limit(indexDB.links)

  //get all messages that link to a given message.
  db.relatedMessages = function (opts, cb) {
    if(isString(opts)) opts = {key: opts}
    if(!opts) throw new Error('opts *must* be object')
    var key = opts.id || opts.key
    var depth = opts.depth || Infinity
    var seen = {}

    //filter a list of rel, used to avoid 'branch' rel in patchwork,
    //which causes messages to be queried twice.
    var n = 1
    var msgs = {key: key, value: null}
    db.get(key, function (err, msg) {
      msgs.value = msg
      if (err && err.notFound)
        err = null // ignore not found
      done(err)
    })

    related(msgs, depth)

    function related (msg, depth) {
      if(depth <= 0) return
      if (n<0) return
      n++
      all(db.links({dest: msg.key, rel: opts.rel, keys: true, values:true, meta: false, type:'msg'}))
      (function (err, ary) {
        if(ary && ary.length) {
          msg.related = ary = ary.sort(function (a, b) {
            return compare(a.value.timestamp, b.value.timestamp) || compare(a.key, b.key)
          }).filter(function (msg) {
            if(seen[msg.key]) return
            return seen[msg.key] = true
          })
          ary.forEach(function (msg) { related (msg, depth - 1) })
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

  var _close = db.close

  db.close = function (cb) {
    var n = 5
    clockDB.close(next)
    feedDB.close(next)
    lastDB.close(next)
    indexDB.close(next)
    _close.call(db, next)
    function next (err) {
      if(n < 0) return
      if(err) return n = -1, cb(err)
      if(--n) return
      db && cb()
    }
  }

  return db
}











