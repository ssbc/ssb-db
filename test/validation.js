'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')

module.exports = function (opts) {

  var db = sublevel(level('test-ssb-validate', {
    valueEncoding: require('../codec')
  }))

  var create = require('../message')(opts)
  var ssb = require('../')(db, opts)

  var validation = require('../validation')(ssb, opts)


  tape('simple', function (t) {
    var keys = opts.keys.generate()
    var id = opts.hash(keys.public)

    var prev
    var messages = [
      prev = create(keys, 'init', keys.public),
      prev = create(keys, 'msg', 'hello', prev),
      prev = create(keys, 'msg', 'hello2', prev)
    ]

    var _msg = null
    messages.forEach(function (msg) {
      validation.validate(msg, function (err) {
        if(_msg)
          t.deepEqual(opts.hash(opts.codec.encode(_msg)), msg.previous)
        _msg = msg
        if(err) throw err
        if(msg.sequence === 3)
          t.end()
      })
    })
  })

  tape('add & validate', function (t) {
    var keys = opts.keys.generate()
    var id = opts.hash(keys.public)
    var prev
    ssb.add(
      prev = create(keys, 'init', keys.public),
      function (err) {
        if(err) throw err

        ssb.add(
          prev = create(keys, 'msg', 'hello', prev),
          function (err) {
            if(err) throw err

            ssb.add(
              prev = create(keys, 'msg', 'hello2', prev),
              function (err) {
                if(err) throw err
                pull(
                  db.createFeedStream(id),
                  pull.collect(function (err, ary) {
                    if(err) throw err
                    t.deepEqual(ary.pop(), prev)
                    t.end()
                  })
                )
              }
            )
          }
        )
      }
    )
  })

  tape('race: should queue', function (t) {
    var keys = opts.keys.generate()
    var id = opts.hash(keys.public)
    var prev, calls = 0
    ssb.add(
      prev = create(keys, 'init', keys.public),
      function (err) {
        if(err) throw err
        calls ++
      }
    )
    ssb.add(
      prev = create(keys, 'msg', 'hello', prev),
      function (err) {
        if(err) throw err
        calls ++
      }
    )
    ssb.add(
      prev = create(keys, 'msg', 'hello2', prev),
      function (err) {
        if(err) throw err
        calls ++
      }
    )
    setTimeout(function () {
      ssb.add(
        prev = create(keys, 'msg', 'hello3', prev),
        function (err) {
          if(err) throw err
          calls ++
          t.equal(calls, 4)
          t.end()
        }
      )
    })


  })
}

if(!module.parent)
  module.exports(require('../defaults'))
