
/*
# replication strategy for the local network.

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

for internet:

  randomly connect to > 1 peers on average. say 1.3 at least.
  detect if there your arn't connected to many nodes and then connect to more.

  what about realtime? twitter is probably much more engaging because
  of realtime updates... the graph could be connected, but that doesn't mean it's optimal.
  is there a way to shorten hops to the busy nodes?

  hmm, if you see the same message twice, be more likely to disconnect the source with the slower
  messages - this would only apply to realtime messages - but not the base replication...

  don't retransmit messages that you already have...

  so, for realtime messages - have a hop counter on each message,
  if you get many repeat messages, drop the connection with the highest hop counter,
  and search for another connection randomly.

  maybe, by waiting a random delay, you'll tend to have messages broadcast out...
  the question is what is the overhead from messages sent to the same node twice?
  and what is the average delay for any particular realtime message?

  hmm, the most overhead efficient would be a chain - there would be no extra sends,
  then a cycle - that would have 1 extra send. A tree around a noisy root node would
  messages could branch out..

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
*/


