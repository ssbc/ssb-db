var ViewHashTable = require('flumeview-hashtable')

module.exports = function (dir, keys, opts) {
  var db = require('./minimal')(dir, keys, opts)

    .use('keys', ViewHashTable(2, function (key) {
      var b = Buffer.from(key.substring(1, 7), 'base64').readUInt32BE(0)
      return b
    })
    )
    .use('clock', require('./indexes/clock')())

  db.progress = {}
  var prog = db.progress.indexes = {
    start: 0,
    current: 0,
    target: 0
  }
  var ts = Date.now()

  db.since(function () {
    prog.target = db.since.value
    if (Date.now() > ts + 100) { update() }
  })

  function update () {
    ts = Date.now()
    // iterate over the current views, so we capture plugins
    // as well as the built ins.
    var current = 0
    var n = 0
    for (var k in db) {
      if (db[k] && typeof db[k].since === 'function') {
        n++
        var c = db[k].since.value
        current += (Number.isInteger(c) ? c : -1)
      }
    }
    prog.current = ~~(current / n)
    // if the progress bar is complete, move the starting point
    // up to the current position!
    if (prog.start <= 0) {
      prog.start = prog.current
    } else if (prog.current === prog.target) {
      prog.start = prog.target
    }
  }

  // unref is only available when running inside node
  var timer = setInterval(update, 200)
  timer.unref && timer.unref()

  return db
}
