var Blake2s = require('blake2s')
var ecc = require('eccjs')
var k256 = ecc.curves.k256
var pull = require('pull-stream')
var assert = require('assert')
var delayed = require('pull-delayed-sink')
var pl = require('pull-level')

var codex = require('./codex')

var INIT = new Buffer('INIT')

var zeros = new Buffer(32)
zeros.fill(0)

function bsum (value) {
  return new Blake2s().update(value).digest()
}

function validate(msg, keys) {
  msg = Buffer.isBuffer(msg) ? codex.Message.decode(msg) : msg
  process.assert(bsum(keys.public).toString('hex') === msg.author.toString('hex'), 'same author')
  return ecc.verify(k256, keys, msg.signature, bsum(codex.UnsignedMessage.encode(msg)))
}

function signMessage(msg, keys) {
  msg.signature = ecc.sign(k256, keys, bsum(codex.UnsignedMessage.encode(msg)))
  return msg
}

function Feed (db, keys) {
  if('function' !== typeof db.put)
    throw new Error('db instance must be first argument')

  var feed = [], id = keys ? bsum(keys.public) : null, onVerify = [], state = 'created'
  var ready = false, verifying = false
  var ones = new Buffer(8); ones.fill(0xFF)
  var first, last
  var prev = zeros, seq = 0
  var f

  function append (type, buffer, cb) {
    var d = new Date()
    var msg = signMessage({
      previous: prev || zeros,
      author  : bsum(keys.public),
      timestamp: +d,
      timezone: d.getTimezoneOffset(),
      type    : type,
      sequence: seq,
      message : buffer
    }, keys)

    var key = codex.Key.encode({id: id, sequence: seq})
    var value = codex.Message.encode(msg)

    //TODO: THINK HARD ABOUT RACE CONDTION!
    //PROBABLY, UPDATE VIA A WRITE STREAM THAT USES BATCHES.
    prev = bsum(value)
    seq++
    db.put(key, value, function (err) {
      cb(null, msg.sequence, prev)
    })
  }

  return f = {
    id: id,
    feed: feed,
    append: function _append (type, message, cb) {
      if(!ready) {
        f.verify(function (err, s, h) {
          if(err) return cb(err)
          append(type, message, cb)
        })
      } else
        append(type, message, cb)
    },
    createReadStream: function (opts) {
      //defer until verified!
      var deferred = pull.defer()
      function createSource () {
        return  pull(
            (opts && !isNaN(opts.gt))
          ? pl.read(db, {gt: codex.Key.encode({id: id, sequence: opts.gt, lte: last})})
          : pl.read(db, {gte: codex.Key.encode({id: id, sequence: 0}), lte: last}),
          Feed.decodeStream()
        )

      }
      if(!ready) {
        f.verify(function () { deferred.resolve(createSource()) })
        return deferred
      }
      else
        return createSource()
    },
    //to make this work async,
    //defer any appending until a verification scan is complete
    //and ignore any records that you already have.
    createWriteStream: function (cb) {
      //don't read until verified.
      function createSink() {
        return pull(
          pull.map(function (msg) {
            if(!keys) {
              keys = {public: msg.message}
              f.id = id = bsum(keys.public)
              first = codex.Key.encode({id: id, sequence: 0})
              last = Buffer.concat([id, ones])
            } else
              seq ++

            assert.deepEqual(msg.author, id, 'unexpected author')
            assert.deepEqual(msg.previous, prev, 'messages out of order')
            assert.equal(msg.sequence, seq, 'sequence number is incorrect')

            var hash = bsum(codex.UnsignedMessage.encode(msg))

            if(!ecc.verify(k256, keys, msg.signature, hash))
              throw new Error('message was not validated by:' + id)

            //TODO: THINK HARD ABOUT RACE CONDTION!
            prev = bsum(codex.Message.encode(msg))

            return true
          }),
          pull.drain(null, function (err) {
            cb(err, seq, prev)
          })
        )
      }
      if(!ready) {
        var d = delayed()
        f.verify(function (err) {
          d.start(createSink())
        })
        return d
      }
      else
        return createSink()
    },
    verify: function (_cb) {
      //verify from the start of the database,
      //if empty and we have the private key,
      //write the initial message.
      if(ready) return _cb(null, seq, prev)
      onVerify.push(_cb)
      if(verifying) return
      verifying = true

      function cb (err, seq, hash) {
        if(!err) ready = true
        verifying = false
        while(onVerify.length)
          onVerify.shift()(err, seq, hash)
      }

      pull(
        pl.read(db, {gte: first, lte: last}),
        Feed.decodeStream(),
        pull.map(function (msg) {
          //just copied this from above, tidy up later.
          if(!keys) {
            keys = {public: msg.message}
            f.id = id = bsum(keys.public)
            first = Keys.write({id: id, sequence: 0})
            last = Buffer.concat([id, ones])
          } else
            seq ++

          assert.deepEqual(msg.author, id, 'unexpected author')
          assert.deepEqual(msg.previous, prev, 'messages out of order')
          assert.equal(msg.sequence, seq, 'sequence number is incorrect')

          var hash = bsum(codex.UnsignedMessage.encode(msg))

          if(!ecc.verify(k256, keys, msg.signature, hash))
            throw new Error('message was not validated by:' + id)

          feed.push(msg)
          prev = bsum(codex.Message.encode(msg))

          return true
        }),
        pull.drain(null, function (err) {
          //if there where no records in the database...
          if(err) return cb(err)
          else if(seq === 0 && keys && keys.private)
            return append(INIT, keys.public, function (err, _seq, _hash) {
              cb(err, _seq, _hash)
            })
          else
            cb(null, seq, prev)
        })
      )

    }
  }
}

//verify the signature, but not the sequence number or prev
Feed.verify = function (msg, keys) {
  var public = keys.public || keys
  var hash = bsum(codex.UnsignedMessage.encode(msg))
  if(!ecc.verify(k256, keys, msg.signature, hash))
    throw new Error('message was not validated by:' + bsum(public))
  return true
}

Feed.decodeStream = function () {
  return pull.map(function (op) {
    return codex.Message.decode(op.value)
  })
}

module.exports = Feed

if(!module.parent) {
  var d = Key.encode({id: bsum('hello'), sequence: 0})
  console.error(d)
}
