var varstruct = require('varstruct')
var Blake2s = require('blake2s')
var ecc = require('eccjs')
var k256 = ecc.curves.k256
var pull = require('pull-stream')
var assert = require('assert')
var delayed = require('pull-delayed-sink')
var b2s = varstruct.buffer(32)
var signature = varstruct.buffer(64)


var type = varstruct.varbuf(varstruct.bound(varstruct.byte, 0, 32))

var UnsignedMessage = varstruct({
  previous  : b2s,
  author    : b2s,
  sequence  : varstruct.varint,
  type      : type,
  message   : varstruct.varbuf(varstruct.byte)
})

var Message = varstruct({
  previous  : b2s,
  author    : b2s,
  sequence  : varstruct.varint,
  type      : type,
  message   : varstruct.varbuf(varstruct.byte),
  signature : signature
})

var INIT = new Buffer('INIT')

var zeros = new Buffer(32)
zeros.fill(0)

function bsum (value) {
  return new Blake2s().update(value).digest()
}

function validate(msg, keys) {
  msg = Buffer.isBuffer(msg) ? message.decode(msg) : msg
  process.assert(bsum(keys.public).toString('hex') === msg.author.toString('hex'), 'same author')
  return ecc.verify(k256, keys, msg.signature, bsum(unsigned_message.encode(msg)))
}

function signMessage(msg, keys) {
  msg.signature = ecc.sign(k256, keys, bsum(UnsignedMessage.encode(msg)))
  return msg
}

function Feed (db, keys) {
  if('function' !== typeof db.put)
    throw new Error('db instance must be first argument')

  var feed = [], id = keys ? bsum(keys.public) : null, onVerify = [], state = 'created'
  var ready = false, verifying = false

  function append (type, buffer, cb) {
    var last = feed[feed.length - 1]
    var msg = signMessage({
      previous: last ? bsum(Message.encode(last)) : zeros,
      author  : bsum(keys.public),
      type    : type,
      sequence: feed.length,
      message : buffer
    }, keys)
    feed.push(msg)
    cb(null, msg.sequence, bsum(Message.encode(msg)))
  }

  var prev = zeros, seq = 0
  var f
  return f = {
    id: id,
    feed: feed,
    append: function _append (type, message, cb) {
      if(!ready)
        f.verify(function (err) {
          if(err) return cb(err)
          append(type, message, cb)
        })
      else
        append(type, message, cb)
    },
    createReadStream: function (opts) {
      //defer until verified!
      var deferred = pull.defer()
      function createSource () {
        return  opts && !isNaN(opts.gt)
          ? pull.values(feed.slice(opts.gt + 1))
          : pull.values(feed)
      }
      if(state !== 'ready') {
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
        return pull(pull.map(function (msg) {
            if(!keys) {
              keys = {public: msg.message}
              f.id = id = bsum(keys.public)
            } else
              seq ++

            assert.deepEqual(msg.author, id, 'unexpected author')
            assert.deepEqual(msg.previous, prev, 'messages out of order')
            assert.equal(msg.sequence, seq, 'sequence number is incorrect')

            var hash = bsum(UnsignedMessage.encode(msg))

            if(!ecc.verify(k256, keys, msg.signature, hash))
              throw new Error('message was not validated by:' + id)

            feed.push(msg)
            prev = bsum(Message.encode(msg))

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
        pull.values(feed),
        pull.map(function (msg) {
          //just copied this from above, tidy up later.
          if(!keys) {
            keys = {public: msg.message}
            f.id = id = bsum(keys.public)
          } else
            seq ++

          assert.deepEqual(msg.author, id, 'unexpected author')
          assert.deepEqual(msg.previous, prev, 'messages out of order')
          assert.equal(msg.sequence, seq, 'sequence number is incorrect')

          var hash = bsum(UnsignedMessage.encode(msg))

          if(!ecc.verify(k256, keys, msg.signature, hash))
            throw new Error('message was not validated by:' + id)

          feed.push(msg)
          prev = bsum(Message.encode(msg))

          return true
        }),
        pull.drain(null, function (err) {
          //if there where no records in the database...
          if(err) return cb(err)
          else if(seq === 0 && keys && keys.private)
            return append(INIT, keys.public, function (err, _seq, _hash) {
              seq = _seq; hash = _hash
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
  var hash = bsum(UnsignedMessage.encode(msg))
  if(!ecc.verify(k256, keys, msg.signature, hash))
    throw new Error('message was not validated by:' + bsum(public))
  return true
}

module.exports = Feed
