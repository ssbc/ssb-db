'use strict'

var pull = require('pull-stream')
var tape = require('tape')

var Abortable = require('pull-abortable')

var createSSB = require('./util')

var compare = require('ltgt').compare
var generate = require('ssb-keys').generate

// create a instance with a feed
// then have another instance follow it.

function rand (n) {
  var a = []
  while (n--) { a.push(Math.random()) }
  return a
}

function sort (ary) {
  return ary.sort(function (a, b) {
    return compare(a.id, b.id) || a.sequence - b.sequence
  })
}

module.exports = function (opts) {
  var create = require('ssb-feed/util').create

  function init (ssb, n, cb) {
    var keys = generate()
    var prev

    ssb.add(prev = create(keys, null, { type: 'init', public: keys.public }), function () {
      pull(
        pull.values(rand(n)),
        pull.asyncMap(function (r, cb) {
          ssb.add(prev =
            create(keys, 'msg', '' + r, prev), cb)
        }),
        pull.drain(null, cb)
      )
    })

    return keys
  }

  var ssb = createSSB('ssb-history')
  var keys
  var id
  var keys2

  tape('history', function (t) {
    keys = init(ssb, 7, function (err) {
      if (err) throw err
      pull(ssb.latest(), pull.collect(function (err, ary) {
        if (err) throw err
        delete ary[0].ts
        console.log(ary)
        t.deepEqual(ary, [
          { id: keys.id, sequence: 8 }
        ])
        t.end()
      }))
    })

    id = keys.id // opts.hash(keys.public)
  })

  tape('since', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, seq: 1 }),
      pull.collect(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 8)
        t.end()
      })
    )
  })

  tape('two keys', function (t) {
    keys2 = init(ssb, 4, function (err) {
      if (err) throw err
      pull(ssb.latest(), pull.collect(function (err, ary) {
        if (err) throw err
        t.deepEqual(
          sort(ary.map(function (e) { delete e.ts; return e })),
          sort([
            { id: keys.id, sequence: 8 },
            { id: keys2.id, sequence: 5 }
          ])
        )
        t.end()
      }))
    })
  })

  tape('keys & since', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, seq: 1, keys: true }),
      pull.collect(function (err, ary) {
        if (err) throw err
        console.log(ary)
        t.equal(ary.length, 8)
        t.ok(!!ary[0].key)
        t.ok(!!ary[1].key)
        t.end()
      })
    )
  })

  tape('user stream', function (t) {
    pull(
      ssb.createUserStream({ id: id, gt: 3, lte: 7, reverse: true }),
      pull.collect(function (err, ary) {
        if (err) throw err
        console.log('UserStream', ary)
        t.equal(ary.length, 4)
        t.equal(ary[3].value.sequence, 4)
        t.equal(ary[2].value.sequence, 5)
        t.equal(ary[1].value.sequence, 6)
        t.equal(ary[0].value.sequence, 7)
        t.end()
      })
    )
  })
  tape('keys only', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, values: false }),
      pull.collect(function (err, ary) {
        if (err) throw err
        console.log(ary)
        t.equal(ary.length, 8)
        ary.forEach(function (v) { t.equal(typeof v, 'string') })
        t.end()
      })
    )
  })

  tape('values only', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, keys: false }),
      pull.collect(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 8)
        ary.forEach(function (v) { t.equal(typeof v.content.type, 'string') })
        t.end()
      })
    )
  })

  tape('abort live stream', function (t) {
    var abortable = Abortable()
    var errMsg = 'intentional'
    var err = new Error(errMsg)
    var i = 0

    pull(
      ssb.createHistoryStream({
        id: id, keys: false, live: true
      }),
      abortable,
      pull.through(function (data) {
        if (++i === 8) {
          setTimeout(function () {
            abortable.abort(err)
          }, 100)
        }
        console.log(data)
      }, function (_err) {
        t.equal(_err, err)
        t.end()
      }),
      pull.collect(function (err, ary) {
        t.equal(err.message, errMsg)
        t.equal(ary.length, 8)
      })
    )
  })

  tape('createHistoryStream with limit', function (t) {
    pull(
      ssb.createHistoryStream({
        id: id, keys: false, limit: 5
      }),
      pull.collect(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 5)
        t.end()
      })
    )
  })
}

if (!module.parent) { module.exports({}) }
