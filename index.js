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
  var indexDB = db.sublevel('idx')
  var appsDB  = db.sublevel('app')

  function get (db, key) {
    return function (cb) { db.get(key, cb) }
  }

  db.opts = opts

  db.add = Validator(db)

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

    indexMsg(add, localtime, id, msg)

  })

  function indexMsg (add, localtime, id, msg) {
    //DECRYPT the message, if possible
    //to enable indexing. If external apis
    //are not provided that may access indexes
    //then this will not leak information.
    //otherwise, we may need to figure something out.

    var content = (keys && isString(msg.content))
      ? ssbKeys.unbox(msg.content, keys)
      : msg.content

    if(!content) return

    if(isString(content.type))
      add({
        key: ['type', content.type.toString().substring(0, 32), localtime],
        value: id, type: 'put', prefix: indexDB
      })

    mlib.indexLinks(content, function (obj, rel) {
      add({
        key: ['link', msg.author, rel, obj.link, msg.sequence, id],
        value: obj,
        type: 'put', prefix: indexDB
      })
      add({
        key: ['_link', obj.link, rel, msg.author, msg.sequence, id],
        value: obj,
        type: 'put', prefix: indexDB
      })
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
      pl.read(indexDB, { keys: true, values: false, old: true }),
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

  //TODO: eventually, this should filter out authors you do not follow.
  db.createFeedStream = feedDB.createFeedStream
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

  db.createHistoryStream = clockDB.createHistoryStream

  db.createUserStream = clockDB.createUserStream


  //writeStream - used in replication.
  db.createWriteStream = function (cb) {
    return pull(
      paramap(function (data, cb) {
        db.add(data, function (err, msg) {
          db.emit('invalid', err, msg)
          cb()
        })
      }),
      pull.drain(null, cb)
    )
  }

  db.createFeed = function (keys) {
    if(!keys)
      keys = opts.keys.generate()
    return createFeed(db, keys, opts)
  }

  db.latest = lastDB.latest

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

  db.createLogStream = Live(function (opts) {
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
  })

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
        if(data.sync) return cb()
        var id = _keys ? data.value : data
        db.get(id, function (err, msg) {
          var ts = opts.keys ? data.key[2] : undefined
          cb(null, msgFmt(_keys, _values, {key: id, ts: ts, value: msg}))
        })
      }),
      pull.filter()
    )
  }

  function format(opts, op, key, value) {
    var meta = opts.meta !== false  //default: true
    var keys = opts.keys !== false  //default: true
    var vals = opts.values === true //default: false
    if(!meta&&!keys&&!vals)
      throw new Error('a stream without any values does not make sense')
    if(!meta) return (
          keys && vals  ? {key: op.key, value: value}
        : keys          ? op.key
                        : value
      )
    else {
      if(vals)  op.value = value
      if(!keys) delete op.key
      delete op._value
      return op
    }
  }

  function type(t) { return {feed: '@', msg: '%', blob: '&'}[t] || t }

  function linksOpts (opts) {
    if(!opts) throw new Error('opts *must* be provided')

    if(  !(opts.values === true)
      && !(opts.meta !== false)
      && !(opts.keys !== false)
    )
      throw new Error('makes no sense to return stream without results'
        + 'set at least one of {keys, values, meta} to true')

    var src = type(opts.source), dst = type(opts.dest), rel = opts.rel

    var back = dst && !src
    var from = back ? dst : src, to = back ? src : dst

    function range(value, end, def) {
      return !value ? def : /^[@%&]$/.test(value) ? value + end : value
    }
    function lo(value) { return range(value, "!", LO) }
    function hi(value) { return range(value, "~", HI) }

    var index = back ? '_link' : 'link'
    var gte = [index, lo(from), rel || LO, lo(to), LO, LO]
    var lte = [index, hi(from), rel || HI, hi(to), HI, HI]
    return {
      gte: gte, lte: lte, reverse: opts.reverse,
      back: back, rel: rel, source: src, dest: dst,
      props: {
        keys: opts.keys !== false, //default: true
        meta: opts.meta !== false, //default: true
        values: opts.values === true, //default: false
      }
    }
  }

  function testLink (a, e) { //actual, expected
    return e ? e.length === 1 ? a[0]==e[0] : a===e : true
  }

  function lookupLinks (opts) {
    return pull(
      pull.map(function (op) {
        return {
          _value: op._value,
          source: op.key[opts.back?3:1],
          rel: op.key[2],
          dest: op.key[opts.back?1:3],
          key: op.key[5]
        }
      }),
      // in case source and dest are known but not rel,
      // this will scan all links from the source
      // and filter out those to the dest. not efficient
      // but probably a rare query.
      pull.filter(function (data) {
        if(opts.rel && opts.rel !== data.rel) return false
        if(!testLink(data.dest, opts.dest)) return false
        if(!testLink(data.source, opts.source)) return false
        return true
      }),
      ! opts.props.values
      ? pull.map(function (op) {
          return format(opts.props, op, op.key, null)
        })
      : paramap(function (op, cb) {
          if(op._value)
            return cb(null, format(opts.props, op, op.key, op._value))
          db.get(op.key, function (err, msg) {
            if(err) return cb(err)
            cb(null, format(opts.props, op, op.key, msg))
          })
      })
    )
  }


  db.links = Live(function (opts) {
    opts = linksOpts(opts)
    return pull(
      pl.old(indexDB, opts),
      lookupLinks(opts)
    )
  }, function (opts) {
    opts = linksOpts(opts)
    return pull(
      realtime.listen(),
      pull.filter(function (msg) {
        return ltgt.contains(opts, msg.key, compare)
      }),
      lookupLinks(opts)
    )
  })

  //get all messages that link to a given message.
  db.relatedMessages = function (opts, cb) {
    if(isString(opts)) opts = {key: opts}
    if(!opts) throw new Error('opts *must* be object')
    var key = opts.id || opts.key
    var depth = opts.depth || Infinity
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
          ary.sort(function (a, b) {
            return compare(a.value.timestamp, b.value.timestamp) || compare(a.key, b.key)
          })
          msg.related = ary
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
    var n = 4
    clockDB.close(next)
    feedDB.close(next)
    lastDB.close(next)
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

