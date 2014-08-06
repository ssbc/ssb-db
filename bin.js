#! /usr/bin/env node
/*
USAGE:

  scuttlebutt            # read a message your feed in $PAGER
  scuttlebutt > feed.txt # dump your feed, latest to earliest

                         # post a message
  scuttlebutt say 'message....'
  echo message | scuttlebutt say

  scuttlebutt --reverse  # show feed since start

                         # show feed in chronolical order
  scuttlebutt --gte start --lt end

                         # view the feed of a given author
  scuttlebutt --author HASH

  scuttlebutt help       # display this message.


  scuttlebutt public     # display the public key.

  scuttlebutt follow USERHASH 

  scuttlebutt create     # create a new user
*/

var fs       = require('fs')
var crypto   = require('crypto')

var mkdirp   = require('mkdirp')
var osenv    = require('osenv')
var path     = require('path')

var level    = require('level')
var proquint = require('proquint-')
var ecc      = require('eccjs')
var k256     = ecc.curves.k256
var Blake2s  = require('blake2s')

var pull     = require('pull-stream')

var keys

var sbhome   = path.join(osenv.home(), '.scuttlebutt')
var namefile = path.join(sbhome, 'secret.name')
var dbpath   = path.join(sbhome, 'database')

var ScuttlebuttSecure = require('./')

mkdirp.sync(sbhome)

function bsum (value) {
  return new Blake2s().update(value).digest()
}

try {
  var PRIVATE =
    proquint.decode(
      fs.readFileSync(namefile, 'ascii')
        .replace(/\s*\#[^\n]*/g, '')
    )
  keys = ecc.restore(k256, PRIVATE)
} catch (err) {
  console.error(err)
}

var config = require('./config')

var db = level(dbpath, {valueEncoding: 'binary'})
var scuttlebutt = ScuttlebuttSecure(db)

exports.create = function (args, opts, cb) {
  var namefile = path.join(sbhome, 'secret.name')
  fs.stat(namefile, function (err, stat) {
    if(stat && !opts.force)
      return cb(new Error('name already generated, use --force to obliterate it'))

    var PRIVATE = crypto.randomBytes(32)
    var keys = ecc.restore(k256, PRIVATE)
    var public = bsum(keys.public)

    var contents = [
    '# this is your SECRET name.',
    '# this name gives you magical powers.',
    '# with it you can mark your messages so that your friends can verify',
    '# that they really did come from you.',
    '#',
    '# if any one learns this name, they can use it to destroy your identity',
    '# NEVER show this to anyone!!!',
    '',
    proquint.encodeCamelDash(keys.private),
    '',
    '# notice that it is quite long.',
    '# it\'s vital that you do not edit your name',
    '# instead, share your public name',
    '# your public name: ' + proquint.encode(public),
    '# or as a hash : ' + public.toString('hex')
    ].join('\n')

    fs.writeFile(namefile, contents, cb)
  })
}

function toHuman (msg) {
  return (
    proquint.encodeCamelDash(msg.author).substring(0, 43) + ' / ' +
    msg.sequence + '\n' +
    msg.type.toString('utf8') + ' : '+
    new Date(msg.timestamp).toISOString() + '\n' +
    ( msg.type.toString('utf8') == 'INIT'
    ? msg.message.toString('hex') + '\n'
    : msg.message.toString('utf8') + '\n' )
  )
}

exports.feed = function (_, opts, cb) {
  return pull(
    scuttlebutt.createFeedStream(),
    pull.map(toHuman)
  )
}

exports.following = function (_, opts, cb) {
  return pull(
    scuttlebutt.latest(),
    pull.map(function (data) {
      return proquint.encodeCamelDash(data.key).substring(0, 43) + ' ' + data.value
    })
  )
}

exports.say = function (_, opts, cb) {
  var message = _.join(' ').trim() || opts.m || opts.message

  var feed = scuttlebutt.feed(keys)
  feed.append(new Buffer('message'), message, cb)
}

exports.start = function () {
  //create a broadcast stream that echos once a second
  //to advertise that you are running secure scuttlebutt.
  //send a message that looks like

  // SCUTTLEBUTT,id,port,timestamp

  // (port is the tcp port your replication server is on)

  // it will then create a stream to connect to that server.
  // when a new instance is discovered, it will connect to that server
  // and replicate.
}

exports.public = function (args, opts, cb) {
  console.log(proquint.encode(bsum(keys.public)))
  cb()
}

if(!module.parent) {
  var command = config._.shift()

  if(!command) //read the feed.
    command = 'feed'

  if(exports[command]) {
    scuttlebutt.feed(keys).verify(function (err) {
      if(err) throw err

      stream = exports[command](config._, config, done)
      if(stream)
        pull(stream, pull.through(console.log), pull.drain(null, done))

    })
  }

  function done (err, value, human) {
    if(err) throw err
    if(!value && !human) return
    if(process.stdout.isTTY)
      console.log(human || JSON.stringify(value, null, 2))
    else
      console.log(JSON.stringify(value, null, 2))
  }

}



