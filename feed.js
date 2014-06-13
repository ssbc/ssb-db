'use strict';

var Blake2s = require('blake2s')
var ecc     = require('eccjs')
var k256    = ecc.curves.k256
var pull    = require('pull-stream')
var assert  = require('assert')
var delayed = require('pull-delayed-sink')
var pl      = require('pull-level')
var varint  = require('varstruct').varint
var u       = require('./util')

var codec   = require('./codec')

var INIT = new Buffer('INIT')

var zeros = new Buffer(32)
zeros.fill(0)

function bsum (value) {
  return new Blake2s().update(value).digest()
}

function validate(msg, keys) {
//  msg = Buffer.isBuffer(msg) ? codec.Message.decode(msg) : msg
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

function map(mapper) {
  return function (read) {
    return function (abort, cb) {
      read(abort, function (end, data) {
        try {
          if(!end) data = mapper(data)
        } catch (err) {
          cb(err)
          read(err, function () {})
          return
        }
        cb(end, data)
      })
    }
  }
}

//verify the signature, but not the sequence number or prev
Feed.verify = function (msg, keys) {
  var pub = keys.public || keys
  var hash = bsum(codec.UnsignedMessage.encode(msg))
  if(!ecc.verify(k256, keys, msg.signature, hash))
    throw new Error('message was not validated by:' + bsum(pub))
  return true
}

Feed.decodeStream = function () {
  return pull.through()
}

//the code to manage this is split between 3 different places
//which is not good.

Feed.encodeWithIndexes = function (msg) {
  var key = {id: msg.author, sequence: msg.sequence}
  var _key = {id: msg.author, timestamp: msg.timestamp}

  var type = msg.type
  if('string' === typeof type || type.length < 32) {
    var b = new Buffer(32)
    b.fill(0)
    Buffer.isBuffer(b) ? type.copy(b) : b.write(type)
    type = b
  }

  var typeIndex = {id: msg.author, sequence: msg.sequence, type: type}
  console.log(typeIndex)
  console.log(codec.encode(typeIndex))
  //these are all encoded by a varmatch codec in codec.js
  var batch = [
    {key: key, value: msg, type: 'put'},
    {key: _key, value: key, type: 'put'},
    {key: msg.author, value: msg.sequence, type: 'put'},

    //index messages by their type.
    {key: typeIndex, value: key, type: 'put'}
  ]

  msg.references.forEach(function (ref) {
    //this author referenced some object.
    batch.push({key: {
      type: type,
      id: msg.author,
      sequence: msg.sequence,
      reference: ref
    }, value: 0, type: 'put'})
    //this object referenced by some message
    batch.push({key: {
      referenced: ref,
      type: type,
      id: msg.author,
      sequence: msg.sequence
    }, value: 0, type: 'put'})

  })

  return batch

}

module.exports = Feed

function Feed (db, id, keys) {
  if('function' !== typeof db.put)
    throw new Error('db instance must be first argument')

  if(id.public)
    keys = id, id = bsum(keys.public)

  if(!u.isHash(id))
    throw new Error('must have a valid id')

  var feed = [], onVerify = [], state = 'created'
  var ready = false, verifying = false
  var ones = new Buffer(8); ones.fill(0xFF)
  var prev = zeros, seq = 1
  var f

  var first = {id: id, sequence: 0}
  var last  = {id: id, sequence: 0x1fffffffffffff}

  function append (type, buffer, references, cb) {
    var d = new Date()
    console.log(references)
    var msg = signMessage({
      previous: prev || zeros,
      author  : bsum(keys.public),
      timestamp: +d,
      timezone: d.getTimezoneOffset(),
      type    : type,
      sequence: seq,
      message : buffer,
      references: references
    }, keys)

    var batch = Feed.encodeWithIndexes(msg)

    //TODO: THINK HARD ABOUT RACE CONDTION!
    //PROBABLY, UPDATE VIA A WRITE STREAM THAT USES BATCHES.
    prev = bsum(codec.encode(msg))
    seq++
    console.log(batch)
    db.batch(batch, function (err) {
      cb(null, msg.sequence, prev)
    })
  }

  return f = {
    id: id,
    feed: feed,
    //expose a **COPY** of the pub key, so no one can mess with it.
    public: keys ? new Buffer(keys.public) : null,
    append: function _append (type, message, references, cb) {
      if('function' === typeof references)
        cb = references, references = []
      type = toBuffer(type)
      message = toBuffer(message)

      if(!ready) {
        f.verify(function (err, s, h) {
          if(err) return cb(err)
          append(type, message, references || [], cb)
        })
      } else
        append(type, message, references || [], cb)
    },
    follow: function (id, message, cb) {
      if(!u.isHash(id)) return cb(new Error('expected id hash'))
      if('function' === typeof message)
        cb = message, message = toBuffer('')
      db.get(id, function (err, value) {
        if(err)
          db.put(id, 0, follow)
        else follow()
        function follow () {
          //to do: add 
          f.append('follow', message, [id], function (err) {
            db.put(id, 0, cb)
          })
        }
      })
    },
    createReadStream: function (opts) {
      //defer until verified!
      var deferred = pull.defer()
      function createSource () {
        var _start = (
          opts && opts.gt != null
        ? {id: id, sequence: opts.gt}
        : first
        )

        var tail = opts && opts.tail || false

        return  pull(
          opts && opts.gt != null
          ? pl.read(db, {gt: codec.encode(_start), lte: codec.encode(last), keys: false, tail: tail})
          : pl.read(db, {gte: codec.encode(_start), lte: codec.encode(last), keys: false, tail: tail})
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
          map(function (msg) {
            if(!keys) {
              var _id = bsum(msg.message)
              assert.deepEqual(id, _id, 'unexpected id')
              keys = {public: f.public = msg.message}
              first = {id: id, sequence: 0}
              last =  {id: id, sequence: 0x1fffffffffffff}
            }
            assert.deepEqual(bsum(keys.public), id, 'incorrect pubkey')
            assert.deepEqual(msg.author, id, 'unexpected author')
            assert.deepEqual(msg.previous, prev, 'messages out of order')
            assert.equal(msg.sequence, seq, 'sequence number is incorrect')

            var hash = bsum(codec.UnsignedMessage.encode(msg))

            if(!ecc.verify(k256, keys.public, msg.signature, hash)) {
              throw new Error('message was not validated by:' + id.toString('hex'))
            }

            //TODO: THINK HARD ABOUT RACE CONDTION!
            prev = bsum(codec.encode(msg))
            seq ++
            return Feed.encodeWithIndexes(msg) || []
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
        pl.read(db, {gte: codec.encode(first), lte: codec.encode(last), keys: false}),
        map(function (msg) {
        //just copied this from above, tidy up later.

          if(!keys) {
            keys = {public: msg.message}
            assert.equal(msg.sequence, 1, 'expected first message')
            assert.deepEqual(bsum(keys.public), id, 'incorrect public key')
            first = {id: id, sequence: 0}
            last = {id: id, sequence: 0x1ffffffffff}
          }

          assert.deepEqual(msg.author, id, 'unexpected author')
          assert.equal(msg.sequence, seq, 'sequence number is incorrect')
          console.log(msg)
          assert.deepEqual(msg.previous, prev, 'messages out of order')

          var hash = bsum(codec.UnsignedMessage.encode(msg))

          if(!ecc.verify(k256, keys, msg.signature, hash)) {
            throw new Error('message was not validated by:' + id)
          }
          feed.push(msg)
          prev = bsum(codec.encode(msg))
          seq ++
          return true
        }),
        pull.drain(null, function (err) {
          //if there where no records in the database...
          if(err) return cb(err)
          else if(seq === 1 && keys && keys.private) {
            return append(INIT, keys.public, [], function (err, _seq, _hash) {
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

