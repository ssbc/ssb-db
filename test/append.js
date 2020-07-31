var V = require('ssb-validate')
const tape = require('tape')
var ssbKeys = require('ssb-keys')
var pull = require('pull-stream')
var explain = require('explain-error')
var timestamp = require('monotonic-timestamp')
const createSsb = require('./util/create-ssb')
const { promisify } = require('util')

var minimal = require('../minimal')

var keys = ssbKeys.generate()
var dirname = '/tmp/test_ssb_append' + Date.now()

var K = [keys]
for (var i = 0; i < 100; i++) K.push(ssbKeys.generate())

var a
var db = a = minimal(dirname, keys)
db.ready.set(true)
var MSG
tape('append (setup)', function (t) {
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

tape('append (generate)', function (t) {
  var start = Date.now()
  var l = N
  state = V.append(state, null, MSG.value)

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

tape('append (loads)', function (t) {
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

tape('append (read back)', function (t) {
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

// If you write faster than the database can save messages, it adds them to
// some kind of queue, which eventually gets 'flushed'. In the past there was a
// bug where publishing more than 1000 messages very quickly would cause a
// problem where some messages would come back as `undefiend` rather than the
// usual `{ key, value }`. This test adds a bunch of messages very quickly and
// ensures that the callback contains the correct data.
tape('append (bulk)', (t) => {
  const ssb = createSsb()

  // We write 7919 messages, which should be bigger than any cache. It's also a
  // prime number and shouldn't line up perfectly with any batch sizes.
  const messages = 7919

  const assertsPerMessage = 4
  const plan = messages * assertsPerMessage
  var pass = 0

  function testEqual (a, b) {
    if (a !== b) {
      process.stdout.write('\n')
      t.equal(a, b)
      return
    }
    pass += 1
  }

  Promise.all([...new Array(messages)].map(async (_, i) => {
    const entry = await promisify(ssb.publish)({ type: 'test' })
    process.stdout.write('.')

    testEqual(typeof entry, 'object')
    testEqual(typeof entry.key, 'string')
    testEqual(typeof entry.value, 'object')
    testEqual(entry.value.sequence, i + 1)
  })).then(() => {
    process.stdout.write('\n')
    t.equal(pass, plan, 'passed all tests')
    ssb.close(t.end)
  })
})
