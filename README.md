# secure-scuttlebutt

A secure database with replication that is gauranteed to work.

``` js
// create a scuttlebutt instance and add a message to it.

var ssb = require('secure-scuttlebutt/create')(path)

//create a feed.
//this represents a write access / user.
//you must pass in keys.
//(see options section)

var feed = ssb.createFeed(keys)

// the first message in the feed is always the public key.
//add a message to your feed.

//feed.add appends a message to your key's chain.
feed.add('msg', 'FIRST POST', function (err, msg, hash) {
  //the message as it appears in the database.
  console.log(msg)

  //and it's hash
  console.log(hash)
})

// stream all messages by all keys.
pull(
  ssb.createFeedStream(),
  pull.collect(function (err, ary) {
    console.log(ary)
  })
)

// get all messages for a particular key.
pull(
  ssb.createHistoryStream(feed.id),
  pull.collect(function (err, ary) {
    console.log(ary)
  })
)

// create a server for replication.

var net = require('net')
var toStream = require('pull-stream-to-stream')

net.createServer(function (stream) {
  // secure-scuttlebutt uses pull-streams so
  // convert it into a node stream before piping.
  stream.pipe(toStream(ssb.createReplicationStream())).pipe(stream)
}).listen(1234)

//create another database to replicate with:

var ssb2 = require('secure-scuttlebutt/create')(path2)
//follow the key we created before.
ssb2.follow(feed.id)

// replicate from the server.
// this will pull the messages by feed1 into this database.
var stream = net.connect(1234)
stream.pipe(toStream(ssb2.createReplicationStream())).pipe(stream)
```

## API

### ssb = require('secure-scuttlebutt/create')(path)

Create a secure-scuttlebutt database at the given path,
returns an instance.

### require('secure-scuttlebutt')(db, opts)

Pass in a [levelup](https://github.com/rvagg/node-levelup) instance
(it must have [sublevel](https://github.com/dominictarr/level-sublevel) installed),
and an options object. The options object provides the crypto
and encoding functions, that are not directly tied into how
secure-scuttlebutt works.

The following methods all apply to a `SecureScuttlebutt` instance

### .createFeed (keys?)

Create a Feed object. This handles the state needed to append valid
messages to a feed.

### .follow (id)

Mark `id`'s feed as replicated. this instance will request
data created by `id` when replicating.
see [createReplicationStream](#createReplicationStream)
The id must be the hash of id's public key.

### .getPublicKey(id, cb)

Retrive the public key for `id`, if it is in the database.
If you have replicated id's data then you will have the public key,
as public keys are contained in the first message.

### .createFeedStream (opts)

Create a [pull-stream](https://github.com/dominictarr/pull-stream)
of the data in the database, ordered by timestamps.
All [pull-level](https://github.com/dominictarr/pull-level) options
are allowed (start, end, reverse, tail)

### .createHistoryStream (id, seq?, live?)

Create a stream of the history of `id`. If `seq > 0`, then
only stream messages with sequence numbers greater than `seq`.
if `live` is true, the stream will be a
[live mode](https://github.com/dominictarr/pull-level#example---reading)

### .createReplicationStream()

Create a duplex pull-stream that speak's secure-scuttlebutt's replication protocol.
this will be a pull-stream so you will need to use it with 
[pull-stream-to-stream](https://github.com/dominictarr/pull-stream-to-stream)

This should be in the duplex style, when connecting as either a server or a client.

## License

MIT
