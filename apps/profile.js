var EventEmitter = require('events').EventEmitter
var msgpack = require('msgpack')

exports.name = 'profile'

exports.options = {
  valueEncoding: 'json'
}

exports.init = function(ssb, db) {
  var app =  new EventEmitter()

  app.getProfile = function(userid, cb) {
    db.get([userid, 'profile'], cb)
  }

  app.lookupByNickname = function(nickname, cb) {
    // Scan for multiple hits because nicknames are not unique
    var ids = []
    nickname = nickname.toLowerCase()
    db.createReadStream()
      .on('data', function(item) {
        if (item.value.nickname.toLowerCase() == nickname)
          ids.push(item.key[0])
      })
      .on('end', function() {
        cb(null, ids)
      })
  }

  app.setNickname = function (feed, name, cb) {
    app.getProfile(feed.id, function(err, profile) {
      // if (err) :TODO: non key-not-found errors
      profile = profile || {nickname: null}
      profile.nickname = name
      feed.add('profile', msgpack.pack(profile), cb)
    })
  }

  ssb.pre(function (op, add) {
    if('put' !== op.type) return
    if(op.value.type.toString() !== 'profile') return
    var profile = msgpack.unpack(op.value.message)
    add({ key: [op.value.author, 'profile'], prefix: db, value: profile })
  })

  return app
}