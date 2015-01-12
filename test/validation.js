'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var explain  = require('explain-error')

module.exports = function (opts) {

  var db = sublevel(level('test-ssb-validate', {
    valueEncoding: opts.codec
  }))

  var create = require('../message')(opts)
  var ssb = require('../')(db, opts)

  var validation = require('../validation')(ssb, opts)

  tape('getLastest - empty', function (t) {
    var keys = opts.keys.generate()
    var id = opts.hash(keys.public)
    validation.getLatest(id, function (err, obj) {
      t.deepEqual({
        key: null, value: null, type: 'put',
        public: null, ready: true
      }, obj)
      t.end()
    })
  })

  tape('single', function (t) {
    var keys = opts.keys.generate()
    var id = opts.hash(keys.public)
    var msg = create(keys, null, {type: 'init', public: keys.public})

    validation.validate(msg, function (err) {
      if(err) throw err
      validation.getLatest(msg.author, function (err, obj) {
        t.deepEqual({
          key: opts.hash(opts.codec.encode(msg)), value: msg, type: 'put',
          public: keys.public, ready: true
        }, obj)
        t.end()
      })
    })
  })

  tape('simple', function (t) {
    var keys = opts.keys.generate()
    var id = opts.hash(keys.public)
    var prev
    var messages = [
      prev = create(keys, null, {type: 'init', public: keys.public}),
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
      prev = create(keys, null, {type: 'init', public: keys.public}),
      function (err) {
        if(err) throw explain(err, 'init failed')

        ssb.add(
          prev = create(keys, 'msg', 'hello', prev),
          function (err) {
            if(err) throw explain(err, 'hello failed')

            ssb.add(
              prev = create(keys, 'msg', 'hello2', prev),
              function (err) {
                if(err) throw explain(err, 'hello2 failed')
                pull(
                  db.createFeedStream({ keys: false }),
                  pull.collect(function (err, ary) {
                    if(err) throw explain(err, 'createFeedStream failed')
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
      prev = create(keys,null, {type:  'init', public: keys.public}),
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
