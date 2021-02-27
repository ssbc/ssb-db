# ssb-db

[secret-stack](https://github.com/ssbc/secret-stack) plugin which provides storing of valid secure-scuttlebutt
messages in an append-only log.

## Table of contents

[What does it do?](#what-does-it-do) | 
[Example](#example) | 
[Concepts](#concepts) | 
[API](#api) | 
[Stability](#stability) | 
[License](#License) | 

# What does it do?

`ssb-db` provides tools for dealing with unforgeable append-only message feeds. You can create a feed, post 
messages to that feed, verify a feed created by someone else, stream messages to and from feeds, and more 
(see [API](#api)).

*Unforgeable* means that only the owner of a feed can modify that feed, as enforced by digital signing 
(see [Security properties](#security-properties)).

This property makes `ssb-db` useful for peer-to-peer applications. `ssb-db` also makes it easy to encrypt 
messages.

# Example

In this example, we create a feed, post a signed message to it, then create a stream that reads from the feed. **Note:** `ssb-server` includes the `ssb-db` dependency already, so the example here uses this as a plugin for `secret-stack`.

``` js
/**
 * create an ssb-db instance and add a message to it.
 */
var pull = require('pull-stream')

//create a secret-stack instance and add ssb-db, for persistence.
var createApp = require('secret-stack')({})
  .use(require('ssb-db'))


// create the db instance.
// Only one instance may be created at a time due to os locks on port and database files.

var app = createApp(require('ssb-config'))

//your public key, the default key of this instance.

app.id

//or, called remotely

app.whoami(function (err, data) {
  console.log(data.id) //your id
})

// publish a message to default identity
//  - feed.add appends a message to your key's chain.
//  - the `type` attribute is required.

app.publish({ type: 'post', text: 'My First Post!' }, function (err, msg) {
  // the message as it appears in the database:
  console.log(msg)

  // and its hash:
  console.log(msg.key)
})

// collect all the messages into an array, calls back, and then ends
// https://github.com/pull-stream/pull-stream/blob/master/docs/sinks/collect.md
pull(
  app.createLogStream(),
  pull.collect(function (err, messagesArray) {
    console.log(messagesArray)
  })
)

// collect all messages for a particular keypair into an array, calls back, and then ends
// https://github.com/pull-stream/pull-stream/blob/master/docs/sinks/collect.md
pull(
  app.createHistoryStream({id: app.id}),
  pull.collect(function (err, messagesArray) {
    console.log(messagesArray)
  })
)
```

# Concepts

Building upon `ssb-db` requires understanding a few concepts that it uses to ensure the unforgeability of 
message feeds.

## Identities

An identity is simply a public/private key pair.

Even though there is no worldwide store of identities, it's infeasible for anyone to forge your identity. 
Identities are binary strings, so not particularly human-readable.

## Feeds

A feed is an append-only sequence of messages. Each feed is associated 1:1 with an identity. The feed is 
identified by its public key. This works because public keys are unique.

Since feeds are append-only, replication is simple:  request all messages in the feed that are newer than 
the latest message you know about.

Note that append-only really means append-only: you cannot delete an existing message. If you want to enable 
entities to be deleted or modified in your data model, that can be implemented in a layer on top of `ssb-db` 
using [delta encoding](https://en.wikipedia.org/wiki/Delta_encoding).

## Messages

Each message contains:

- A message object. This is the thing that the end user cares about. If there is no encryption, this is a `{}` 
object. If there is encryption, this is an encrypted string.
- A content-hash of the previous message. This prevents somebody with the private key from changing the feed 
history after publishing, as a newly-created message wouldn't match the "prev-hash" of later messages which 
were already replicated.
- The signing public key.
- A signature. This prevents malicious parties from writing fake messages to a stream.
- A sequence number. This prevents a malicious party from making a copy of the feed that omits or reorders 
messages.
  
Since each message contains a reference to the previous message, a feed must be replicated in order, starting 
with the first message. This is the only way that the feed can be verified. A feed can be *viewed* in any order 
after it's been replicated.

## Object ids

The text inside a message can refer to three types of ssb-db entities: messages, feeds, and blobs (i.e. 
attachments). Messages and blobs are referred to by their hashes, but a feed is referred to by its signing 
public key. Thus, a message within a feed can refer to another feed, or to a particular point _within_ a feed.

Object ids begin with a sigil `@` `%` and `&` for a `feedId`, `msgId` and `blobId` respectively.

Note that `ssb-db` does not include facilities for retrieving a blob given the hash.

## Replication

It is possible to easily replicate data between two instances of `ssb-db`.
First, they exchange maps of their newest data. Then, each one downloads all data newer than its newest data.

[ssb-server](https://github.com/ssbc/ssb-server) is a tool that makes it easy to replicate multiple instances 
of ssb-db using a decentralized network.

## Security properties

`ssb-db` maintains useful security properties even when it is connected to a malicious ssb-db database. This 
makes it ideal as a store for peer-to-peer applications.

Imagine that we want to read from a feed for which we know the identity, but we're connected to a malicious 
ssb-db instance. As long as the malicious database does not have the private key:

- The malicious database cannot create a new feed with the same identifier
- The malicious database cannot write new fake messages to the feed
- The malicious database cannot reorder the messages in the feed
- The malicious database cannot send us a new copy of the feed that omits messages from the middle
- The malicious database *can* refuse to send us the feed, or only send
  us the first *N* messages in the feed
- Messages may optionally be encrypted. See `test/end-to-end.js`.


## API
## require('ssb-db')
```js 
SecretStack.use(require('ssb-db')) => SecretStackApp
```

The design pattern of __ssb-db__ is for it to act as a plugin within the 
[SecretStack](https://github.com/ssbc/secret-stack) plugin framework. The main export provides the plugin, 
which extends the SecretStack app with this plugins functionality, and API.
`ssb-db` adds persistence to a [SecretStack](https://github.com/ssbc/secret-stack) setup.
Without other plugins, this instance will not have replication or querying. Loading `ssb-db` directly is 
useful for testing, but it's recommended to instead start from a plugin bundle like 
[ssb-server](https://github.com/ssbc/ssb-server)

> Because of legacy reasons, all the `ssb-db` methods are mounted on the top level object, so it's `app.get` 
instead of `app.db.get` as it would be with all the other `ssb-*` plugins.

> In the API docs below, we'll just call it `db`

## db.get: async
```js
db.get(id | seq | opts, cb) // cb(error, message)
```

Get a message by its hash-id.

* If `id` is a message id, the message is returned.
* If `seq` is provided, the message at that offset in the underlying flumelog is returned. 
* If `opts` is passed, the message id is taken from either `opts.id` or `opts.key`.
* If `opts.private = true` the message will be decrypted if possible.
* If `opts.meta = true` is set, or `seq` is used, the message will be in `{key, value: msg, timestamp}` format. 
Otherwise the raw message (without key and timestamp) are returned. This is for backwards compatibility reasons.

Given that most other apis (such as createLogStream) by default return `{key, value, timestamp}` it's 
recommended to use `db.get({id: key, meta: true}, cb)`

Note that the `cb` callback is called with 3 arguments: `cb(err, msg, offset)`, where
the 3rd argument is the `offset` position of that message in the log (flumelog-offset).

## db.add: async
```js
db.add(msg, cb) // cb(error, data)
```

Append a raw message to the local log. `msg` must be a valid, signed message. 
[ssb-validate](https://github.com/ssbc/ssb-validate) is used internally to validate messages.

## db.publish: async
```js
db.publish(content, cb) // cb(error, data)
```
Create a valid message with `content` with the default identity and append it to the local log. 
[ssb-validate](https://github.com/ssbc/ssb-validate) is used to construct a valid message.

This is the recommended method for publishing new messages, as it handles the tasks of correctly setting 
the message's timestamp, sequence number, previous-hash, and signature.

 - `content` (object): The content of the message.
   - `.type` (string): The object's type.


## db.del: async 

> ⚠ This could break your feed. Please don't run this unless you understand it.

Delete a message by its message key or a whole feed by its key. This only deletes the message from your local 
database, not the network, and could have unintended consequences if you try to delete a single message in 
the middle of a feed.

The intended use-case is to delete all messages from a given feed *or* deleting a single message from the tip 
of your feed if you're completely confident that the message hasn't left your device.

```js
//Delete message
db.del(msg.key, (err, key) => {
  if (err) throw err
})
```

```js
//Delete all author messages
db.del(msg.value.author, (err, key) => {
  if (err) throw err
})
```

## db.whoami: async
```js
db.whoami(cb) // cb(error, {"id": FeedID })
```
Get information about the current ssb-server user.

## db.createLogStream: source
```js
db.createLogStream({ live, old, gt, gte, lt, lte, reverse, keys, values, limit, fillCache, keyEncoding, 
valueEncoding, raw }): PullSource
```
Create a stream of the messages that have been written to this instance in the order they arrived. This is 
mainly intended for building views.

  - `live` *(boolean)* Keep the stream open and emit new messages as they are received. Defaults to `false`.
 - `old` *(boolean)* If `false` the output will not include the old data. *If live and old are both false, 
 an error is thrown.* Defaults to `true`.
 - `gt` (greater than), `gte` (greater than or equal) *(timestamp)*  Define the lower bound of the range to 
 be streamed. Only records where the key is greater than (or equal to) this option will be included in the 
 range. When `reverse=true` the order will be reversed, but the records streamed will be the same.
 - `lt` (less than), `lte` (less than or equal) *(timestamp)* Define the higher bound of the range to be 
 streamed. Only key/value pairs where the key is less than (or equal to) this option will be included in 
 the range. When `reverse=true` the order will be reversed, but the records streamed will be the same.
 - `reverse` *(boolean)* Set true and the stream output will be reversed. Beware that due to the way LevelDB 
 works, a reverse seek will be slower than a forward seek. Defaults to `false`.
 - `keys` *(boolean)* Whether the `data` event should contain keys. If set to `true` and `values` set to 
 `false` then `data` events will simply be keys, rather than objects with a `key` property. Defaults to `true`.
 - `values` *(boolean)* Whether the `data` event should contain values. If set to `true` and `keys` set to 
 `false` then `data` events will simply be values, rather than objects with a `value` property. Defaults to `true`.
 - `limit` *(number)* Limit the number of results collected by this stream. This number represents a *maximum* 
 number of results and may not be reached if you get to the end of the data first. A value of `-1` means there 
 is no limit. When `reverse=true` the highest keys will be returned instead of the lowest keys. 
 Defaults to `false`.
 - `keyEncoding` / `valueEncoding` *(string)* The encoding applied to each read piece of data.
 - `raw` *(boolean)* Provides access to the raw [flumedb](https://github.com/flumedb/flumedb) log. 
 Defaults to `false`.


The objects in this stream will be of the form:

```json
{
  "key": Hash,
  "value": Message,
  "timestamp": timestamp
}
```

* `timestamp` * is the time which the message was received.
It is generated by [monotonic-timestamp](https://github.com/dominictarr/monotonic-timestamp). The range 
queries (gt, gte, lt, lte) filter against this receive timestap.

If `raw` option is provided, then instead createRawLogStream is called, messages are returned in the form:

```json
{
  "seq": offset,
  "value": {
    "key": Hash,
    "value": Message,
    "timestamp": timestamp
  }
}
```
All options supported by [flumelog-offset](https://github.com/flumedb/flumelog-offset) are supported.

## db.createHistoryStream: source
```js
db.createHistoryStream(id, seq, live) -> PullSource
//or
db.createHistoryStream({ id, seq, live, limit, keys, values, reverse }) -> PullSource

```

Create a stream of the history of `id`. If `seq > 0`, then only stream messages with sequence numbers greater 
than `seq`. If `live` is true, the stream will be a 
[live mode](https://github.com/dominictarr/pull-level#example---reading)

`createHistoryStream` and `createUserStream` serve the same purpose.

`createHistoryStream` exists as a separate call because it provides fewer range parameters, which makes it 
safer for RPC between untrusted peers.

> Note: since `createHistoryStream` is provided over the network to anonymous peers, not all options are 
supported. `createHistoryStream` does not decrypt private messages.

- `id` *(FeedID)* The id of the feed to fetch.
- `seq` *(number)* If `seq > 0`, then only stream messages with sequence numbers greater than or equal to `seq`. 
Defaults to `0`.
- `live` *(boolean)*: Keep the stream open and emit new messages as they are received. Defaults to `false`
- `keys` *(boolean)*: Whether the `data` event should contain keys. If set to `true` and `values` set to 
`false` then `data` events will simply be keys, rather than objects with a `key` property. Defaults to `true`
- `values` *(boolean)* Whether the `data` event should contain values. If set to `true` and `keys` set to 
`false` then `data` events will simply be values, rather than objects with a `value` property. Defaults to `true`.
- `limit` *(number)* Limit the number of results collected by this stream. This number represents a *maximum* 
number of results and may not be reached if you get to the end of the data first. A value of `-1` means there 
is no limit. When `reverse=true` the highest keys will be returned instead of the lowest keys. Defaults to `false`.
- `reverse` *(boolean)* Set true and the stream output will be reversed. Beware that due to the way LevelDB 
works, a reverse seek will be slower than a forward seek. Defaults to `false`.

## db.messagesByType: source
```js
db.messagesByType({type: string, live,old,reverse: bool?, gt,gte,lt,lte: timestamp, limit: number }) -> PullSource
```

Retrieve messages with a given type, ordered by receive-time. All messages must have a type, so this is a good way 
to select messages that an application might use. This function returns a source pull-stream.

As with `createLogStream` messagesByType takes all the options from 
[pull-level#read](https://github.com/dominictarr/pull-level#example---reading) (gt, lt, gte, lte, limit, reverse, 
live, old)

## db.createFeedStream: source
```js
db.createFeedStream({ live, old, gt, gte, lt, lte, reverse, keys, value,, limit, fillCache, keyEncoding, 
valueEncoding, raw }))
```
Like `createLogStream`, but messages are in order of the claimed time, instead of the received time.

This may sound like a much better idea, but has surprising effects with live messages (you may receive a old 
message in real time) but for old messages, it makes sense.

The range queries (gt, gte, lt, lte) filter against this claimed timestap.

As with `createLogStream` createFeedStream takes all the options from 
[pull-level#read](https://github.com/dominictarr/pull-level#example---reading) (gt, lt, gte, lte, limit, reverse, 
live, old)


## db.createUserStream: source
```js
db.createUserStream({id: feed_id, lt, lte ,gt ,gte: sequence, reverse, old, live, raw: boolean, limit: number, private: boolean})
```

`createUserStream` is like `createHistoryStream`, except all options are
supported. Local access is allowed, but not remote anonymous access.
`createUserStream` can decrypt private messages if you pass the option
`{ private: true }`.

## db.links: source
```js
db.links({ source, dest: feedId|msgId|blobId, rel, meta, keys, values, live, reverse }) -> PullSource
```

Get a stream of links from a feed to a blob/msg/feed id. The objects in this stream will be of the form:

```json
{ 
  "source": FeedId,
  "rel": String,
  "dest": Id,
  "key": MsgId,
  "value": Object?
}
```

 - `source` *(string)* An id or filter, specifying where the link should originate from. To filter, just use 
 the sigil of the type you want: `@` for feeds, `%` for messages, and `&` for blobs. Optional.
 - `dest` *(string)* An id or filter, specifying where the link should point to. To filter, just use the sigil 
 of the type you want: `@` for feeds, `%` for messages, and `&` for blobs. Optional.
 - `rel` *(string)* Filters the links by the relation string. Optional.
  - `live` *(boolean)*: Keep the stream open and emit new messages as they are received. Defaults to `false.
 - `values` *(boolean)* Whether the `data` event should contain values. If set to `true` and `keys` set to 
 `false` then `data` events will simply be values, rather than objects with a `value` property. 
 Defaults to `false`.
 - `keys` *(boolean)* Whether the `data` event should contain keys. If set to `true` and `values` set to 
 `false` then `data` events will simply be keys, rather than objects with a `key` property. Defaults to `true`.
 - `reverse` *(boolean)*: Set true and the stream output will be reversed. Beware that due to the way LevelDB 
 works, a reverse seek will be slower than a forward seek. Defaults to `false`.
 - `meta` If is unset `source, hash, rel` will be left off. Defaults to `true`.

> Note: if `source`, and `dest` is provided, but not `rel`, ssb will have to scan all the links from source, 
and then filter by dest. Your query will be more efficient if you also provide `rel`.

## db.addMap: sync
```js
db.addMap(fn)
```

Add a map function to be applied to all messages on *read*. The `fn` function is should expect `(msg, cb)`, 
and must eventually call `cb(err, msg)` to finish.

These modifications only change the value being read, but the underlying data is never modified. If multiple 
map functions are added, they are called serially and the `msg` output by one map function is passed as the 
input `msg` to the next.

Additional properties may only be added to `msg.value.meta`, and modifications may only be made *after* the 
original value is saved in `msg.value.meta.original`.

```js
db.addMap(function (msg, cb) {
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

db.addMap(function (msg, cb) {
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

## db._flumeUse: view
```js
db._flumeUse(name, flumeview) => View
```

Add a [flumeview](https://github.com/flumedb/flumedb#views) to the current instance.
This method was intended to be a temporary solution, but is now used by many plugins, which is why it starts 
with `_`.

See [creating a secret-stack plugin](https://github.com/ssbc/secret-stack/blob/master/PLUGINS.md) for more 
details.

## db.getAtSequence: async
```js
db.getAtSequence([id, seq], cb) //cb(err, msg)
```

Get a message for a given feed `id` with given `sequence`. Calls back a message or an error, takes a two 
element array with a feed `id` as the first element, and `sequence` as second element.

Needed for [ssb-ebt replication](https://github.com/ssbc/ssb-ebt)

## db.getVectorClock: async
```js
db.getVectorClock(cb) //cb(error, clock)
```

Load a map of `id` to latest `sequence` (`{<id>: <seq>,...}`) for every feed in the database.

Needed for [ssb-ebt replication](https://github.com/ssbc/ssb-ebt)

## db.progress: sync
```js
db.progress()
```

Return the current status of various parts of the scuttlebut system that indicate progress. This api is 
hooked by a number of plugins, but `ssb-db` adds an `indexes` section (which represents how fully built the 
indexes are).

The output might look like:
```json
{
  "indexes": {
    "start": 607551054,
    "current": 607551054,
    "target": 607551054
  }
}
```

Progress is represented linearly from `start` to `target`. Once `current` is equal to `target` the progress 
is complete. `start` shows how far it's come. The numbers could be anything, but `start <= current <= target` 
if all three numbers are equal that should be considered 100%


## db.status: sync
```js
db.status()
```

Returns metadata about the status of various ssb plugins. ssb-db adds an `sync` section, that shows where each 
index is up to. 
The purpose is to provide an overview of how ssb is working.

Output might took like this:

```json
{
  "sync": {
    "since": 607560288,
    "plugins": {
      "last": 607560288,
      "keys": 607560288,
      "clock": 607560288,
      "time": 607560288,
      "feed": 607560288,
      "contacts2": 607560288,
      "query": 607560288,
      ...
    },
    "sync": true
  }
}
```

`sync.since` is where the main log is up to, and `since.plugins.<name>` is where each plugin's indexes are up to.

## db.version: sync
```js
db.version()
```

Return the version of `ssb-db`. currently, this returns only the ssb-db version and not the ssb-server version, 
or the version of any other plugins. [We should fix this soon](https://github.com/ssbc/ssb-server/issues/648)

## db.queue: async 
```js
db.queue(msg, cb) //cb(error, msg)
```

Add a message to be validated and written, but don't worry about actually writing it. The callback is called 
when the database is ready for more writes to be queued. Usually that means it's called back immediately. 
__This method is not exposed over RPC.__

## db.flush: async 

```js
db.flush(cb) //cb()
```

Callback when all queued writes are actually definitely written to the disk.

## db.getFeedState: async

```js
db.getFeedState(feedId, (err, state))
```

Calls back with state, `{ id, sequence }` - the most recent message ID and sequence number according to SSB-Validate: 

NOTE
- **this may contain messages that have been queued and not yet persisted to the database**
    - this is required for e.g. boxers which depend on knowing previous message state
- this is the current locally known state of the feed, it is possible if it's a foreign feed
that the state has progressed beyond whay you know but you haven't got a copy yet, so use this carefully.
- "no known state" is represented by `{ id: null, sequence: 0 }`

## db.post: Observable

```js
db.post(fn({key, value: msg, timestamp})) => Ovb
```

[Observable](https://github.com/dominictarr/obv) that calls `fn` whenever a message is appended (with that 
message). __This method is not exposed over RPC.__


## db.since: Observable
```js
db.since(fn(seq)) => Obv
```

An [observable](https://github.com/dominictarr/obv) of the current log sequence. This is always a positive 
integer that usually increases, except in the exceptional circumstance that the log is deleted or corrupted.

### db.addBoxer: sync

```js
db.addBoxer({ value: boxer, init: initUnboxer })
```

Add a `boxer`, which will be added to the list of boxers which will try to
automatically box (encrypt) the message `content` if the appropriate
`content.recps` is provided.

Where:
- `boxer (msg.value.content, feedState) => ciphertext` which is expected to either:
    - successfully box the content (based on `content.recps`), returning a `ciphertext` String
    - not know how to box this content (because recps are outside it's understanding), and `undefined` (or `null`)
    - break (because it should know how to handle `recps`, but can't), and so throw an `Error`
    - The `feedState` object contains `id` and `sequence` properties that
      describe the most recent message ID and sequence number for the feed.
      This is the same data exposed by `db.getFeedState()`.
- `initUnboxer (done) => null` (optional)
    - is a functional which allows you set up your unboxer
    - you're expected to call `done()` once all your initialisation is complete

## db.addUnboxer: sync

```js
db.addUnboxer({ key: unboxKey, value: unboxValue, init: initBoxer })
```

Add an unboxer object, any encrypted message is passed to the unboxer object to
test if it can be unboxed (decrypted)

Where:
- `unboxKey(msg.value.content, msg.value) => readKey`
    - Is a function which tries to extract the message key from the encrypted content (`ciphertext`).
    - Is expected to return `readKey` which is the read capability for the message
- `unboxValue(msg.value.content, msg.value, readKey) => plainContent`
    - Is a function which takes a `readKey` and uses it to try to extract the `plainContent` from the `ciphertext
- `initBoxer (done) => null` (optional)
    - is a functional which allows you set up your boxer
    - you're expected to call `done()` once all your initialisation is complete

## db.box(content, recps, cb)

attempt to encrypt some `content` to `recps` (an Array of keys/ identifiers).
callback has signature `cb(err, ciphertext)`

## db.unbox: sync
```js
db.unbox(data, key)
```
Attempt to decrypt data using key. Key is a symmetric key, that is passed to the unboxer objects.

## db.Deprecated apis

## db.getLatest: async
```js
db.getLatest(feed, cb) //cb(err, {key, value: msg})
```

Get the latest message for the given feed, with `{key, value: msg}` style. Maybe used by some front ends, and 
by ssb-feed.

## db.latestSequene: async
```js
db.latestSequence(feed, cb) //cb(err, sequence)
```

Call back the sequence number of the latest message for the given feed.

## db.latest: source
```js
db.latest() => PullSource
```

Returns a stream of `{author, sequence, ts}` tuples. `ts` is the time claimed by the author, not the received 
time.

## db.createWriteStream: source
```js
db.createWriteStream() => PullSink`
```
Create a pull-stream sink that expects a stream of messages and calls `db.add` on each item, appending every 
valid message to the log.

## db.createFeed: sync
```js
db.createFeed(keys?)
```

## db.createSequenceStream() => PullSource

Create a pull-stream source that provides the latest sequence number from the
database. Each time a message is appended the sequence number should increase
and a new event should be sent through the stream.

Note: In the future this stream may be debounced. The number of events passed
through this stream may be less than the number of messages appended.

## db.createFeed(keys?) => Feed (deprecated)
__Use [ssb-identities](http://github.com/ssbc/ssb-identities) instead.__

Create and return a Feed object. A feed is a chain of messages signed by a single key (the identity of the feed).

This handles the state needed to append valid messages to a feed. If keys are not provided, then a new key pair 
will be generated.

May only be called locally, not from a [ssb-client](https://github.com/ssbc/ssb-client) connection.

The following methods apply to the Feed type.

### Feed#add(message, cb)

Adds a message of a given type to a feed. This is the recommended way to append messages. 

`message` is a javascript object. It must be a `{}` object with a `type` property that is a string between 3 
and 32 chars long.

If `message` has `recps` property which is an array of feed ids, then the message content will be encrypted 
using [private-box](https://github.com/auditdrivencrypto/private-box) to those recipients. Any invalid 
recipients will cause an error, instead of accidentially posting a message publically or without a recipient.

### Feed#id

The id of the feed (which is the feed's public key)

### Feed#keys

The key pair for this feed.

## Stability

__Stable__ Expect patches, possible features additions.


## License

MIT
