'use strict';

var join      = require('path').join
var EventEmitter = require('events')
//var Obv       = require('obv')

var pull      = require('pull-stream')
var timestamp = require('monotonic-timestamp')
var explain   = require('explain-error')
//var createFeed = require('ssb-feed')
var ref       = require('ssb-ref')
var ssbKeys   = require('ssb-keys')
var Notify    = require('pull-notify')
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
  else db.ready.set(true)

  db.sublevel = function (a, b) {
    return _db.sublevel(a, b)
  }

  //UGLY HACK, but...
  //fairly sure that something up the stack expects ssb to be an event emitter.
  db.__proto__ = new EventEmitter()

  db.opts = opts

  var _get = db.get

  db.get = function (key, cb) {
    if(ref.isMsg(key))
      return db.keys.get(key, function (err, seq) {
        if(err) cb(err)
        else cb(null, seq && seq.value)
      })
    else if(Number.isInteger(key)) 
      _get(key, cb) //seq
    else
      throw new Error('secure-scuttlebutt.get: key *must* be a ssb message id or a flume offset')
  }

  db.add = function (msg, cb) {
    db.queue(msg, function (err, data) {
      if(err) cb(err)
      else db.flush(function () {
        cb(null, data)
      })
    })
  }

  db.createFeed = function (keys) {
    if(!keys) keys = ssbKeys.generate()
    function add (content, cb) {
      db.append({content: content, keys: keys}, function (err, data) {
        if(err) cb(err)
        //THIS IS A HACK to make relatedMessages work.
        //I'd rather not have hacks like this, especially
        //since the timestamp could be useful. But better
        //to not change the tests just yet.
        else cb(null, {key:data.key, value: data.value})
      })
    }
    return {
      add: add, publish: add,
      id: keys.id, keys: keys
    }
  }

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
            db.emit('invalid', err, msg)
          }
          cb()
        })
      }),
      pull.drain(null, cb)
    )
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
    return pull(db.time.read(opts), Format(keys, values))
  }

  db.messagesByType = db.links.messagesByType

  db.links = db.links.links

  var HI = undefined, LO = null

  //get all messages that link to a given message.

  db.relatedMessages = Related(db)

  //called with [id, seq] or "<id>:<seq>"
  db.getAtSequence = function (seqid, cb) {
    db.clock.get(isString(seqid) ? seqid.split(':') : seqid, cb)
  }

  db.getVectorClock = function (_, cb) {
    if(!cb) cb = _
    db.last.get(function (err, h) {
      if(err) return cb(err)
      var clock = {}
      for(var k in h)
        clock[k] = h[k].sequence
      cb(null, clock)
    })

  }

  if(_db) {
    var close = db.close
    db.close = function (cb) {
      var n = 2
      _db.close(next); close(next)

      function next (err) {
        if(err && n>0) {
          n = -1
          return cb(err)
        }
        if(--n) return
        cb()
      }

    }

  }
  return db
}

