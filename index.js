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
var ssbref    = require('ssb-ref')
var ssbKeys   = require('ssb-keys')

var Validator = require('ssb-feed/validator')

var isFeedId = ssbref.isFeedId
var isMsgId  = ssbref.isMsgId
var isBlobId = ssbref.isBlobId

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

  db.add = Validator(db)

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
      lookup(_keys, _values)
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

  function lookup(keys, values) {
    return paramap(function (key, cb) {
      if(key.sync) return cb(null, key)
      if(!values) return cb(null, key)
      db.get(key, function (err, msg) {
        if (err) cb(err)
        else cb(null, msgFmt(keys, values, { key: key, value: msg }))
      })
    })
  }

  db.createHistoryStream = function (id, seq, live) {
    var _keys = true, _values = true
    if(!isFeedId(id)) {
      var opts = stdopts(id)
      id       = opts.id
      seq      = opts.sequence || opts.seq || 0
      live     = !!opts.live
      _keys    = opts.keys !== false
      _values  = opts.values !== false
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
      lookup(_keys, _values)
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
      lookup(_keys, _values)
    )
  }


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
        db.get(hash, function (err, msg) {
          cb(err, {key: hash, value: msg})
        })
      })
    })
  }

  db.createLogStream = function (opts) {
    opts = stdopts(opts)
    var live = opts.live || opts.tail; delete opts.live
    var keys = opts.keys; delete opts.keys
    var values = opts.values; delete opts.values

    var old = pull(
      pl.read(logDB, opts),
      paramap(function (data, cb) {
        if(data.sync) return cb(null, data)
        var key = data.value
        var seq = data.key
        db.get(key, function (err, value) {
          if (err) cb(err)
          else cb(null, msgFmt(keys, values, {key: key, value: value, timestamp: seq}))
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
      return op
    }
  }

  db.links = function (opts) {
    if(!opts) throw new Error('opts *must* be provided')
    opts.meta = opts.meta !== false //default: true
    opts.keys = opts.keys !== false //default: true
    if(!opts.values&&!opts.meta&&!opts.keys)
      throw new Error('makes no sense to return stream without resultts'
        + 'set at least one of {keys, values, meta} to true')

    function tofilter (v) {
      if (v == '%' || v == 'msg') return 'msg'
      if (v == '@' || v == 'feed') return 'feed'
      if (v == '&' || v == 'blob') return 'blob'
      return null
    }
    function tolink (v) {
      return (ssbref.isLink(v)) ? v : null
    }

    var type, rel, back
    var src = tolink(opts.source)
    var dst = tolink(opts.dest)
    var srcfilter = tofilter(opts.source)
    var dstfilter = tofilter(opts.dest)
    var rel = opts.rel

    if(dst && !src) back = true

    var index = back ? '_link' : 'link'
    var gte = [index, LO, rel || LO, LO, LO, LO]
    var lte = [index, HI, rel || HI, HI, HI, HI]
    if (back) {
      gte[1] = dst || LO
      lte[1] = dst || HI
      if (srcfilter) {
        if (srcfilter == 'feed') {
          gte[3] = '@!'
          lte[3] = '@~'
        } else {
          gte[5] = '%!'
          lte[5] = '%~'          
        }
      }
    } else {
      if (ssbref.type(src) == 'feed') {
        gte[1] = src || LO
        lte[1] = src || HI
      } else {
        gte[5] = src || LO
        lte[5] = src || HI
      }
      if (dstfilter) {
        if (dstfilter == 'msg') {
          gte[3] = '%!'
          lte[3] = '%~'        
        } else if (dstfilter == 'feed') {
          gte[3] = '@!'
          lte[3] = '@~'
        } else {
          gte[3] = '&!'
          lte[3] = '&~'          
        }
      } else {
        gte[3] = dst || LO
        lte[3] = dst || HI
      }
    }

    return pull(
      pl.read(indexDB, { gte: gte, lte: lte, live: opts.live, reverse: opts.reverse }),
      pull.map(function (op) {
        var srci, dsti
        if (back) {
          srci = (srcfilter == 'feed') ? 3 : 5
          dsti = 1
        } else {
          srci = (ssbref.type(src) == 'feed') ? 1 : 5
          dsti = 3
        }
        return {
          source: op.key[srci],
          rel: op.key[2],
          dest: op.key[dsti],
          key: op.key[5]
        }
      }),
      // apply any filters
      (srcfilter || dstfilter) ?
        pull.filter(function (d) {
          if (srcfilter && ssbref.type(d.source) != srcfilter)
            return false
          if (dstfilter && ssbref.type(d.dest) != dstfilter)
            return false
          return true
        }) : null,
      //handle case where source and dest are known but not rel.
      //this will scan all links from the source. not so efficient.
      src&&dst&&!rel ? pull.filter(function (d) {
        return d.source === src && d.dest === dst
      }): null,
      ! opts.values
      ? pull.map(function (op) {
          return format(opts, op, op.key, null)
        })
      : paramap(function (op, cb) {
          db.get(op.key, function (err, msg) {
            if(err) return cb(err)
            cb(null, format(opts, op, op.key, msg))
          })
      })
    )
  }

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
      all(db.links({dest: msg.key, rel: opts.rel, keys: true, values:true, meta: false, type:'msg'}))
      (function (err, ary) {
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
