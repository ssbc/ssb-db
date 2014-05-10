var tape = require('tape')
var pull = require('pull-stream')

var Feed = require('../')
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

  //create when you know the public keys
  var keys = ecc.generate(ecc.curves.k256)
  var feed = Feed(keys)

  //creates a feed with one message in it,
  //containing the public key.
  pull(
    feed.createReadStream(),
    pull.collect(function (err, ary) {
      t.equal(ary.length, 1)
      var msg = ary[0]
      t.deepEqual(msg.author, bsum(keys.public))
      t.deepEqual(msg.message, keys.public)
      t.ok(Feed.verify(msg, keys))
      t.end()
    })
  )
})

tape('writing to a follower sets the public key in the first message', function (t) {

  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(keys)
  var follower = Feed()

  t.notOk(follower.id)

  pull(
    author.createReadStream(),
    follower.createWriteStream(function (err) {
      t.deepEqual(follower.id, author.id)
      t.end()
    })
  )

})

tape('can createReadStream(after) a given message', function (t) {
  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(keys)
  var hello = new Buffer('hello world')
  author.append(MESSAGE, hello, function (err, seq, hash) {

    pull(
      author.createReadStream({gt:0}),
      pull.collect(function (err, values) {
        t.deepEqual(values[0].message, hello)
        t.equal(values[0].sequence, 1)
        t.end()
      })
    )


  })

})

tape('writing can append multiple messages', function (t) {

  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(keys)
  var follower = Feed()

  t.notOk(follower.id)

  author.append(MESSAGE, new Buffer('hello world'), function (err, seq, hash) {
    if(err) throw err
    t.equal(seq, 1)
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
  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(keys)
  var author2 = Feed(keys)
  var follower = Feed()


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

  var keys = ecc.generate(ecc.curves.k256)
  var author = Feed(keys)
  var follower = Feed()

  t.notOk(follower.id)

  pull(
    author.createReadStream(),
    follower.createWriteStream(function (err) {
      if(err) throw err
      author.append(MESSAGE, new Buffer('hello world'),
        function (err, _seq, _hash) {
          if(err) throw err
          t.equal(_seq, 1)
          t.ok(_hash)

          pull(
            author.createReadStream({gt: 0}),
            follower.createWriteStream(function (err, seq, hash) {
              if(err) throw err
              t.equal(seq, _seq)
              t.deepEqual(hash, _hash)
//              console.log(author, follower)
              t.end()
            })
          )

        })
    })
  )

})
