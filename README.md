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
  ssb.createFeedStream(feed.id),
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

## License

MIT
