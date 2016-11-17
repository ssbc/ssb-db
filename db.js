var path = require('path')
var Flume = require('flumedb')
var OffsetLog = require('flumelog-offset')
//var LevelView = require('flumeview-level')
var codex = require('level-codec/lib/encodings')

module.exports = function (dir) {
  var log = OffsetLog(path.join(dir, 'log.offset'), 4096, codex.json)

  return Flume(log)
    .use('last', require('./indexes/last')())
    .use('keys', require('flumeview-level')(1, function (data) {
      return [data.key]
    }))
    .use('clock', require('./indexes/clock')())
    .use('feed', require('./indexes/feed')())
    .use('links', require('./indexes/links')())

}



