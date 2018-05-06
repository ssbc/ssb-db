'use strict';

var join      = require('path').join
var EventEmitter = require('events')

var pull      = require('pull-stream')
var timestamp = require('monotonic-timestamp')
var explain   = require('explain-error')

var ref       = require('ssb-ref')
var ssbKeys   = require('ssb-keys')
var Notify    = require('pull-notify')

var isFeedId = ref.isFeedId
var isMsgId  = ref.isMsgId
var isBlobId = ref.isBlobId

var u         = require('./util')
var stdopts   = u.options
var Format    = u.Format

//53 bit integer
var MAX_INT  = 0x1fffffffffffff

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

  var db = require('./db')(join(opts.path || path, 'flume'), keys, opts)

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

  db.get = function (opts, cb) {
    var isPrivate = false, unbox, key = isString(opts) ? opts : opts.id
    if('object' === typeof opts) {
      isPrivate = opts.private === true
      unbox = opts.unbox || opts.query && opts.query.unbox
      key = opts.id
    }

    if(unbox && !isPrivate)
      throw new Error('unbox key provided, but private was not explicitly set to true')

    if(ref.isMsg(key))
      return db.keys.get(key, function (err, data) {
        if(err) cb(err)
        else if(unbox && isPrivate) {
          if(!isString(data.value.content))
            return cb(null, data.value) //already decrypted

          var ctxt = data.value.content
          data.value.content = ssbKeys.unboxBody(ctxt, unbox)
          data.value.cyphertext = ctxt
          data.value.unbox = unbox
          data.value.private = true
          cb(null, data.value)
        }
        else cb(null, data && u.reboxValue(data.value, isPrivate))
      })
    else if(Number.isInteger(key))
      _get(key, cb) //seq
    else
      throw new Error('secure-scuttlebutt.get: key *must* be a ssb message id or a flume offset')
  }

  db.add = function (msg, cb) {
    db.queue(msg, function (err, data) {
      if(err) cb(err)
      else db.flush(function () { cb(null, data) })
    })
  }

  db.createFeed = function (keys) {
    if(!keys) keys = ssbKeys.generate()
    function add (content, cb) {
      //LEGACY: hacks to support add as a continuable
      if(!cb)
        return function (cb) { add (content, cb) }

      db.append({content: content, keys: keys}, cb)
    }
    return {
      add: add, publish: add,
      id: keys.id, keys: keys
    }
  }

  db.createRawLogStream = function (opts) {
    return db.stream(opts)
  }

  //pull in the features that are needed to pass the tests
  //and that sbot, etc uses but are slow.
  require('./extras')(db, opts, keys)

  //writeStream - used in (legacy) replication.
  db.createWriteStream = function (cb) {
    return pull(
      pull.asyncMap(function (data, cb) {
        db.queue(data, function (err, msg) {
          if(err) {
            db.emit('invalid', err, msg)
          }
          setImmediate(cb)
        })
      }),
      pull.drain(null, function (err) {
        if(err) return cb(err)
        db.flush(cb)
      })
    )
  }

  //should be private
  db.createHistoryStream = db.clock.createHistoryStream

  //called with [id, seq] or "<id>:<seq>"
  db.getAtSequence = function (seqid, cb) {
    //will NOT expose private plaintext
    db.clock.get(isString(seqid) ? seqid.split(':') : seqid, function (err, value) {
      if(err) cb(err)
      else cb(null, u.rebox(value))
    })
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

