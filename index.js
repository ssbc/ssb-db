'use strict';

var join      = require('path').join
var assert    = require('assert')
var EventEmitter = require('events')

var contpara  = require('cont').para
var pull      = require('pull-stream')
var pl        = require('pull-level')
var paramap   = require('pull-paramap')
var timestamp = require('monotonic-timestamp')
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
var peek      = require('level-peek')
var Validator = require('ssb-feed/validator')
var Related   = require('./related')

var isFeedId = ref.isFeedId
var isMsgId  = ref.isMsgId
var isBlobId = ref.isBlobId

var u         = require('./util')
var stdopts   = u.options
var Format    = u.formatStream
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

function getVMajor () {
  var version = require('./package.json').version
  return (version.split('.')[0])|0
}

module.exports = function (_db, opts, keys, path) {
  path = path || _db.location

  keys = keys || ssbKeys.generate()

  var db = require('./db')(join(opts.path || path, 'flume'), keys)

  //legacy database
  if(_db) require('./legacy')(_db, db)

  db.sublevel = function (a, b) {
    return _db.sublevel(a, b)
  }

  //UGLY HACK, but...
  //fairly sure that something up the stack expects ssb to be an event emitter.
  db.__proto__ = new EventEmitter()

  db.opts = opts

  db.batch = function (batch, cb) {
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

  var _get = db.get

  db.get = function (key, cb) {
    if(ref.isMsg(key)) return db.keys.get(key, function (err, seq) {
      if(err) cb(err)
      else _get(seq, function (err, data) {
        if(err) cb(err)
        else    cb(err, data && data.value)
      })
    })
    else _get(key, cb) //seq
  }

  db.add = Validator(db, opts)

  var realtime = Notify()

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
      pull.asyncMap(function (data, cb) {
        db.add(data, function (err, msg) {
          if(err) {
            console.error(err.message, data)
            db.emit('invalid', err, msg)
          }
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

  db.latest = db.last.latest

  //used by sbot replication plugin
  db.latestSequence = function (id, cb) {
    db.last.get(function (err, val) {
      if(err) cb(err)
      else if (!val || !val[id]) cb(new Error('not found:'+id))
      else cb(null, val[id].sequence)
    })
  }


  db.getLatest = function (key, cb) {
    db.last.get(function (err, value) {
      if(err || !value || !value[key]) cb()
      //Currently, this retrives the previous message.
      //but, we could rewrite validation to only use
      //data the reduce view, so that no disk read is necessary.
      else db.get(value[key].id, function (err, msg) {
        cb(err, {key: value[key].id, value: msg})
      })
    })
  }


  db.createLogStream = function (opts) {
    opts = stdopts(opts)
    if(opts.raw)
      return db.stream()

    var keys = opts.keys; delete opts.keys
    var values = opts.values; delete opts.values
    return pull(db.time.read(opts), /*pull.through(console.log), */Format(keys, values))
  }

  db.messagesByType = db.links.messagesByType

  db.links = db.links.links

  var HI = undefined, LO = null

  //get all messages that link to a given message.

  db.relatedMessages = Related(db)

  return db
}

