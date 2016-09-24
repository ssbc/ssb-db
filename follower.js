var pull = require('pull-stream')
var Level = require('level')
var bytewise = require('bytewise')
var Write = require('pull-write')
var pl = require('pull-level')
var defer = require('pull-defer')

module.exports = function (_db, path, version, map) {
  var db = create(path), writer

  var META = '\x00', since

  var written = 0, waiting = [], closed

  function create(path) {
    closed = false
    return Level(path, {keyEncoding: bytewise, valueEncoding: 'json'})
  }

  function await(ready) {
    _db.seen.await(function () {
      if(_db.seen.get() === since) return ready()
      waiting.push({ts: _db.seen.get(), cb: ready})
    })
  }

  function close (cb) {
    closed = true
    //todo: move this bit into pull-write
    if(writer)
      writer.abort(function () {
        db.close(cb)
      })
    else db.close(cb)
  }


  function build (rebuild, cb) {
    since = undefined
    if(rebuild)
      destroy()
    else
      db.get(META, {keyEncoding: 'utf8'}, function (err, value) {
        since = value && value.since || 0
        if(err) // new database
          next()
        else if (value.version !== version) destroy()
        else
          next()
      })

    function destroy () {
      close(function () {
        Level.destroy(path, function (err) {
          if(err) throw err //just die?
          db = create(path)
          since = 0
          next()
        })
      })
    }

    function next () {
      while(waiting.length && waiting[0].ts <= since) {
        waiting.shift().cb()
      }
      if(closed) return

      pull(
        _db.createLogStream({gt: since, live: true, sync: false}),
        writer = Write(function (batch, cb) {
          if(closed) return cb(new Error('database closed while index was building'))
          db.batch(batch, function (err) {
            if(err) return cb(err)
            since = batch[0].value.since
            //callback to anyone waiting for this point.
            while(waiting.length && waiting[0].ts <= since) {
              waiting.shift().cb()
            }
            cb()
          })
        }, function reduce (batch, data) {
          if(data.sync) return batch
          var ts = data.ts || data.timestamp

          if(!batch)
            batch = [{
              key: META,
              value: {version: version, since: ts},
              valueEncoding: 'json', keyEncoding:'utf8', type: 'put'
            }]

          batch = batch.concat(map(data))
          batch[0].value.since = Math.max(batch[0].value.since, ts)
          return batch
        }, 512, cb)
      )
    }
  }

  build(null, function (err) {})

  return {
    get: function (key, cb) {
      //wait until the log has been processed up to the current point.
      await(function () {
        db.get(key, cb)
      })
    },
    await: await,
    read: function (opts) {
      opts = opts || {}
      if(since === _db.seen.get()) return pl.read(db, opts)

      var source = defer.source()
      await(function () {
        source.resolve(pl.read(db, opts))
      })
      return source
    },
    rebuild: function (cb) {
      build(true, cb)
    },
    close: close,
    //put, del, batch - leave these out for now, since the indexes just map.
  }

}



