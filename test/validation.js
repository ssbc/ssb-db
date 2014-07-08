var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel')

module.exports = function (opts) {

  var db = sublevel(level('test-ssb-validate', {
    keyEncoding: require('bytewise/hex'),
    valueEncoding: 'json'
  }))

  var create = require('../message')(opts)
  var ssb = require('../rewrite')(db, opts)

  var validation = require('../validation')(ssb, opts)


  tape('simple', function (t) {

    var keys = opts.generate()
    var id = opts.hash(keys.public)
    var prev
    var messages = [
      prev = create(keys, 'init', keys.public),
      prev = create(keys, 'msg', 'hello', prev),
      prev = create(keys, 'msg', 'hello2', prev)
    ]
    console.log(messages)
    var _msg = null
    messages.forEach(function (msg) {
      validation.validate(msg, function (err) {
        if(_msg)
          t.deepEqual(opts.hash(opts.encode(_msg)), msg.prev)
        _msg = msg
        if(err) throw err
        console.log('validated?', err, msg.sequence)
        if(msg.sequence === 3)
          t.end()
      })
    })

//    var prev
//    ssb.add(
//      prev = create(keys, 'init', keys.public),
//      function () {
//
//        ssb.add(
//          prev = create(keys, 'msg', 'hello', prev),
//          function () {
//
//            ssb.add(
//              prev = create(keys, 'msg', 'hello2', pre),
//              function () {
//                pull(
//                  db.createFeedStream(id),
//                  validation.createValidationStream(function (err, _prev) {
//                    t.deepEqual(_prev, prev)
//                    t.end()
//                  })
//                )
//              }
//            )
//          }
//        )
//      }
//    )
  })
}

if(!module.parent)
  module.exports(require('../defaults'))
