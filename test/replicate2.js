

var level     = require('level-test')()
var pull      = require('pull-stream')
var ecc       = require('eccjs')
var tape      = require('tape')

var SBS       = require('../')
var u         = require('../util')
var replicate = require('../replicate2')

var codec     = require('../codec')

//create a instance with a feed
//then have another instance follow it.

function rand (n) {
  var a = []
  while(n--)
    a.push(Math.random())
  return a
}

function create(name) {
  return SBS(level(name, {
    keyEncoding: codec, valueEncoding: codec
  }))
}

var MESSAGE = new Buffer('message')

function init (sbs, n, cb) {
  var keys = ecc.generate(ecc.curves.k256)
  var f = sbs.feed(keys)
  pull(
    pull.values(rand(n)),
    pull.asyncMap(function (r, cb) {
      f.append(MESSAGE, ''+r, cb)
    }),
    pull.drain(null, function (err) {
      if(err) return cb(err)
      f.verify(cb)
    })
  )
  return f
}

function compareDbs (a, b, cb) {

  var cbs = u.groups(next)

  pull(a.createFeedStream(), pull.collect(cbs()))
  pull(b.createFeedStream(), pull.collect(cbs()))

  function next(err, ary) {
    cb(err, ary && ary[0], ary && ary[1])
  }
}

tape('simple replicate', function (t) {

  var sbs1 = create('sbs-replicate1')
  var sbs2 = create('sbs-replicate2')

  var cb1 = u.groups(done)

  var f1 = init(sbs1, 5, cb1())
  var f2 = init(sbs2, 4, cb1())

  f2.follow(f1.id, cb1())
  f1.follow(f2.id, cb1())

  var ary = [], n = 1

  function done (err) {
    console.log('initialized')
    if(err) throw err
    var cb2 = u.groups(done2)

    var a = replicate(sbs1, cb2())
    var b = replicate(sbs2, cb2())

    pull(a,
      pull.through(function (e) {console.log('>>>', e); ary.push(e)}),
      b,
      pull.through(function (e) {console.log('<<<', e)}),
      a)

    function done2 (err) {
      console.log('REPLICATED')
      if(err) throw err
      //now check that the databases have really been updated.

      var cbs = u.groups(next)

      pull(sbs1.createFeedStream(), pull.collect(cbs()))
      pull(sbs2.createFeedStream(), pull.collect(cbs()))

      function next (err, ary) {
        if(err) throw err

        t.deepEqual(ary[0], ary[1])

        console.log('replicated!!!')
        t.end()
      }
    }
  }
})

tape('3-way replicate', function (t) {

  var sbs1 = create('sbs-3replicate1')
  var sbs2 = create('sbs-3replicate2')
  var sbs3 = create('sbs-3replicate3')

  var cb1 = u.groups(done)

  var f1 = init(sbs1, 10, cb1())
  var f2 = init(sbs2, 15, cb1())
  var f3 = init(sbs3, 20, cb1())

  f1.follow(f2.id, cb1())
  f1.follow(f3.id, cb1())

  f2.follow(f1.id, cb1())
  f2.follow(f3.id, cb1())

  f3.follow(f1.id, cb1())
  f3.follow(f2.id, cb1())


  var ary = []

  function done (err) {
    if(err) throw err
    var cb2 = u.groups(done2)

    var a = replicate(sbs1, cb2())
    var b = replicate(sbs2, cb2())

    pull(a, b, a)

    function done2 (err) {
      if(err) throw err
      //now check that the databases have really been updated.

      var cb3 = u.groups(done3)

      var c = sbs3.createReplicationStream(cb3())
      var d = sbs2.createReplicationStream(cb3())

      pull(c, d, c)

      function done3 (err) {
        if(err) throw err

        var cbs = u.groups(next)

        pull(sbs2.createFeedStream(), pull.collect(cbs()))
        pull(sbs3.createFeedStream(), pull.collect(cbs()))

        function next (err, ary) {
          if(err) throw err

          t.deepEqual(ary[0], ary[1])

          console.log('replicated!!!')
          t.end()
        }
      }
    }
  }
})

