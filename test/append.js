var V = require('ssb-validate')
var tape = require('tape')
var ssbKeys = require('ssb-keys')
var keys = ssbKeys.generate()

var pull = require('pull-stream')
var explain = require('explain-error')
var timestamp = require('monotonic-timestamp')

var dirname = '/tmp/test_ssb_append' + Date.now()

var K = [keys]

for (var i = 0; i < 100; i++) K.push(ssbKeys.generate())

var a
var db = a = require('../minimal')(dirname)
db.ready.set(true)
var MSG
tape('setup', function (t) {
  console.log('SETUP:APPEND')
  a.append({ keys: keys, content: { type: 'empty' } }, function (err, msg) {
    if (err) throw err
    MSG = msg
    t.ok(msg)
    db.last.get(function (err, value) {
      if (err) throw err
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
var N = 10000

tape('generate', function (t) {
  var start = Date.now()
  var l = N
  state = V.append(state, null, MSG.value)
  console.log(state)

  while (l--) {
    if (!(l % 1000)) console.log(l)
    var keys = K[~~(Math.random() * K.length)]
    var content = {
      date: Date.now(), random: Math.random(), type: 'test'
    }
    var msg = V.create(
      state.feeds[keys.id],
      keys, null,
      content, timestamp()
    )
    state = V.append(state, null, msg)
    if (state.error) throw explain(state.error, 'error on generate')
  }
  console.log('generate', N / ((Date.now() - start) / 1000))
  t.end()
})

tape('loads', function (t) {
  var start = Date.now()
  db.since(function (s) {
    k++
    if (!(k % 10)) console.log(j, k, s)
  })

  // set j=1 to skip first message, which has already been appended.
  var j = 1
  var k = 0
  ;(function next () {
    if (j >= state.queue.length) {
      return a.flush(function () {
        console.log('append', N / ((Date.now() - start) / 1000))
        t.end()
      })
    }

    a.queue(state.queue[j].value, function (err) {
      if (err) throw explain(err, 'queued invalid message')
      if (!(++j % 1000)) console.log(j)
      if (Math.random() < 0.01) {
        setImmediate(next)
      } else {
        next()
      }
    })
  })()
})

tape('read back', function (t) {
  var msgs = state.queue // [MSG.value].concat(state.queue)
  var _state = V.initial()
  var ts = 0
  var start = Date.now()
  pull(
    db.stream({ seqs: false }),
    pull.drain(function (msg) {
      if (!(msg.timestamp > ts)) { t.fail('messages out of order') }
      ts = msg.timestamp
      _state = V.append(_state, null, msg.value)
      if (_state.error) throw _state.error
    }, function (err) {
      if (err) throw err
      t.equal(_state.queue.length, msgs.length)

      console.log('revalidate', N / ((Date.now() - start) / 1000))
      t.end()
    })
  )
})
