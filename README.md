# secure-scuttlebutt

A secure database with replication that is guaranteed to work.

## Stability

Stable: Expect patches, possible features additions.

### Documentation/wiki/FAQ

**[Documentation is here](https://github.com/ssbc/ssb-docs)**.

We have shifted documentation from a github wiki to a repo,
which means you can ask make pull requests, get notifications,
ask questions in issues. If you have questions or get confused
please post an issue!

## Example


``` js
/**
 * create a secure scuttlebutt instance and add a message to it.
 */

var pull = require('pull-stream')

// paths:
var pathToDB     = '/tmp/ssb1/'
var pathToSecret = '/tmp/ssb1-secret'

// ways to create keys:
var keys = require('ssb-keys').generate()
var keys = require('ssb-keys').loadSync(pathToSecret)
var keys = require('ssb-keys').createSync(pathToSecret)
var keys = require('ssb-keys').loadOrCreateSync(pathToSecret)

// create the db instance.
//  - uses leveldb.
//  - can only open one instance at a time.

var ssb = require('secure-scuttlebutt/create')(pathToDB)

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
  ssb.createHistoryStream(feed.id),
  pull.collect(function (err, ary) {
    console.log(ary)
  })
)
```

## Concepts

Building upon secure-scuttlebutt requires understanding a few concepts
that it uses to ensure security.

### Identity

Each node's identity is represented by the hash of their public
key. Although they are not "human readable", this does
guarantee that you get unique identifiers (without a central registry)
and it's infeasible for anyone to forge your identity.

### Secure Data Structures

SecureScuttlebutt uses a signed block-chain per identity.
Each block points to the previous block,
the signing key, and contains a short message
and a signature. Every identity has their own block-chain.

Each block-chain is an append-only data structure that
can be written to exclusively by the keys' owner.
Since the chains are append only, replication is simple,
request the chain for that id, since the latest item you know about.

### Replication

replication has been moved into the networking layer:
[scuttlebot](https://github.com/ssbc/scuttlebot)

### References

There are 3 types of objects - messages, feeds, and attachments.
messages and attachments are refered to by their hashes,
but feeds (block-chains) are refered to by their
signing public key. Thus, chains can both refer to other chains,
and also to particular points _within_ other chains.

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

### SecureScuttlebutt#createFeed (keys?)

Create a Feed object. A feed is a chain of messages signed
by a single key (the identity of the feed).
This handles the state needed to append valid messages to a feed.
If keys are not provided, then a new key pair will be generated.

The following methods apply to the Feed type.

#### Feed#add (message, cb)

Adds a message of a given type to a feed.
This is the recommended way to append messages.
message is a javascript object. it must be a `{}` object with a `type`
property that is a string between 3 and 32 chars long.

#### Feed#id

the id of the feed (which is the hash of the feeds public key)

#### Feed#keys

the key pair for this feed.

### SecureScuttlebutt#getPublicKey(id, cb)

Retrieve the public key for `id`, if it is in the database.
If you have replicated id's data then you will have the public key,
as public keys are contained in the first message.

### SecureScuttlebutt#needsRebuild(cb)

Checks the version stored in the database against the code version and
calls back true/false accordingly. This keeps the database in sync with
major breaking changes to secure-scuttlebutt when they occur.

Should be run at startup. If true, you should call `rebuildIndex` before
using the database.

```js
ssb.needsRebuild(function (err, b) {
  if (b)
    ssb.rebuildIndex(next)
})
```

### SecureScuttlebutt#rebuildIndex(cb)

Rebuilds the indexes by replaying history. See `needsRebuild`.

### SecureScuttlebutt#createFeedStream (opts) -> PullSource

Create a [pull-stream](https://github.com/dominictarr/pull-stream)
of the data in the database, ordered by timestamps.
All [pull-level](https://github.com/dominictarr/pull-level) options
are allowed (start, end, reverse, tail)

### SecureScuttlebutt#createLogStream({gt: ts, tail: boolean}) -> PullSource

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

### SecureScuttlebutt#createHistoryStream ({id: hash, seq: int?, live: bool?}) -> PullSource

Create a stream of the history of `id`. If `seq > 0`, then
only stream messages with sequence numbers greater than `seq`.
if `live` is true, the stream will be a
[live mode](https://github.com/dominictarr/pull-level#example---reading)

### SecureScuttlebutt#messagesByType ({type: string, live: bool?}) -> PullSource

retrive messages with a given type. All messages must have a type,
so this is a good way to select messages that an application might use.
Returns a source pull-stream. This function takes all the options from [pull-level#read](https://github.com/dominictarr/pull-level#example---reading)
(gt, lt, gte, lte, limit, reverse, live)


### SecureScuttlebutt#links ({source: hash?, dest: hash?, rel: string?, meta: true?, keys: true?, values: false?, live:false?, reverse: false?}) -> PullSource

Get a stream of messages, feeds, or blobs that are linked to/from an id.

The objects in this stream will be of the form:

```
{ source: ID, rel: String, dest: ID, key: MsgID, value: Object }
```

 - `source` (string, optional): An id or filter, specifying where the link should originate from. To filter, just use the sigil of the type you want: `@` for feeds, `%` for messages, and `&` for blobs.
 - `dest` (string, optional): An id or filter, specifying where the link should point to. To filter, just use the sigil of the type you want: `@` for feeds, `%` for messages, and `&` for blobs.
 - `rel` (string, optional): Filters the links by the relation string.


### SecureScuttlebutt#relatedMessages ({id: hash, rel: string?, count: false?, parent: false?}, cb)

Retrieve the tree of messages related to `id`.
This is ideal for collecting things like threaded replies.
If `rel` is provided, only messages that link to the message with the given type are included.
The output is a recursive structure like this:

``` js
{
  key: <id>,
  value: <msg>,
  related: [
    <recursive>,...
  ],
  //number of messages below this point. (when opts.count = true)
  count: <int>,
  //the message this message links to. this will not appear on the bottom level.
  //(when opts.parent = true)
  parent: <parent_id>
}
```

If `count` option is true, then each message will contain a `count`
it's decendant messages. If `parent` is true then each level will have 
`parent`, the `id/key` of it's parent message.

## License

MIT
