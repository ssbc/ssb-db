var path = require('path')
var Flume = require('flumedb')
var OffsetLog = require('flumelog-offset')
//var LevelView = require('flumeview-level')
var codex = require('level-codec/lib/encodings')
var ViewLevel = require('flumeview-level')
module.exports = function (dir) {
  var log = OffsetLog(path.join(dir, 'log.offset'), 4096, codex.json)

  return Flume(log)
    .use('last', require('./indexes/last')())
    .use('keys', ViewLevel(1, function (data) {
      return [data.key]
    }))
    .use('clock', require('./indexes/clock')())
    .use('feed', require('./indexes/feed')())
    .use('links', require('./indexes/links')())
    .use('time', ViewLevel(1, function (data) {
      return [data.timestamp]
    }))
}



