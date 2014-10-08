var pull = require('pull-stream')
var many = require('pull-many')
var cat  = require('pull-cat')
var codec = require('./codec')
var pvstruct = require('pull-varstruct')

function ratio(a, b) {
  if(a === 0 && b === 0) return 1
  return a / b
}


function isInteger (v) {
  return !isNaN(v) && Math.round(v)===v
}


module.exports = function (ssb, opts, cb) {
  if('function' === typeof opts)
    cb = opts, opts = {}

  if('function' !== typeof cb)
    throw new Error('cb must be function')

  var sbs = ssb

  isHash = ssb.opts.isHash

  var progress = opts.progress || function () {}
  opts = opts || {}
  var expected = {}
  var source = many()

  var latestStream = opts.latest
    ? pull(
        opts.latest(),
        ssb.createLatestLookupStream()
      )
    : ssb.latest()

  //source: stream {id: hash(pubkey), sequence: latest}
  //pairs, then {okay: true} to show you are at the end.

  function get (id) {
    var id = id.toString('base64')
    return expected[id] = expected[id] || {me: -1, you: -1, recv: 0, sent: 0}
  }

  var needRecv = 0, needSend = 0, sent = 0, recv = 0

  function complete() {
    needRecv = 0, needSend = 0, sent = 0, recv = 0
    for(var k in expected) {
      var item = expected[k]
      //if one of us does not need this author, ignore.

      if(!(item.me === -1 || item.you === -1)) {
        // we are already in sync.
        if(item.me === item.you)
          ;
        else if (item.me > item.you) {
          needSend += item.me - item.you
          sent += item.sent
        }
        else if (item.you > item.me) {
          needRecv += item.you - item.me
          recv += item.recv
        }
      }
    }

    progress(ratio(sent, needSend), ratio(recv, needRecv))

    if(needRecv - recv === 0 && needSend - sent === 0) {
      return true
    }
  }

  var n = 2
  function checkEmpty () {
    if(--n) return
    if(complete()) source.cap()
  }

  function once () {
    var done = false
    return function (abort, cb) {
      if(done) return cb(true)
      done = true
      checkEmpty()
      cb(abort, {okay: true})
    }
  }

  source.add(cat([
    pull(
      latestStream,
      pull.through(function (data) {
        get(data.id).me = data.sequence
      })
    ),
    //when all the requests are sent, send a marker,
    //so we can detect if the instances are already in sync.
    once()
  ]))

  //track how many more messages we expect to see.
  //TODO: expose progress information, to send and to receive.

  var sink = pull(
    pull.filter(function (data) {
      if(data.author) return true
      else if(isHash(data.id) && isInteger(data.sequence)) {
        get(data.id).you = data.sequence
        source.add(
          pull(
            sbs.createHistoryStream(data.id, data.sequence + 1, opts.live),
            pull.through(function (data) {
              get(data.author).sent ++
              if(complete()) source.cap()
            })
          )
        )
      }
      else if(data.okay) checkEmpty()

    }),
    pull(
      pull.through(function (msg) {
        get(msg.author).recv ++
        if(complete()) source.cap()
      }),
      sbs.createWriteStream(function (err) {
        cb(err, sent, recv, expected)
      })
    )
  )

  return {
    source: pull(source, pvstruct.encode(codec)),
    sink: pull(pvstruct.decode(codec), sink)
  }
}

