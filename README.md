# ssb-db

[secret-stack](https://github.com/ssbc/secret-stack) plugin which provides storing of valid secure-scuttlebutt messages in an append-only log.

## What does it do?

`ssb-db` provides tools for dealing with unforgeable append-only message feeds. You can create a feed, post messages to that feed, verify a feed created by someone else, stream messages to and from feeds, and more (see [API](#api)).

*Unforgeable* means that only the owner of a feed can modify that feed, as enforced by digital signing (see [Security properties](#security-properties)).

This property makes `ssb-db` useful for peer-to-peer applications. `ssb-db` also makes it easy to encrypt messages.

## Example

In this example, we create a feed, post a signed message to it, then create a stream that reads from the feed.

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

// stream all messages for all keypairs.
pull(
  app.createLogStream(),
  pull.collect(function (err, ary) {
    console.log(ary)
  })
)

// stream all messages for a particular keypair.
pull(
  app.createHistoryStream({id: app.id}),
  pull.collect(function (err, ary) {
    console.log(ary)
  })
)
```

## Concepts

Building upon `ssb-db` requires understanding a few concepts that it uses to ensure the unforgeability of message feeds.

### Identities

An identity is simply a public/private key pair.

Even though there is no worldwide store of identities, it's infeasible for anyone to forge your identity. Identities are binary strings, so not particularly human-readable.

### Feeds

A feed is an append-only sequence of messages. Each feed is associated 1:1 with an identity. The feed is identified by its public key. This works because public keys are unique.

Since feeds are append-only, replication is simple:  request all messages in the feed that are newer than the latest message you know about.

Note that append-only really means append-only: you cannot delete an existing message. If you want to enable entities to be deleted or modified in your data model, that can be implemented in a layer on top of `ssb-db` using [delta encoding](https://en.wikipedia.org/wiki/Delta_encoding).

### Messages

Each message contains:

- A message object. This is the thing that the end user cares about. If there is no encryption, this is a `{}` object. If there is encryption, this is an encrypted string.
- A content-hash of the previous message. This prevents somebody with the private key from changing the feed history after publishing, as a newly-created message wouldn't match the "prev-hash" of later messages which were already replicated.
- The signing public key.
- A signature. This prevents malicious parties from writing fake messages to a stream.
- A sequence number. This prevents a malicious party from making a copy of the feed that omits or reorders messages.
  
Since each message contains a reference to the previous message, a feed must be replicated in order, starting with the first message. This is the only way that the feed can be verified. A feed can be *viewed* in any order after it's been replicated.

### Object ids

The text inside a message can refer to three types of ssb-db entities: messages, feeds, and blobs (i.e. attachments). Messages and blobs are referred to by their hashes, but a feed is referred to by its signing public key. Thus, a message within a feed can refer to another feed, or to a particular point _within_ a feed.

Object ids begin with a sigil `@` `%` and `&` for a `feedId`, `msgId` and `blobId` respectively.

Note that `ssb-db` does not include facilities for retrieving a blob given the hash.

### Replication

It is possible to easily replicate data between two instances of `ssb-db`.

First, they exchange maps of their newest data. Then, each one downloads all data newer than its newest data.

[ssb-server](https://github.com/ssbc/ssb-server) is a tool that makes it easy to replicate multiple instances of ssb-db using a decentralized network.

### Security properties

`ssb-db` maintains useful security properties even when it is connected to a malicious ssb-db database. This makes it ideal as a store for peer-to-peer applications.

Imagine that we want to read from a feed for which we know the identity, but we're connected to a malicious ssb-db instance. As long as the malicious database does not have the private key:

- The malicious database cannot create a new feed with the same identifier
- The malicious database cannot write new fake messages to the feed
- The malicious database cannot reorder the messages in the feed
- The malicious database cannot send us a new copy of the feed that omits messages from the middle
- The malicious database *can* refuse to send us the feed, or only send
  us the first *N* messages in the feed
- Messages may optionally be encrypted. See `test/end-to-end.js`.


## API

### `SecretStack.use(require('ssb-db')) => SecretStackApp`

Adds `ssb-db` persistence to a [secret-stack](https://github.com/ssbc/secret-stack) setup.
Without other plugins, this instance will not have replication or querying. Loading `ssb-db` directly is useful for testing, but it's recommended to instead start from a plugin bundle like [ssb-server](https://github.com/ssbc/ssb-server)

> Because of legacy reasons, all the `ssb-db` methods are mounted on the top level object, so it's `app.get` instead of `app.db.get` as it would be with all the other `ssb-*` plugins.

> In the API docs below, we'll just call it `db`

### `db.get(id | seq | opts, cb)`

Get an ssb message. 

* If `id` is a message id, the message is returned.
* If `seq` is provided, the message at that offset in the underlying flumelog is returned. 
* If `opts` is passed, the message id is taken from either `opts.id` or `opts.key`.
* If `opts.private = true` the message will be decrypted if possible.
* If `opts.meta = true` is set, or `seq` is used, the message will be in `{key, value: msg, timestamp}` format. Otherwise the raw message (without key and timestamp) are returned. This is for backwards compatibility reasons.

Given that most other apis (such as createLogStream) by default return `{key, value, timestamp}` it's recommended to use `db.get({id: key, meta: true}, cb)`

### `db.add(msg, cb)`

Append a raw message to the local log. `msg` must be a valid, signed message. [ssb-validate](https://github.com/ssbc/ssb-validate) is used internally to validate messages.

### `db.publish(content, cb)`
Create a valid message with `content` with the default identity and append it to the local log. [ssb-validate](https://github.com/ssbc/ssb-validate) is used to construct a valid message.

### `db.whoami(cb)`

Call back with the default identity for the `db`.

### `db.createLogStream({lt,lte,gt,gte: timestamp, reverse,old,live,raw: boolean, limit: number}) => PullSource`

Create a stream of the messages that have been written to this instance in the order they arrived. This is mainly intended for building views.
The objects in this stream will be of the form:

``` js
{
  key: Hash, value: Message, timestamp: timestamp
}
```

* `timestamp` is generated by [monotonic-timestamp](https://github.com/dominictarr/monotonic-timestamp) when saving the message.
* `gt, gte, lt, lte` ranges are supported, via [ltgt](https://github.com/dominictarr/ltgt).
* If `reverse` is set to true, results will be from oldest to newest.
* If `limit` is provided, the stream will stop after that many items.
* `old` and `live` return wether to include `old` and `live` (newly written messages) as via [pull-live](https://github.com/pull-stream/pull-live)

If `raw` option is provided, then instead createRawLogStream is called:

```js
 db.createRawLogStream(lt,lte,gt,gte: offset, reverse,old,live: boolean, limit: number})
 ```

Provides access to the raw [flumedb](https://github.com/flumedb/flumedb) log. Ranges refer to offsets in the log file. Messages are returned in the form:

```
{
  seq: offset,
  value: {key: Hash, value: Message, timestamp: timestamp}
}
```
All options supported by [flumelog-offset](https://github.com/flumedb/flumelog-offset) are supported.

### `db.createHistoryStream({id: feedId, seq: int?, live: bool?, limit: int?, keys: bool?, values: bool?}) -> PullSource`

Create a stream of the history of `id`. If `seq > 0`, then only stream messages with sequence numbers greater than `seq`. If `live` is true, the stream will be a [live mode](https://github.com/dominictarr/pull-level#example---reading)

> Note: since `createHistoryStream` is provided over the network to anonymous peers, not all options are supported. `createHistoryStream` does not decrypt private messages.

### `db.messagesByType({type: string, live,old,reverse: bool?, gt,gte,lt,lte: timestamp, limit: number }) -> PullSource`

Retrieve messages with a given type. All messages must have a type, so this is a good way to select messages that an application might use. This function returns a source pull-stream.

As with `createLogStream` messagesByType takes all the options from [pull-level#read](https://github.com/dominictarr/pull-level#example---reading) (gt, lt, gte, lte, limit, reverse, live, old)

Ranges may be a timestamp, of the local received time.

### `db.createFeedStream(lt,lte,gt,gte: timestamp, reverse,old,live,raw: boolean, limit: number})`

Like `createLogStream`, but messages are in order of the claimed time, instead of the received time.
This may sound like a much better idea, but has surprising effects with live messages (you may receive a old message in real time) but for old messages, it makes sense.

All standard options are supported.

### `db.createUserStream({id: feed_id, lt,lte,gt,gte: sequence, reverse,old,live,raw: boolean, limit: number})`

`createUserStream` is like `createHistoryStream`, except all options are supported. Local access is allowed, but not remote anonymous access. `createUserStream` does decrypt private messages.

### `db.links({source: feedId?, dest: feedId|msgId|blobId?, rel: string?, meta: true?, keys: true?, values: false?, live:false?, reverse: false?}) -> PullSource`

Get a stream of links from a feed to a blob/msg/feed id.

The objects in this stream will be of the form:

```
{ source: feedId, rel: String, dest: Id, key: MsgId, value: Object? }
```

 - `source` *(string, optional)* Feed id.
 - `dest` *(string, optional)* An id or filter, specifying where the link should point to. To filter, just use the sigil of the type you want: `@` for feeds, `%` for messages, and `&` for blobs.
 - `rel` *(string, optional)* Filters the links by the relation string.
 - `opts.values` *(boolean)* If is set `value` will be the message the link occurs in. Defautlts to false
 - `opts.keys` *(boolean)* If is set `key` will be the message id. Defaults to true.
 - `opts.meta` If is unset `source, hash, rel` will be left off. Defaults to true.

> Note: if `source`, and `dest` is provided, but not `rel`, ssb will have to scan all the links from source, and then filter by dest. Your query will be more efficient if you also provide `rel`.

### `db.addMap(fn)`

Add a map function to be applied to all messages on *read*. The `fn` function is should expect `(msg, cb)`, and must eventually call `cb(err, msg)` to finish.

These modifications only change the value being read, but the underlying data is never modified. If multiple map functions are added, they are called serially and the `msg` output by one map function is passed as the input `msg` to the next.

Additional properties may only be added to `msg.value.meta`, and modifications may only be made *after* the original value is saved in `msg.value.meta.original`.

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

### `db._flumeUse(name, flumeview) => View`

Add a [flumeview](https://github.com/flumedb/flumedb#views) to the current instance.
This method was intended to be a temporary solution, but is now used by many plugins, which is why it starts with `_`.

See [creating a secret-stack plugin](https://github.com/ssbc/secret-stack/blob/master/PLUGINS.md) for more details.

### `db.getAtSequence([id, seq], cb(err, msg))`

Get a message for a given feed `id` with given `sequence`. Calls back a message or an error, takes a two element array with a feed `id` as the first element, and `sequence` as second element.

Needed for [ssb-ebt replication](https://github.com/ssbc/ssb-ebt)

### `db.getVectorClock(cb)`

Load a map of `id` to latest `sequence` (`{<id>: <seq>,...}`) for every feed in the database.

Needed for [ssb-ebt replication](https://github.com/ssbc/ssb-ebt)

### `db.progress`

Return the current status of various parts of the scuttlebut system that indicate progress. This api is hooked by a number of plugins, but `ssb-db` adds an `indexes` section (which represents how fully built the indexes are).

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

Progress is represented linearly from `start` to `target`. Once `current` is equal to `target` the progress is complete. `start` shows how far it's come. The numbers could be anything, but `start <= current <= target` if all three numbers are equal that should be considered 100%

### `db.status`

Returns metadata about the status of various ssb plugins. ssb-db adds an `sync` section, that shows where each index is up to. output might took like this:

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

### `db.version`

Return the version of `ssb-db`. currently, this returns only the ssb-db version and not the ssb-server version, or the version of any other plugins. [We should fix this soon](https://github.com/ssbc/ssb-server/issues/648)

### `db.queue(msg, cb)`

Add a message to be validated and written, but don't worry about actually writing it. The callback is called when the database is ready for more writes to be queued. Usually that means it's called back immediately. __This method is not exposed over RPC.__

### `db.flush(cb)`

Callback when all queued writes are actually definitely written to the disk.

### `db.post(fn({key, value: msg, timestamp})) => Ovb`

[Observable](https://github.com/dominictarr/obv) that calls `fn` whenever a message is appended (with that message). __This method is not exposed over RPC.__

### `db.since(fn(seq)) => Obv`

On [observable](https://github.com/dominictarr/obv) of the current log sequence. This is always a positive integer that usually increases, except in the exceptional circumstance that the log is deleted or corrupted.

### `db.addBoxer(box)`

Add a box, which will be added to the list of boxers which will try to
automatically box (encrypt) the message `content` if the appropriate
`content.recps` is provided.

`box` is a function of signature `box(content, recps) => (String|null)`
which is expected to either box the the message content and return a ciphertext String, or return null if it unable to.

### `db.addUnboxer({key: unboxKey, value: unboxValue})`

Add an unboxer object, any encrypted message is passed to the unboxer object to test if it can be unboxed (decrypted) where
- `unboxKey(ciphertext) => msgKey` is a function which tries to extract the message key from the encrypted content (`ciphertext`)
- `unboxValue(ciphertext, msgKey) => plaintext` is a function which takes a message key and uses it to try to extract the message content from the `ciphertext`

NOTE: There's an alternative way to use `addUnboxer` but read the source to understand that.

### `db.unbox(data, key)`

Attempt to decrypt data using key. Key is a symmetric key, that is passed to the unboxer objects.

## Deprecated apis

### `db.getLatest(feed, cb(err, {key, value: msg}))`

Get the latest message for the given feed, with `{key, value: msg}` style.

Maybe used by some front ends, and by ssb-feed.

### `db.latestSequence(feed, cb(err, sequence))`

Call back the sequence number of the latest message for the given feed.

### `db.latest() => PullSource`

Returns a stream of `{author, sequence, ts}` tuples. `ts` is the time claimed by the author, not the received time.

### `db.createWriteStream() => PullSink`

Create a pull-stream sink that expects a stream of messages and calls `db.add` on each item, appending every valid message to the log.

### `db.createFeed(keys?) => Feed`

__Use [ssb-identities](http://github.com/ssbc/ssb-identities) instead.__

Create a Feed object. A feed is a chain of messages signed by a single key (the identity of the feed).

This handles the state needed to append valid messages to a feed. If keys are not provided, then a new key pair will be generated.

May only be called locally, not from a [ssb-client](https://github.com/ssbc/ssb-client) connection.

The following methods apply to the Feed type.

#### Feed#add(message, cb)

Adds a message of a given type to a feed. This is the recommended way to append messages. 

`message` is a javascript object. It must be a `{}` object with a `type` property that is a string between 3 and 32 chars long.

If `message` has `recps` property which is an array of feed ids, then the message content will be encrypted using [private-box](https://github.com/auditdrivencrypto/private-box) to those recipients. Any invalid recipients will cause an error, instead of accidentially posting a message publically or without a recipient.

#### Feed#id

The id of the feed (which is the feed's public key)

#### Feed#keys

The key pair for this feed.

## Stability

__Stable__ Expect patches, possible features additions.

## License

MIT
