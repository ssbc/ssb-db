var handshake = require('pull-handshake')
var pull = require('pull-stream')
var many = require('pull-many')
var pswitch = require('pull-switch')

var u = require('./util')

function listToObj(ary) {
  var obj = {}
  ary.forEach(function (data) {
    obj[data.key.toString('hex')] = data.value
  })
  return obj
}

function compare (a, b) {
  var l = Math.min(a.length, b.length)
  for(var i = 0; i < l; i++) {
    if(a[i]<b[i]) return -1
    if(a[i]>b[i]) return  1
  }
  return a.length - b.length
}

/*
todo: simplify all this, making it better for realtime.

instead of doing the full handshake thing,
just send requests and response streams.

request: [req, hash, since]
message: [res, message]

this means tagging every encoded object with a type...
that would probably simplify the code anyway.

when you receive a request, look in the database to see if you have
more recent messages from that user, if so, send them.

when you have sent all the old messages, you can broadcast
any realtime message you find...

if someone sends you a message you do not want,
just drop that message.

read each stream of mesages using a live stream,
so that you automatically go to sending realtime
updates when you get to that.

by making a request message it will be easy to have ranges
partial ranges. Although... that could cause problems,
because someone with a partial range would not know things
that you want them to know... for example, if you have blocked
someone, they wouldn't realize and so they might give your
data to them.

*/

function replicate (sbs, done) {
  var cbs = u.groups(done || function () {})
  return handshake(function (cb) {
    replicate.vector(sbs, cb)
  }, function (me, you) {
    return {
      source:
        replicate.feeds(sbs, me, you),
      sink:
        sbs.createWriteStream(done)
    }
  })
}

replicate.vector = function (sbs, cb) {
  pull(sbs.latest(), pull.collect(cb))
}

replicate.feeds = function (sbs, me, you) {
  me  = listToObj(me)
  you = listToObj(you)
  //we now that I have a list
  //of what you have, and where
  //you are up to. I'll look in my database
  //and see if I can help you.
  var o = {}
  var feeds = []
  for(var key in you) {
    if(me[key] != null && you[key] < me[key])
      //send key's feed after you[key]
      feeds.push(o[key] = sbs.feed(key).createReadStream())
  }
  //just to test, send all your data to them.
  for(var key in me) {
    if(you[key] == null)
      feeds.push(o[key] = sbs.feed(key).createReadStream())
  }

  return many(feeds)
}

module.exports = replicate
