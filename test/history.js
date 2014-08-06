'use strict';

var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var pull      = require('pull-stream')
var ecc       = require('eccjs')
var tape      = require('tape')

var SSB       = require('../')
var u         = require('../util')
var replicate = require('../replicate')

var codec     = require('../codec')
var JSONB     = require('json-buffer')

var compare   = require('ltgt').compare

//create a instance with a feed
//then have another instance follow it.

function rand (n) {
  var a = []
  while(n--)
    a.push(Math.random())
  return a
}

function sort (ary) {
  return ary.sort(function (a, b) {
    return compare(a.id, b.id) || a.sequence - b.sequence
  })
}


module.exports = function (opts) {

  var create = require('../message')(opts)

  function createDB(name) {
    return SSB(sublevel(level(name, {
      valueEncoding:
        require('../codec')
//      {
//        encode: JSONB.stringify,
//        decode: JSONB.parse,
//        buffer: false
//      }
    })), opts)
  }

  var MESSAGE = new Buffer('msg')

  function init (ssb, n, cb) {
    var keys = opts.keys.generate()
    var prev

    ssb.add(prev = create(keys, 'init', keys.public), function () {
      pull(
        pull.values(rand(n)),
        pull.asyncMap(function (r, cb) {
          ssb.add(prev =
            create(keys, 'msg', ''+r, prev), cb)
        }),
        pull.drain(null, cb)
      )
    })

    return keys
  }

  var ssb = createDB('ssb-history')
  var keys, id, keys2, id2

  tape('history', function (t) {

    keys = init(ssb, 7, function (err) {
      pull(ssb.latest(), pull.collect(function (err, ary) {
        if(err) throw err
        console.log(ary)
        t.deepEqual(ary, [
          {id: id, sequence: 8}
        ])
        t.end()
      }))
    })

    id = opts.hash(keys.public)
  })

  tape('since', function (t) {
    pull(
      ssb.createHistoryStream(id, 1),
      pull.collect(function (err, ary) {
        t.equal(ary.length, 8)
        t.end()
      })
    )
  })

  tape('two keys', function (t) {

    keys2 = init(ssb, 4, function (err) {
      pull(ssb.latest(), pull.collect(function (err, ary) {
        if(err) throw err
        console.log(ary)
        t.deepEqual(sort(ary), sort([
          {id: id, sequence: 8},
          {id: id2, sequence: 5}
        ]))
        t.end()
      }))
    })

    id2 = opts.hash(keys2.public)

  })
}

if(!module.parent)
  module.exports(require('../defaults'))
