# Secure Scuttlebutt

A **global database protocol** of unforgeable append-only message feeds.

"Unforgeable" means that only the owner of a feed can update that feed, as enforced by digital signing (see [Security properties](#security-properties)).
This property makes Secure Scuttlebutt useful for peer-to-peer applications.
Secure Scuttlebutt also makes it easy to encrypt messages.

## Concepts

Building upon Secure Scuttlebutt requires understanding a few concepts that it uses to ensure the unforgeability of message feeds.

### Identities

An identity is simply a [ed25519 key pair](http://ed25519.cr.yp.to/).
The public key is used as the identifier.

There is no worldwide store of identities.
Users must exchange pubkeys, either by publishing them on their feeds, or out-of-band.

### Feeds

A feed is an append-only sequence of messages.
Each identity has exactly one feed.

Note that append-only means you cannot delete an existing message, or change your history.
This is enforced by a per-feed blockchain.
This is to ensure the entire network converges on the same state.

### Replication

Since feeds are append-only, replication is simple: request all messages in the feed that are newer than the latest message you know about.

[Scuttlebot](https://ssbc.github.io/scuttlebot/) does this with the `createHistoryStream` api call.
It maintains a table of known peers, which is cycles through, asking for updates for all "followed" feeds.

### Following

Users choose which feeds to synchronize by following them.
Presently, [Scuttlebot's replicate plugin](https://ssbc.github.io/docs/api/scuttlebot-replicate.html), which is enabled by default, looks on the master user's feed for [type: contact](https://ssbc.github.io/docs/api/ssb-msg-schemas.html) messages to know which users are currently followed.

### Messages

Each message contains:

- A content-hash of the previous message.
  This prevents somebody with the private key from changing the feed history after publishing, as a newly-created message wouldn't match the "prev-hash" of later messages which were already replicated.
- The signing public key.
- A sequence number.
  This prevents a malicious party from making a copy of the feed that omits or reorders messages.
- A timestamp.
  Note, this timestamp is asserted by the publishing user, and may not be trustworthy.
- An identifier of the hashing algorithm in use (currently only "sha256" is supported).
- A content object.
  This is the thing that the end user cares about.
  If there is no encryption, this is an object.
  If there is encryption, this is an encrypted string.
- A signature.
  This prevents malicious parties from writing fake messages to a stream.
  
Here's an example message:

```js
{
  "previous": "%26AC+gU0t74jRGVeDY013cVghlZRc0nfUAnMnutGGHM=.sha256",
  "author": "@hxGxqPrplLjRG2vtjQL87abX4QKqeLgCwQpS730nNwE=.ed25519",
  "sequence": 216,
  "timestamp": 1442590513298,
  "hash": "sha256",
  "content": {
    "type": "vote",
    "vote": {
      "link": "%WbQ4dq0m/zu5jxll9zUbe0iGmDOajCx1ZkLKjZ80JvI=.sha256",
      "value": 1
    }
  },
  "signature": "Sjq1C3yiKdmi1TWvNqxIk1ZQBf4pPJYl0HHRDVf/xjm5tWJHBaW4kXo6mHPcUMbJYUtc03IvPwVqB+BMnBgmAQ==.sig.ed25519"
}
```

### Entity References (Links)

The text inside a message can refer to three types of Secure Scuttlebutt entities: messages, feeds, and blobs (i.e. attachments).
Messages and blobs are referred to by their hashes, but a feed is referred to by its signing public key.
Thus, a message within a feed can refer to another feed, or to a particular point _within_ a feed.

[Read more about links here.](https://ssbc.github.io/docs/ssb/linking.html)


### LAN and Internet connectivity

SSB is hostless: each computer installs the same copy of software and has equal rights in the network.
Devices discover each other over the LAN with multicast UDP and sync automatically.

To sync across the Internet, "Pub" nodes run at public IPs and follow users.
They are essentially mail-bots which improve uptime and availability.
Users generate invite-codes to command Pubs to follow their friends.
The SSB team runs some Pubs, but anybody can create and introduce their own.

## Security properties

Secure Scuttlebutt maintains useful security properties even when it is connected to a malicious Secure Scuttlebutt database.
This makes it ideal as a store for peer-to-peer applications.

Imagine that we want to read from a feed for which we know the identity, but we're connected to a malicious Secure Scuttlebutt instance.
As long as the malicious database does not have the private key:

- The malicious database cannot create a new feed with the same identifier
- The malicious database cannot write new fake messages to the feed
- The malicious database cannot reorder the messages in the feed
- The malicious database cannot send us a new copy of the feed that omits messages from the middle
- The malicious database *can* refuse to send us the feed, or only send us the first *N* messages in the feed
- Messages may optionally be encrypted

## Further Reading

- [Design Challenge: Avoid Centralization and Singletons](https://ssbc.github.io/docs/articles/design-challenge-avoid-centralization-and-singletons.html)
- [Design Challenge: Sybil Attacks](https://ssbc.github.io/docs/articles/design-challenge-sybil-attack.html)
- [Using Trust in Open Networks](https://ssbc.github.io/docs/articles/using-trust-in-open-networks.html)