'use strict'

var tape = require('tape')
var pull = require('pull-stream')
var Abortable = require('pull-abortable')
var compare = require('ltgt').compare
var generate = require('ssb-keys').generate

var createSSB = require('./util/create-ssb')

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

function run (opts) {
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

  // NOTE these tests could be out of place / poorly named? (or could be just write)
  // - createUserStream + latest being tested, why?
  // - these tests are assumed to run **in serial** and each test adds more context, which makes moving them dangerous

  // ODD ONE
  tape('latest (history)', function (t) {
    keys = init(ssb, 7, function (err) {
      if (err) throw err
      pull(ssb.latest(), pull.collect(function (err, ary) {
        if (err) throw err
        delete ary[0].ts
        t.deepEqual(ary, [
          { id: keys.id, sequence: 8 }
        ])
        t.end()
      }))
    })

    id = keys.id // opts.hash(keys.public)
  })

  tape('createHistoryStream (since seq)', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, seq: 1 }),
      pull.collect(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 8)
        t.end()
      })
    )
  })

  // ODD ONE
  tape('latest (two keys)', function (t) {
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

  tape('createHistoryStram (keys & since)', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, seq: 1, keys: true }),
      pull.collect(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 8)
        t.ok(!!ary[0].key)
        t.ok(!!ary[1].key)
        t.end()
      })
    )
  })

  // ODD ONE
  tape('createUserStream', function (t) {
    pull(
      ssb.createUserStream({ id: id, gt: 3, lte: 7, reverse: true }),
      pull.collect(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 4)
        t.equal(ary[3].value.sequence, 4)
        t.equal(ary[2].value.sequence, 5)
        t.equal(ary[1].value.sequence, 6)
        t.equal(ary[0].value.sequence, 7)
        t.end()
      })
    )
  })
  tape('createHistoryStream (keys only)', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, values: false }),
      pull.collect(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 8)
        ary.forEach(function (v) { t.equal(typeof v, 'string') })
        t.end()
      })
    )
  })

  tape('createHistoryStream (values only)', function (t) {
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

  tape('createHistoryStream (abort live stream)', function (t) {
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
      }, function (_err) {
        t.equal(_err, err)
      }),
      pull.collect(function (err, ary) {
        t.equal(err.message, errMsg)
        t.equal(ary.length, 8)
        t.end()
      })
    )
  })

  tape('createHistoryStream (with limit)', function (t) {
    pull(
      ssb.createHistoryStream({
        id: id, keys: false, limit: 5
      }),
      pull.collect(function (err, ary) {
        if (err) throw err
        t.equal(ary.length, 5)

        // assumes this is last test run
        ssb.close(() => {
          if (err) console.error(err)
          t.end()
        })
      })
    )
  })

  // NOTE we might have to do this
  // tape.onFinish(ssb.close)
}

run()
