'use strict'

var join = require('path').join
var EventEmitter = require('events')
var pull = require('pull-stream')
var ref = require('ssb-ref')
var ssbKeys = require('ssb-keys')

var createDB = require('./db')
var extras = require('./extras')
var u = require('./util')

function isString (s) {
  return typeof s === 'string'
}

function errorCB (err) {
  if (err) throw err
}

module.exports = function create (path, opts, keys) {
  // _ was legacy db. removed that, but for backwards compatibilty reasons do not change interface
  if (!path) throw new Error('path must be provided')

  keys = keys || ssbKeys.generate()

  var db = createDB(join(opts.path || path, 'flume'), keys, opts)

  // UGLY HACK, but...
  // fairly sure that something up the stack expects ssb to be an event emitter.
  db.__proto__ = new EventEmitter() // eslint-disable-line
  db.opts = opts
  var _get = db.get
  var _del = db.del

  // pull in the features that are needed to pass the tests
  // and that sbot, etc uses but are slow.
  extras(db, opts, keys)
  // - adds indexes: links, feed, time
  // - adds methods:
  //   - db.createLogStream
  //   - db.createFeedStream
  //   - db.latest
  //   - db.latestSequence
  //   - db.getLatest

  db.get = function (key, cb) {
    let doUnbox = false
    let readKey
    let meta = false
    if (typeof key === 'object') {
      doUnbox = key.private === true
      readKey = key.unbox
      meta = key.meta
      key = key.id
    }

    if (isMsgWithQuery(key)) {
      var link = ref.parseLink(key)
      return db.get({
        id: link.link,
        private: true,
        unbox: link.query.unbox.replace(/\s/g, '+'),
        meta: link.query.meta
      }, cb)
    }

    if (ref.isMsg(key)) {
      return db.keys.get(key, function (err, data, offset) {
        if (err) return cb(err)

        var value
        if (!doUnbox) value = u.originalValue(data.value)
        else {
          if (isUnboxed(data)) value = data.value
          else {
            const unboxed = db._unbox(data, readKey)
            if (unboxed) value = unboxed.value
          }
        }

        if (!value) value = data.value // if db._unbox fails value will be undefined

        if (meta) cb(null, { key, value, timestamp: data.timestamp }, offset)
        else cb(null, value, offset)
      })
    }
    else if (Number.isInteger(key)) _get(key, cb) // seq
    else {
      throw new Error('ssb-db.get: key *must* be a ssb message id or a flume offset')
    }
  }

  db.add = function (msg, cb) {
    db.queue(msg, function (err, data) {
      if (err) cb(err)
      else db.flush(function () { cb(null, data) })
    })
  }

  db.createFeed = function (keys) {
    if (!keys) keys = ssbKeys.generate()
    function add (content, cb) {
      // LEGACY: hacks to support add as a continuable
      if (!cb) { return function (cb) { add(content, cb) } }

      db.append({ content: content, keys: keys }, cb)
    }
    return {
      add: add,
      publish: add,
      id: keys.id,
      keys: keys
    }
  }

  db.createRawLogStream = function (opts) {
    return pull(
      db.stream(opts),
      pull.map(({ seq, value }) => {
        return { seq, value: u.originalData(value) }
      })
    )
  }

  // writeStream - used in (legacy) replication.
  db.createWriteStream = function (cb) {
    cb = cb || errorCB
    return pull(
      pull.asyncMap(function (data, cb) {
        db.queue(data, function (err, msg) {
          if (err) {
            db.emit('invalid', err, msg)
          }
          setImmediate(cb)
        })
      }),
      pull.drain(null, function (err) {
        if (err) return cb(err)
        db.flush(cb)
      })
    )
  }

  /* via clock index */
  db.createHistoryStream = db.clock.createHistoryStream
  db.createUserStream = db.clock.createUserStream

  // called with [id, seq] or "<id>:<seq>"
  db.getAtSequence = function (seqid, cb) {
    // will NOT expose private plaintext
    db.clock.get(isString(seqid) ? seqid.split(':') : seqid, function (err, value) {
      if (err) cb(err)
      else cb(null, u.originalData(value))
    })
  }

  /* via last index */
  db.getVectorClock = function (_, cb) {
    if (!cb) cb = _
    db.last.get(function (err, h) {
      if (err) return cb(err)
      var clock = {}
      for (var k in h) { clock[k] = h[k].sequence }
      cb(null, clock)
    })
  }

  /* via clock + keys */
  const deleteFeed = (feed, cb) => {
    pull(
      db.createUserStream({ id: feed }),
      pull.asyncMap((msg, cb) => {
        const key = msg.key

        deleteMessage(key, (err) => {
          cb(err, key)
        })
      }),
      pull.collect(cb)
    )
  }
  const deleteMessage = (key, cb) => {
    db.keys.get(key, (err, val, seq) => {
      if (err) return cb(err)
      if (seq == null) return cb(new Error('seq is null!'))

      _del(seq, cb)
    })
  }
  db.del = (target, cb) => {
    if (ref.isMsg(target)) {
      deleteMessage(target, cb)
    } else if (ref.isFeed(target)) {
      deleteFeed(target, cb)
    } else {
      cb(new Error('deletion target must be a message or feed'))
    }
  }

  return db
}

function isMsgWithQuery (key) {
  return key.length > 52 && ref.isMsgLink(key)
}

function isUnboxed (data) {
  return typeof data.value.content === 'object'
}
