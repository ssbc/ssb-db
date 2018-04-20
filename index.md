# Secure Scuttlebutt

Secure Scuttlebutt is a database protocol for unforgeable append-only message feeds.

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

A feed is a signed append-only sequence of messages.
Each identity has exactly one feed.

Note that append-only means you cannot delete an existing message, or change your history.
This is enforced by a per-feed blockchain.
This is to ensure the entire network converges on the same state.

### Messages

Each message contains:

- A signature
- The signing public key
- A content-hash of the previous message
- A sequence number
- A timestamp
- An identifier of the hashing algorithm in use (currently only "sha256" is supported)
- A content object
  
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

Messages can reference three types of Secure Scuttlebutt entities: messages, feeds, and blobs (i.e. files).
Messages and blobs are referred to by their hashes, but a feed is referred to by its signing public key.

[&raquo; Content-Hash Links](https://ssbc.github.io/docs/ssb/linking.html)

### Confidentiality

For private sharing, Scuttlebot uses [libsodium](http://doc.libsodium.org/) to encrypt confidential log-entries.
Feed IDs are public keys, and so once two feeds are mutually following each other, they can exchange confidential data freely.

[&raquo; Private Box](https://ssbc.github.io/docs/ssb/end-to-end-encryption.html)

### Following

Users choose which feeds to synchronize by following them.
Presently, [Scuttlebot's replicate plugin](https://ssbc.github.io/scuttlebot/plugins/replicate.html), which is enabled by default, looks on the master user's feed for [type: contact](https://ssbc.github.io/ssb-msg-schemas) messages to know which users are currently followed.

### Replication

Since feeds are append-only, replication is simple: request all messages in the feed that are newer than the latest message you know about.
Scuttlebot maintains a table of known peers, which it cycles through, asking for updates for all followed feeds.

### Gossip

The protocol creates a [global gossip network](https://en.wikipedia.org/wiki/Gossip_protocol).
This means that information is able to distribute across multiple machines, without requiring direct connections between them.

![Gossip graph](https://ssbc.github.io/docs/gossip-graph1.png)

Even though Alice and Dan lack a direct connection, they can still exchange feeds:

![Gossip graph 2](https://ssbc.github.io/docs/gossip-graph2.png)

This is because gossip creates "transitive" connections between computers.
Dan's messages travel through Carla and the Pub to reach Alice, and visa-versa.

### LAN connectivity

SSB is hostless: each computer installs the same copy of software and has equal rights in the network.
Devices discover each other over the LAN with multicast UDP and sync automatically.

### Pub Servers

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

Additionally there is a protection from the feed owner, through the blockchain.
The `previous` content-hash prevents them from changing the feed history after publishing, as a newly-created message wouldn't match the hash of later messages which were already replicated.
This ensures the append-only constraint, and thus safe network convergence.

## Further Reading

- [Design Challenge: Avoid Centralization and Singletons](https://ssbc.github.io/docs/articles/design-challenge-avoid-centralization-and-singletons.html)
- [Design Challenge: Sybil Attacks](https://ssbc.github.io/docs/articles/design-challenge-sybil-attack.html)
- [Using Trust in Open Networks](https://ssbc.github.io/docs/articles/using-trust-in-open-networks.html)
