# ssb-db

A database of unforgeable append-only feeds, optimized for efficient replication for peer to peer protocols.

## What does it do?

ssb-db provides tools for dealing with unforgeable append-only message 
feeds. You can create a feed, post messages to that feed, verify a feed created by
someone else, stream messages to and from feeds, and more (see [API](#api)).

"Unforgeable" means that only the owner of a feed can modify that feed, as
enforced by digital signing (see [Security properties](#security-properties)).
This property makes ssb-db useful for peer-to-peer applications. ssb-db also
makes it easy to encrypt messages.

## Example

In this example, we create a feed, post a signed message to it, then create a stream 
that reads from the feed.

``` js
/**
 * create an ssb-db instance and add a message to it.
 */

var pull = require('pull-stream')
var fs = require('fs')

// paths:
var pathToDB     = './db'
var pathToSecret = './ssb-identity'
try { fs.mkdirSync(pathToDB) } catch(e) {}

// ways to create keys:
//var keys = require('ssb-keys').generate()
//var keys = require('ssb-keys').loadSync(pathToSecret)
//var keys = require('ssb-keys').createSync(pathToSecret)
var keys = require('ssb-keys').loadOrCreateSync(pathToSecret)

// create the db instance.
//  - uses leveldb.
//  - can only open one instance at a time.

var ssb = require('ssb-db/create')(pathToDB)

// create a feed.
//  - this represents a write access / user.
//  - you must pass in keys.
//  (see options section)

var feed = ssb.createFeed(keys)

// publish a message.
//  - feed.add appends a message to your key's chain.
//  - the `type` attribute is required.

feed.add({ type: 'post', text: 'My First Post!' }, function (err, msg, hash) {
  // the message as it appears in the database:
  console.log(msg)

  // and its hash:
  console.log(hash)
})

// stream all messages for all keypairs.
pull(
  ssb.createFeedStream(),
  pull.collect(function (err, ary) {
    console.log(ary)
  })
)

// stream all messages for a particular keypair.
pull(
  ssb.createHistoryStream({id: feed.id}),
  pull.collect(function (err, ary) {
    console.log(ary)
  })
)
```

## Concepts

Building upon ssb-db requires understanding a few concepts that it uses to
ensure the unforgeability of message feeds.

### Identities

An identity is simply a public/private key pair.

Even though there is no worldwide store of identities, it's infeasible
for anyone to forge your identity. Identities are binary strings, so not
particularly human-readable.

### Feeds

A feed is an append-only sequence of messages. Each feed is associated
1:1 with an identity. The feed is identified by its public key. This
works because public keys are unique.

Since feeds are append-only, replication is simple: request all messages
in the feed that are newer than the latest message you know about.

Note that append-only really means append-only: you cannot delete an
existing message. If you want to enable entities to be deleted or 
modified in your data model, that can be implemented in a layer on top 
of ssb-db using
[delta encoding](https://en.wikipedia.org/wiki/Delta_encoding).

### Messages

Each message contains:

- A message object. This is the thing that the end user cares about. If
  there is no encryption, this is a `{}` object. If there is encryption,
  this is an encrypted string.
- A content-hash of the previous message. This prevents somebody with
  the private key from changing the feed history after publishing, as a
  newly-created message wouldn't match the "prev-hash" of later messages
  which were already replicated.
- The signing public key.
- A signature. This prevents malicious parties from writing fake 
  messages to a stream.
- A sequence number. This prevents a malicious party from making a copy
  of the feed that omits or reorders messages.
  
Since each message contains a reference to the previous message, a feed 
must be replicated in order, starting with the first message. This is
the only way that the feed can be verified. A feed can be *viewed* in
any order after it's been replicated.

### Object ids

The text inside a message can refer to three types of ssb-db
entities: messages, feeds, and blobs (i.e. attachments). Messages and 
blobs are referred to by their hashes, but a feed is referred to by its
signing public key. Thus, a message within a feed can refer to another
feed, or to a particular point _within_ a feed.

Object ids begin with a sigil `@` `%` and `&` for a `feedId`, `msgId`
and `blobId` respectively.

Note that ssb-db does not include facilities for retrieving a blob given the
hash.

### Replication

It is possible to easily replicate data between two instances of ssb-db.
First, they exchange maps of their newest data. Then, each one downloads
all data newer than its newest data.

[Scuttlebot](https://github.com/ssbc/scuttlebot) is a tool that
makes it easy to replicate multiple instances of ssb-db using a
decentralized network.

### Security properties

ssb-db maintains useful security properties even when it is
connected to a malicious ssb-db database. This makes it ideal
as a store for peer-to-peer applications.

Imagine that we want to read from a feed for which we know the identity,
but we're connected to a malicious ssb-db instance. As long as the malicious
database does not have the private key:

- The malicious database cannot create a new feed with the same identifier
- The malicious database cannot write new fake messages to the feed
- The malicious database cannot reorder the messages in the feed
- The malicious database cannot send us a new copy of the feed that omits
  messages from the middle
- The malicious database *can* refuse to send us the feed, or only send
  us the first *N* messages in the feed
- Messages may optionally be encrypted. See `test/end-to-end.js`.


## API

### ssb = require('ssb-db/create')(path)

Create an ssb-db database at the given path, returns an instance.

### require('ssb-db')(db, opts)

Pass in a [levelup](https://github.com/rvagg/node-levelup) instance
(it must have [sublevel](https://github.com/dominictarr/level-sublevel) installed),
and an options object. The options object provides the crypto
and encoding functions, that are not directly tied into how
ssb-db works.

The following methods all apply to a `ssb-db` instance

### SSBdb#get (id | seq | opts, cb)

Get an ssb message. If `id` is a message id, the message is returned.
If seq is provided, the message at that offset in the underlying flumelog
is returned. If opts is passed, the message id is taken from either
`opts.id` or `opts.key`. If `opts.private = true` the message will be decrypted
if possible. If `opts.meta = true` is set, or `seq` is used, the message will
be in `{key, value: msg, timestamp}` format. Otherwise the raw message (without key and timestamp)
are returned. This is for backwards compatibility reasons. Given that most other apis
(such as createLogStream) by default return `{key, value, timestamp}` it's recommended
to use `get({id: key, meta: true}, cb)`

### SSBdb#createFeed (keys?)

Create a Feed object. A feed is a chain of messages signed
by a single key (the identity of the feed).
This handles the state needed to append valid messages to a feed.
If keys are not provided, then a new key pair will be generated.

The following methods apply to the Feed type.

#### Feed#add (message, cb)

Adds a message of a given type to a feed.
This is the recommended way to append messages.
message is a javascript object. It must be a `{}` object with a `type`
property that is a string between 3 and 32 chars long.

If `message` has `recps` property which is an array of feed ids, then the message
content will be encrypted using [private-box](https://github.com/auditdrivencrypto/private-box) to
those recipients. Any invalid recipients will cause an error, instead of accidentially posting
a message publically or without a recipient.

#### Feed#id

the id of the feed (which is the feed's public key)

#### Feed#keys

the key pair for this feed.

### ssbDb#createFeedStream (opts) -> PullSource

Create a [pull-stream](https://github.com/dominictarr/pull-stream)
of all the feeds in the database, ordered by timestamps.
All [pull-level](https://github.com/dominictarr/pull-level) options
are allowed (start, end, reverse, tail)

### ssbDb#createLogStream({gt: ts, tail: boolean}) -> PullSource

create a stream of the messages that have been written to this instance
in the order they arrived. This is mainly intended for building views.
The objects in this stream will be of the form:

``` js
{
  key: Hash, value: Message, timestamp: timestamp
}
```
`timestamp` is generated by
[monotonic-timestamp](https://github.com/dominictarr/monotonic-timestamp)

### ssbDb#createHistoryStream ({id: feedId, seq: int?, live: bool?, limit: int?, keys: bool?, values: bool?}) -> PullSource

Create a stream of the history of `id`. If `seq > 0`, then
only stream messages with sequence numbers greater than `seq`.
if `live` is true, the stream will be a
[live mode](https://github.com/dominictarr/pull-level#example---reading)

### ssbDb#messagesByType ({type: string, live: bool?}) -> PullSource

retrieve messages with a given type. All messages must have a type,
so this is a good way to select messages that an application might use.
Returns a source pull-stream. This function takes all the options from [pull-level#read](https://github.com/dominictarr/pull-level#example---reading)
(gt, lt, gte, lte, limit, reverse, live)


### ssbDb#links ({source: feedId?, dest: feedId|msgId|blobId?, rel: string?, meta: true?, keys: true?, values: false?, live:false?, reverse: false?}) -> PullSource

Get a stream of links from a feed to a blob/msg/feed id.

The objects in this stream will be of the form:

```
{ source: feedId, rel: String, dest: Id, key: MsgId, value: Object? }
```

 - `source` (string, optional): feed id..
 - `dest` (string, optional): An id or filter, specifying where the link should point to.
  To filter, just use the sigil of the type you want: `@` for feeds, `%` for messages, and `&` for blobs.
 - `rel` (string, optional): Filters the links by the relation string.

If `opts.values` is set (default: false) `value` will be the message the link occurs in.
If `opts.keys` is set (default: true) `key` will be the message id.
If `opts.meta` is unset (default: true) `source, hash, rel` will be left off.

> Note: if `source`, and `dest` is provided, but not `rel`, ssb will
> have to scan all the links from source, and then filter by dest.
> your query will be more efficient if you also provide `rel`.

### ssbDb#addMap (fn)

Add a map function to be applied to all messages on *read*. The `fn` function
is should expect `(msg, cb)`, and must eventually call `cb(err, msg)` to finish.

These modifications only change the value being read, but the underlying data is
never modified. If multiple map functions are added, they are called serially and
the `msg` output by one map function is passed as the input `msg` to the next.

Additional properties may only be added to `msg.value.meta`, and modifications
may only be made *after* the original value is saved in `msg.value.meta.original`.


```js
ssbDb.addMap(function (msg, cb) {
  if (!msg.value.meta) {
    msg.value.meta = {}
  }

  if (msg.value.timestamp % 3 === 0)
    msg.value.meta.fizz = true
  if (msg.timestamp % 5 === 0)
    msg.value.meta.buzz = true
  cb(null, msg)
})

const metaBackup = require('ssb-db/util').metaBackup

ssbDb.addMap(function (msg, cb) {
  // This could instead go in the first map function, but it's added as a second
  // function for demonstration purposes to show that `msg` is passed serially.
  if (msg.value.meta.fizz && msg.value.meta.buzz) {
    msg.meta = metaBackup(msg.value, 'content')

    msg.value.content = {
      type: 'post',
      text: 'fizzBuzz!'
    }
  }
  cb(null, msg)
})
```

## Stability

Stable: Expect patches, possible features additions.

## License

MIT



