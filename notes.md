
## replication strategy for the local network.

1. broadcast beacon with udp.

2. if there are other scuttlebutts, randomly replicate to them.

there are probably lots of little optimizations you could do here,

for broadcasting:

  broadcast quickly when you start up, or get a new message.
  if no one is around, slow down to an idle.
  if you receive a message from a new peer, wake up, and
  start to broadcast quickly again.

maybe you could just broadcast messages to the local network,
and if someone gets an out of order message, they would
connect directly and get back up to date.

## replication over the internet

you want to replicate with all the nodes you follow.
hmm... estimate when you next expect a message from a given node
(depending on how often they post) and then connect to nodes
that you expect to have gotten a message but havn't...

If you get data for someone else via a mutual friend,
then then you won't need to connect to them, because
you'll update your expectations to be further in the future.

There could be one strategy for replicating the data,
and another strategy for connecting the network for realtime.

### realtime replication

randomly connect to > 1 peers on average. say 1.3 at least.
detect if there your arn't connected to many nodes and then connect to more.

What about realtime? twitter is probably much more engaging because
of realtime updates... the graph could be connected,
but that doesn't mean it's optimal.
is there a way to shorten hops to the busy nodes?

Hmm, if you see the same message twice, be more likely to disconnect the source with the slower
messages - this would only apply to realtime messages - but not the base replication...

Don't retransmit messages that you already have...

So, for realtime messages - have a hop counter on each message,
if you get many repeat messages, drop the connection with the highest hop counter,
and search for another connection randomly.

Maybe, by waiting a random delay, you'll tend to have messages broadcast out...
the question is what is the overhead from messages sent to the same node twice?
and what is the average delay for any particular realtime message?

Hmm, the most overhead efficient would be a chain - there would be no
extra sends, then a cycle - that would have 1 extra send. A tree around
a noisy root node would messages could branch out..

what is the WORST topology?

if the graph is a lattice, nodes with 2 equal length paths to the source would receive
a message twice (assuming that latency is equal, and node sends it's messages in the same instant)
so... does this mean that nodes with multiple equal length paths to a source will get messages
that many times?

like this:

 .--B--.
A---C---E
 `--D--`

when A emits, E would receive 3 copies, in this example, there are too many connections.
this seems like a pathological case... what would happen in real random networks?

IDEA: for a twitter model - maybe fill out the network by replicating data that is
one layer out, just don't show it in the UI. maybe do them less frequently, so that the messages
are not so big... but 

IDEA: when doing handshakes, you don't really need to send all the bytes in the hash. It doesn't
matter if it's exactly right, and the collision probability is still low
Even the chance of an 8 byte collision would be very low... you are probably only replicating thousands of feeds,

HA, you could encode it like this [lenHash/5, lenSeq/3][HASH][Seq]
that would be more efficient than a two var ints, and would allow a 32 byte hash + a 8 byte integer.
both the maximum! that would add one byte extra per feed. or maybe it would be better just to make the hash length
a parameter that is global to the stream.

This optimization is assuming that replications are nearly always mostly up to date.

## API

operations you need to do (just thinking out loud here, need to figure
out permissions model) All these would take ordinary level options,
lt, gt, lte, gte, and reverse, etc.

idea: permissions could be implemented by white/black listing
calls and arguments. This would make it possible to set permissions
such as "may only create messages of type X". Or may only read
given messages.

### streamByAuthor (author)

read all messages from a given author.

### streamAll ()

read all messages from all known authors.

### streamByType (type, author?)

get all messages of a given type (optionally, by a given author)

### writeMessage(type, message)

create a new message of a given type.

### follow (id)

follow another user

### isFollowing (id1, id2)

check if a given user is following another.

### unfollow (id)

unfollow another user.

### createNearbysStream ()

data created by other nodes on the same network.

### Privacy

secure scuttlebutt could be made more secure by limiting who
you replicate with...

If you authorized in replication, you could limit replicators
to who you followed, or second level - if someone you follow follows them.
this could be checked within the replication...
you'd have to check what feeds they are allowed to follow when
auth them, so you don't tell them about private feeds,
for this, you probably want to keep followers and blocks and privacy
settings in memory.


