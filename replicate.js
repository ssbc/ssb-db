var pull = require('pull-stream')
var many = require('pull-many')
var cat  = require('pull-cat')
var u    = require('./util')
var codec = require('./codec')
var pvstruct = require('pull-varstruct')

module.exports = function (sbs, opts, cb) {
  if('function' === typeof opts)
    cb = opts, opts = {}

  opts = opts || {}

  var source = many()

  //source: stream {id: hash(pubkey), sequence: latest}
  //pairs, then {okay: true} to show you are at the end.
  source.add(sbs.latest())

  //track how many more messages we expect to see.
  //TODO: expose progress information, to send and to receive.
  var expected = {}
  function remember(id, seq) {
    expected[id.toString('base64')] = seq
  }
  function check(id, seq) {
    return expected[id.toString('base64')] == seq
  }

  var n = 0
  var sink = pull(
    pull.filter(function (data) {
      if(data.author) return true
      else if(u.isHash(data.id) && u.isInteger(data.sequence)) {
        remember(data.id, data.sequence)
        n++
        source.add(
          sbs.createHistoryStream(data.id, data.sequence + 1, opts.live)
        )
      }
    }),
    pull(
      pull.through(function (msg) {
        if(check(msg.author, msg.sequence)) {
          n--
          if(n === 0) source.cap()
        }
      }),
      sbs.createWriteStream(cb)
    )
  )

  return {
    source: pull(source, pvstruct.encode(codec)),
    sink: pull(pvstruct.decode(codec), sink)
  }
}
