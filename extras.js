var pull = require('pull-stream')
var u = require('./util')
var stdopts = u.options
var Format = u.Format

module.exports = function (db, config, keys) {
  db
    .use('time', require('./indexes/time')())
    .use('feed', require('./indexes/feed')())
    .use('links', require('./indexes/links')())

  /* time index */
  db.createLogStream = function (opts) {
    opts = stdopts(opts)
    if (opts.raw) { return db.stream(opts) }

    var keys = opts.keys; delete opts.keys
    var values = opts.values; delete opts.values
    if (opts.gt == null) { opts.gt = 0 }

    return pull(
      db.time.read(opts),
      Format(keys, values, opts.private)
    )
  }

  /* via feed index */
  // TODO: eventually, this should filter out authors you do not follow.
  db.createFeedStream = db.feed.createFeedStream

  /* via links index */
  db.messagesByType = db.links.messagesByType
  db.links = db.links.links

  /* via last index */
  // NOTE this index is added in minimal.js
  db.latest = db.last.latest

  // used by sbot replication plugin
  db.latestSequence = function (id, cb) {
    db.last.get(function (err, val) {
      if (err) cb(err)
      else if (!val || !val[id]) cb(new Error('not found:' + id))
      else cb(null, val[id].sequence)
    })
  }

  db.getLatest = function (key, cb) {
    db.last.get(function (err, value) {
      if (err || !value || !value[key]) cb()
      // Currently, this retrives the previous message.
      // but, we could rewrite validation to only use
      // data the reduce view, so that no disk read is necessary.
      else {
        db.get(value[key].id, function (err, msg) {
        // will NOT expose private plaintext
          cb(err, { key: value[key].id, value: msg })
        })
      }
    })
  }

  return db
}
