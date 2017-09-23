var createFeed = require('ssb-feed')
var ssbKeys = require('ssb-keys')
var timestamp = require('monotonic-timestamp')
var level = require('level')
var sublevel = require('level-sublevel')
var latest = {}, log = [], db

var tape = require('tape')

tape('generate fake feed', function (t) {
  var start = Date.now()
  var feed = createFeed({
    getLatest: function (id, cb) {
      cb(null, latest[id])
    },
    add: function (msg, cb) {
      latest[msg.author] = {key: '%'+ssbKeys.hash(JSON.stringify(msg, null, 2)), value: msg}
      log.push(msg)
      cb()
    }
  }, ssbKeys.generate())

  var l = 10000
  while(l--)
    feed.add({type: 'test', text:'hello1', l: l}, function () {})

  console.log('generate', Date.now() - start)
  t.end()
})

tape('populate legacy database', function (t) {
  var start = Date.now()
  db = sublevel(level('/tmp/test-ssb-feed_'+Date.now(), {
    valueEncoding: require('../codec')
  }))

  require('../legacy')(db)

  ;(function next () {
    var batch = log.splice(0, 1000)
    db.batch(batch.map(function (msg) {
      var key = '%'+ssbKeys.hash(JSON.stringify(msg, null, 2))
      return {
        key: key,
        value: {
          key: key, value: msg, timestamp: +timestamp()
        },
        type: 'put'
      }
    }), function (err) {
      if(log.length) {
        console.log(log.length)
        setTimeout(next)
      }
      else {
        console.log('legacy-write', Date.now() - start)
        t.end()
      }
    })
  })()

})

tape('migrate', function (t) {
  var start = Date.now()
  var flume = require('../db')('/tmp/test-ssb-migration_'+Date.now())

  var int = setInterval(function () {
    console.log(flume.progress)
  },100)

  flume.ready(function (isReady) {
    if(isReady) {
      console.log('ready!', flume.since.value)
      console.log(flume.progress)
      console.log('migrate', Date.now() - start)
      clearInterval(int)
      t.equal(flume.progress.current, flume.progress.target)
      t.end()
    }
  })

  require('../legacy')(db, flume)

})

tape('progress looks right on empty database', function (t) {

  var db = sublevel(level('/tmp/test-ssb-feed_'+Date.now(), {
    valueEncoding: require('../codec')
  }))
  
  var flume = require('../db')('/tmp/test-ssb-migration_'+Date.now())

  flume.ready(function (b) {
    if(b) {
      console.log('ready?', flume.progress)
      t.ok(flume.progress, 'progress object is defined')
      t.notOk(flume.progress.migration, 'progress.migration is undefined')
      setTimeout(function () {
        t.equal(
          flume.progress.indexes.current,
          -1,
          'current is -1'
        )
        t.equal(
          flume.progress.indexes.target,
          -1,
          'target is -1'
        )
        t.end()
      }, 200)
    }
  })

  require('../legacy')(db, flume)

})

