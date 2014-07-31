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
  source.add(cat([sbs.latest(), pull.once({okay: true})]))

  //sink: filter out metadata, and write the actual data.
  var sink = pull(
    pull.filter(function (data) {
      if(data.author) return true
      else if(u.isHash(data.id) && u.isInteger(data.sequence)) {
        source.add(sbs.createHistoryStream(data.id, data.sequence, opts.live))
      }
      else if(data && data.okay === true)
        source.cap()
    }),
    sbs.createWriteStream(cb)
  )

  return {
    source: pull(source, pvstruct.encode(codec)),
    sink: pull(pvstruct.decode(codec), sink)
  }
}
