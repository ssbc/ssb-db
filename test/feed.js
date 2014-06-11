var tape = require('tape')
var pull = require('pull-stream')
var codec = require('../codec')
var level = require('level-test')
  ({valueEncoding: codec, keyEncoding: codec})
var Feed = require('../feed')
var Blake2s = require('blake2s')
var ecc = require('eccjs')

function bsum(s) {
  return new Blake2s().update(s).digest()
}
// simulate creating a feed from the author,
// and then validating that from a reader.

// the author has a private key, and creates a feed.
// then a chain of messages that point back to the beginning.

// the reader only has the hash of the public key,
// but can get the public key from the first message,
// check that, and then use that to validate the signatures.

var MESSAGE = new Buffer('message')

tape('simple', function (t) {
  var db = level('sscuttlebutt-simple')
  //create when you know the public keys
  var keys = ecc.generate(ecc.curves.k256)
  var feed = Feed(db, keys)

  //creates a feed with one message in it,
  //containing the public key.

  feed.verify(function (err, seq, hash) {
    if(err) throw err
    pull(
      feed.createReadStream(),
      pull.collect(function (err, ary) {
        t.equal(ary.length, 1)
        var msg = ary[0]
        t.deepEqual(msg.author, bsum(keys.public))
        t.deepEqual(msg.message, keys.public, '1st message should be pubkey')
        t.ok(Feed.verify(msg, keys))
        t.end()
      })
    )
  })
})

tape('writing to a follower sets the public key in the first message', function (t) {
  var db1 = level('sscuttlebutt-follower1')
  var db2 = level('sscuttlebutt-follower2')

  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(db1, keys)
  var follower = Feed(db2, bsum(keys.public))

  //we already know the id.
  t.ok(follower.id)

  pull(
    author.createReadStream(),
    follower.createWriteStream(function (err) {
      t.deepEqual(follower.id, author.id)
      t.deepEqual(follower.public, keys.public)
      t.end()
    })
  )

})

tape('can createReadStream(after) a given message', function (t) {
  var db = level('sscuttlebutt-after')

  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(db, keys)
  var hello = new Buffer('hello world')
  author.append(MESSAGE, hello, function (err, seq, hash) {

    pull(
      author.createReadStream({gt:1}),
      pull.collect(function (err, values) {
        t.deepEqual(values[0].message, hello)
        t.equal(values[0].sequence, 2)
        t.end()
      })
    )

  })

})

tape('writing can append multiple messages', function (t) {

  var db1 = level('sscuttlebutt-append1')
  var db2 = level('sscuttlebutt-append2')

  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(db1, keys)
  var follower = Feed(db2, {public: keys.public})

  t.ok(follower.id)

  author.append(MESSAGE, new Buffer('hello world'), function (err, seq, hash) {
    if(err) throw err
    t.equal(seq, 2)
    t.ok(hash)

    pull(
      author.createReadStream(),
      follower.createWriteStream(function (err, _seq, _hash) {
        if(err) throw err
        t.deepEqual(follower.id, author.id)
        t.equal(_seq, seq)
        t.deepEqual(_hash, hash)
        t.end()
      })
    )
  })
})

tape('once a follower is initilized, '
    +'writing messages from the wrong author is an error', function (t) {
  var db1 = level('sscuttlebutt-error1')
  var db2 = level('sscuttlebutt-error2')
  var db3 = level('sscuttlebutt-error3')


  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(db1, keys)
  var author2 = Feed(db2, keys)
  var follower = Feed(db3, {public: keys.public})

  pull(
    author.createReadStream(),
    follower.createWriteStream(function (err) {
      if(err) throw err
      pull(
        author2.createReadStream(),
        follower.createWriteStream(function (err) {
          t.ok(err)
          t.end()
        })
      )
    })
  )
})

tape('can write a message from one author'
    +'and then write more messages from another stream', function (t) {
  var db1 = level('sscuttlebutt-resume1')
  var db2 = level('sscuttlebutt-resume2')

  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(db1, keys)
  var follower = Feed(db2, {public: keys.public})

  t.ok(follower.id)

  pull(
    author.createReadStream(),
    follower.createWriteStream(function (err) {
      if(err) throw err
      author.append(MESSAGE, new Buffer('hello world'),
        function (err, _seq, _hash) {
          if(err) throw err
          t.equal(_seq, 2)
          t.ok(_hash)

          pull(
            author.createReadStream({gt: 1}),
            follower.createWriteStream(function (err, seq, hash) {
              if(err) throw err
              t.equal(seq, _seq)
              t.deepEqual(hash, _hash)
              t.end()
            })
          )

        })
    })
  )

})
