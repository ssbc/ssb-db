var pull = require('pull-stream')
var many = require('pull-many')
var cat  = require('pull-cat')
var u    = require('./util')
var codec = require('./codec')
var pvstruct = require('pull-varstruct')

module.exports = function (sbs, opts, cb) {
  if('function' === typeof opts)
    cb = opts, opts = {}

  var progress = opts.progress || function () {}

  opts = opts || {}

  var expected = {}

  var source = many()

  //source: stream {id: hash(pubkey), sequence: latest}
  //pairs, then {okay: true} to show you are at the end.

  function get (id) {
    var id = id.toString('base64')
    return expected[id] = expected[id] || {me: -1, you: -1, recv: 0, sent: 0}
  }

  function complete() {
    var needRecv = 0
    var needSend = 0
    var sent = 0, recv = 0
    for(var k in expected) {
      var item = expected[k]
        //if one of us does not need this author, ignore.
        //console.log(item)

      if(!(item.me === -1 || item.you === -1)) {
        // we are already in sync.
        if(item.me === item.you)
          ;
        else if (item.me > item.you) {
          needSend += item.me - item.you
          sent +=item.sent
        }
        else if (item.you > item.me) {
          needRecv += item.you - item.me
          recv += item.recv
        }
      }
    }

    progress(sent / needSend, recv / needRecv)
    if(needRecv - recv === 0 && needSend - sent === 0) {
      return true
    }
  }

  source.add(cat([
    pull(
      sbs.latest(),
      pull.through(function (data) {
        get(data.id).me = data.sequence
      })
    ),
    pull.once({okay: true})
  ]))

  //track how many more messages we expect to see.
  //TODO: expose progress information, to send and to receive.

  var sink = pull(
    pull.filter(function (data) {
      if(data.author) return true
      else if(u.isHash(data.id) && u.isInteger(data.sequence)) {
        get(data.id).you = data.sequence
        source.add(
          pull(
            sbs.createHistoryStream(data.id, data.sequence + 1, opts.live),
            pull.through(function (data) {
              get(data.author).sent = data.sequence
              if(complete()) source.cap()
            })
          )
        )
      }
    }),
    pull(
      pull.through(function (msg) {
        get(msg.author).recv = msg.sequence
        if(complete()) source.cap()
      }),
      sbs.createWriteStream(cb)
    )
  )

  return {
    source: pull(source, pvstruct.encode(codec)),
    sink: pull(pvstruct.decode(codec), sink)
  }
}
