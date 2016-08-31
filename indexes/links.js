var ref       = require('ssb-ref')
var path      = require('path')
var Follower  = require('../follower')
var pull      = require('pull-stream')
var ltgt      = require('ltgt')
var ssbKeys   = require('ssb-keys')
var paramap   = require('pull-paramap')

//53 bit integer
var MAX_INT  = 0x1fffffffffffff
var u = require('../util')

var mlib = require('ssb-msgs')

function isString (s) {
  return 'string' === typeof s
}

module.exports = function (db, keys) {

  function indexMsg (add, localtime, id, msg) {
    //DECRYPT the message, if possible
    //to enable indexing. If external apis
    //are not provided that may access indexes
    //then this will not leak information.
    //otherwise, we may need to figure something out.

    var content = (keys && isString(msg.content))
      ? ssbKeys.unbox(msg.content, keys)
      : msg.content

    if(!content) return

    if(isString(content.type))
      add({
        key: ['type', content.type.toString().substring(0, 32), localtime],
        value: id, type: 'put'
      })

    mlib.indexLinks(content, function (obj, rel) {
      add({
        key: ['link', msg.author, rel, obj.link, msg.sequence, id],
        value: obj,
        type: 'put'
      })
      add({
        key: ['_link', obj.link, rel, msg.author, msg.sequence, id],
        value: obj,
        type: 'put'
      })
    })
  }


  var indexPath = path.join(db.location, 'links')
  var index = Follower(db, indexPath, 1, function (data) {
    if(data.sync) return
    var msg = data.value
    var id = data.key

    var a = []
    indexMsg(function (op) { a.push(op) }, data.timestamp, id, msg)
    return a
  })

  index.messagesByType = function (opts) {
    if(!opts)
      throw new Error('must provide {type: string} to messagesByType')

    if(isString(opts))
      opts = {type: opts}

    opts = u.options(opts)
    var _keys   = opts.keys
    var _values = opts.values
    opts.values = true

    ltgt.toLtgt(opts, opts, function (value) {
      return ['type', opts.type, value]
    }, u.lo, u.hi)

    return pull(
      index.read(opts),
      paramap(function (data, cb) {
        if(data.sync) return cb()
        var id = _keys ? data.value : data
        db.get(id, function (err, msg) {
          var ts = opts.keys ? data.key[2] : undefined
          cb(null, u.format(_keys, _values, {key: id, ts: ts, value: msg}))
        })
      }),
      pull.filter()
    )
  }

  return index

}

