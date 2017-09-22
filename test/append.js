var V = require('ssb-validate')
var tape = require('tape')
var ssbKeys = require('ssb-keys')
var keys = ssbKeys.generate()
var Flume = require('flumedb')
var OffsetLog = require('flumelog-offset')
var codex = require('flumecodec')
var filename =
'/tmp/test_ssb_append'+Date.now()+'/log.offset'
var pull = require('pull-stream')
var explain = require('explain-error')

var timestamp = require('monotonic-timestamp')

var K = [keys]

for(var i = 0; i < 100; i++) K.push(ssbKeys.generate())

var log = OffsetLog(filename, 1024*16, codex.json)
//NOTE: db.js uses Flume(log, false) and then db.ready.set(true) must be done at some point.
//This is uses to cause it to wait until any migration is complete.
var db = Flume(log, true) //false says the database is not ready yet!
  .use('last', require('../indexes/last')())

var a = require('../append')(db, {})
var MSG
tape('setup', function (t) {
  a.append({keys: keys, content: {}}, function (err, msg) {
    if(err) throw err
    MSG = msg
    t.ok(msg)
    db.last.get(function (err, value) {
      t.deepEqual(value[keys.id], {
        id: msg.key,
        sequence: msg.value.sequence,
        ts: msg.value.timestamp
      })
      t.end()
    })
  })
})

var state = V.initial()
var N = 100000

tape('generate', function (t) {
  var start = Date.now()
  var l = N
  state = V.append(state, MSG.value)
  console.log(state)

  while(l--) {
    if(!(l%1000)) console.log(l)
    var keys = K[~~(Math.random()*K.length)]
    var content = {
      date: Date.now(), random: Math.random(), type: 'test'
    }
    var msg = V.create(
      state.feeds[keys.id],
      keys, null,
      content, timestamp()
    )
    state = V.append(state, msg)
    if(state.error) throw explain(err, 'error on generate')
  }
  console.log('generate', N/((Date.now()-start)/1000))
  t.end()
})

tape('loads', function (t) {
  var start = Date.now()
  db.since(function (s) {
    k++
    if(!(k%10)) console.log(j, k, s)
  })

  //set j=1 to skip first message, which has already been appended.
  var j = 1, k = 0
  ;(function next () {
    if(j >= state.queue.length) return a.flush(function () {
      console.log('append', N/((Date.now()-start)/1000))
      t.end()
    })

    a.queue(state.queue[j], function (err) {
      if(err) throw explain(err, 'queued invalid message')
      if(!(++j%1000)) console.log(j)
      if(Math.random() < 0.01)
        setImmediate(next)
      else next()
    })
  })()

})

tape('read back', function (t) {
  var msgs = state.queue //[MSG.value].concat(state.queue)
  var i = 0
  var _state = V.initial()
  var ts = 0
  var start = Date.now()
  pull(
    db.stream({seqs: false}),
    pull.drain(function (msg) {
      if(!(msg.timestamp > ts))
      t.fail('messages out of order')
      ts = msg.timestamp
      _state = V.append(_state, msg.value)
      if(_state.error) throw _state.error
    }, function (err) {
      if(err) throw err
      t.equal(_state.queue.length, msgs.length)

      console.log('revalidate', N/((Date.now()-start)/1000))
      t.end()
    })
  )
})







