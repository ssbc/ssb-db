var Blake2s = require('blake2s')
var ecc = require('eccjs')
var k256 = ecc.curves.k256
var pull = require('pull-stream')
var assert = require('assert')
var delayed = require('pull-delayed-sink')
var pl = require('pull-level')

var codec = require('./codec')

var INIT = new Buffer('INIT')

var zeros = new Buffer(32)
zeros.fill(0)

function bsum (value) {
  return new Blake2s().update(value).digest()
}

function validate(msg, keys) {
  msg = Buffer.isBuffer(msg) ? codec.Message.decode(msg) : msg
  assert.deepEqual(bsum(keys.public), msg.author)
  return ecc.verify(k256, keys, msg.signature, bsum(codec.UnsignedMessage.encode(msg)))
}

function signMessage(msg, keys) {
  msg.signature = ecc.sign(k256, keys, bsum(codec.UnsignedMessage.encode(msg)))
  return msg
}

function toBuffer (str) {
  if('string' === typeof str)
    return new Buffer(str, 'utf8')
  return str
}

//function compare (a, b) {
//  var l = Math.min(a.length, b.length)
//  for(var i = 0; i < l; i++) {
//    if(a[i]<b[i]) return -1
//    if(a[i]>b[i]) return  1
//  }
//  return a.length - b.length
//}

//verify the signature, but not the sequence number or prev
Feed.verify = function (msg, keys) {
  var public = keys.public || keys
  var hash = bsum(codec.UnsignedMessage.encode(msg))
  if(!ecc.verify(k256, keys, msg.signature, hash))
    throw new Error('message was not validated by:' + bsum(public))
  return true
}

Feed.decodeStream = function () {
  return pull.map(function (op) {
    return codec.Message.decode(op.value ? op.value : op)
  })
}

Feed.encodeWithIndexes = function (msg) {
  var key = codec.Key.encode({id: msg.author, sequence: msg.sequence})
  var value = codec.Message.encode(msg)
  var _key = codec.FeedKey.encode({hash: value, timestamp: msg.timestamp})

  return [
    {key: key, value: value, type: 'put'},
    {key: _key, value: key, type: 'put'}
  ]

}

module.exports = Feed

function Feed (db, id, keys) {
  if('function' !== typeof db.put)
    throw new Error('db instance must be first argument')

  if(id.public)
    keys = id, id = bsum(keys.public)

  if(!id)
    throw new Error('must have a id')
  var feed = [], onVerify = [], state = 'created'
  var ready = false, verifying = false
  var ones = new Buffer(8); ones.fill(0xFF)
  var first, last
  var prev = zeros, seq = 0
  var f
  var last

  if(keys) {
    first = codec.Key.encode({id: id, sequence: 0})
    last = Buffer.concat([new Buffer([1]), id, ones])
  }
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

    var batch = Feed.encodeWithIndexes(msg)

    //TODO: THINK HARD ABOUT RACE CONDTION!
    //PROBABLY, UPDATE VIA A WRITE STREAM THAT USES BATCHES.
    prev = bsum(batch[0].value)
    seq++
    db.batch(batch, function (err) {
      cb(null, msg.sequence, prev)
    })
  }

  return f = {
    id: id,
    feed: feed,
    //expose a copy of the pub key, so no one can mess with it.
    public: keys ? new Buffer(keys.public) : null,
    append: function _append (type, message, cb) {
      type = toBuffer(type)
      message = toBuffer(message)

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
        var _start = codec.Key.encode({id: id, sequence: opts ? opts.gt|0 : 0})
        return  pull(
          (opts && !isNaN(opts.gt)
          ? pl.read(db, {
              gt: _start,
              lte: last,
            })
          : pl.read(db, {
              gte: first,
              lte: last,
            })
          ),
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
              var _id = bsum(msg.message)
              assert.deepEqual(id, _id, 'unexpected id')
              keys = {public: f.public = msg.message}
              first = codec.Key.encode({id: id, sequence: 0})
              last = Buffer.concat([new Buffer([1]), id, ones])
            }

            assert.deepEqual(msg.author, id, 'unexpected author')
            assert.deepEqual(msg.previous, prev, 'messages out of order')
            assert.equal(msg.sequence, seq, 'sequence number is incorrect')

            var hash = bsum(codec.UnsignedMessage.encode(msg))

            if(!ecc.verify(k256, keys, msg.signature, hash))
              throw new Error('message was not validated by:' + id)

            //TODO: THINK HARD ABOUT RACE CONDTION!
            prev = bsum(codec.Message.encode(msg))
            seq ++

            return Feed.encodeWithIndexes(msg)
          }),
          pull.flatten(),
          pl.write(db, function (err) {
            cb(err, seq-1, prev)
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
        //oh, problem is that we don't KNOW the last thing yet?
        pl.read(db, {gte: first, lte: last, keys: false}),
        Feed.decodeStream(),
        pull.map(function (msg) {
          //just copied this from above, tidy up later.
          if(!keys) {
            keys = {public: msg.message}
            first = Keys.write({id: id, sequence: 0})
            last = Buffer.concat([id, ones])
          }

          assert.deepEqual(msg.author, id, 'unexpected author')
          assert.deepEqual(msg.previous, prev, 'messages out of order')
          assert.equal(msg.sequence, nextSeq, 'sequence number is incorrect')
          seq = nextSeq
          var hash = bsum(codec.UnsignedMessage.encode(msg))

          if(!ecc.verify(k256, keys, msg.signature, hash))
            throw new Error('message was not validated by:' + id)

          feed.push(msg)
          prev = bsum(codec.Message.encode(msg))
          seq ++
          return true
        }),
        pull.drain(null, function (err) {
          //if there where no records in the database...
          if(err) return cb(err)
          else if(seq === 0 && keys && keys.private) {
            return append(INIT, keys.public, function (err, _seq, _hash) {
              cb(err, _seq, _hash)
            })
          }
          else
            cb(null, seq-1, prev)
        })
      )

    }
  }
}

if(!module.parent) {
  var d = Key.encode({id: bsum('hello'), sequence: 0})
  console.error(d)
}
