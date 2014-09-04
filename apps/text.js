var EventEmitter = require('events').EventEmitter
var msgpack = require('msgpack')

exports.name = 'text'

exports.options = {
  valueEncoding: 'binary'
}

exports.init = function(ssb, db) {
  var app = new EventEmitter()

  app.getPost = function(messageid, cb) {
    db.get(messageid, function(err, value) {
      if (err) return cb(err)
      var obj = msgpack.unpack(value)
      if (obj.plain) cb(null, obj.plain)
      else cb(new Error('Unrecognized text object'))
    })
  }

  app.post = function(feed, text, cb) {
    if (!text || typeof text != 'string')
      return cb(new Error('must provide text to post'))
    feed.add('text', msgpack.pack({plain: text}), cb)
  }

  ssb.pre(function (op, add) {
    if('put' !== op.type) return
    if(op.value.type.toString() !== 'text') return
    add({ key: op.key, prefix: db, value: op.value.message })
  })

  return app
}