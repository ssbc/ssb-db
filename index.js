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

var EventEmitter = require('events')

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

module.exports = function (_, opts, keys, path) {
  path = path || _.location

  var db = require('./db')(path)

  //fairly sure that something up the stack expects ssb to be an event emitter.
  db.__proto__ = new EventEmitter()

  function get (db, key) {
    return function (cb) { db.get(key, cb) }
  }

  db.opts = opts

  //just the api which is passed into ssb-feed
  var _ssb = {
    getLatest: function (key, cb) {
      db.getLatest(key, cb)
    },
    batch: function (batch, cb) {
      db.append(batch.map(function (e) {
        return {
          key: e.key,
          value: e.value,
          timestamp: timestamp()
        }
      }), function (err, offsets) {
        cb(err)
      })
    }
  }

  var _get = db.get

  db.get = function (key, cb) {
    if(ref.isMsg(key)) return db.keys.get(key, function (err, seq) {
      if(err) cb(err)
      else _get(seq, function (err, data) {
        cb(err, data && data.value)
      })
    })
    else _get(key, cb) //seq
  }

  _ssb.add = db.add = Validator(_ssb, opts)

  var realtime = Notify()

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
  db.createFeedStream = db.feed.createFeedStream

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
      db.get(key, function (err, data) {
        if (err) cb(err)
        else cb(null, u.format(keys, values, data))
      })
    })
  }

  db.lookup = lookup

  db.createHistoryStream = db.clock.createHistoryStream

  db.createUserStream = db.clock.createUserStream

  //writeStream - used in replication.
  db.createWriteStream = function (cb) {
    return pull(
      paramap(function (data, cb) {
        db.add(data, function (err, msg) {
          if(err) db.emit('invalid', err, msg)
          cb()
        })
      }),
      pull.drain(null, cb)
    )
  }

  db.createFeed = function (keys) {
    if(!keys) keys = ssbKeys.generate()
    return createFeed(_ssb, keys, opts)
  }

  db.latest = db.last.latest
//
//  db.latestSequence = function (id, cb) {
//    lastDB.get(id, cb)
//  }


  db.getLatest = function (key, cb) {
    db.last.get(key, function (err, seq) {
      if(err) return cb()
      db.get(seq, cb)
    })
  }


  db.createLogStream = function (opts) {
    opts = stdopts(opts)
    var keys = opts.keys; delete opts.keys
    var values = opts.values; delete opts.values
    return db.time.read(opts)
    //return db.stream({values: true, seqs: false, live: opts.live})
  }

  db.messagesByType = db.links.messagesByType

  db.links = db.links.links

  var HI = undefined, LO = null

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


  return db
}



