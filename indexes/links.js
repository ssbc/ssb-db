var pull = require('pull-stream')
var ltgt = require('ltgt')
var ViewLevel = require('flumeview-level')

var u = require('../util')
var Format = u.formatStream
var mlib = require('ssb-msgs')

function isString (s) {
  return typeof s === 'string'
}

module.exports = function () {
  function indexMsg (localtime, id, msg) {
    var content = msg.content

    // couldn't decrypt, this message wasn't for us
    if (isString(content)) return []

    var a = []

    if (isString(content.type)) {
      a.push(['type', content.type.toString().substring(0, 32), localtime])
    }
    mlib.indexLinks(content, function (obj, rel) {
      a.push(['link', msg.author, rel, obj.link, msg.sequence, id])
      a.push(['_link', obj.link, rel, msg.author, msg.sequence, id])
    })

    return a
  }

  var createIndex = ViewLevel(2, function (data) {
    return indexMsg(data.timestamp, data.key, data.value)
  })

  return function (log, name) {
    var index = createIndex(log, name)

    index.methods = {
      messagesByType: 'source',
      links: 'source'
    }

    index.messagesByType = function (opts) {
      if (!opts) { throw new Error('must provide {type: string} to messagesByType') }

      if (isString(opts)) { opts = { type: opts } }

      opts = u.options(opts)
      var keys = opts.keys !== false
      var values = opts.values !== false
      opts.values = true

      ltgt.toLtgt(opts, opts, function (value) {
        return ['type', opts.type, value]
      }, u.lo, u.hi)

      return pull(
        index.read(opts),
        Format(keys, values, opts.private)
      )
    }

    function format (opts, op, key, value) {
      var meta = opts.meta !== false // default: true
      var keys = opts.keys !== false // default: true
      var vals = opts.values === true // default: false
      if (!meta && !keys && !vals) {
        throw new Error('a stream without any values does not make sense')
      }
      if (!meta) {
        return (
          keys && vals ? { key: op.key, value: value }
            : keys ? op.key
              : value
        )
      } else {
        if (vals) {
          if (opts.private === true) {
            op.value = value
          } else {
            op.value = u.originalValue(value)
          }
        }
        if (!keys) delete op.key
        delete op._value
        return op
      }
    }

    function type (t) { return { feed: '@', msg: '%', blob: '&' }[t] || t }

    function linksOpts (opts) {
      if (!opts) throw new Error('opts *must* be provided')

      if (!(opts.values === true) &&
        !(opts.meta !== false) &&
        !(opts.keys !== false)
      ) {
        throw new Error('makes no sense to return stream without results' +
          'set at least one of {keys, values, meta} to true')
      }

      var src = type(opts.source)
      var dst = type(opts.dest)
      var rel = opts.rel

      var back = dst && !src
      var from = back ? dst : src
      var to = back ? src : dst

      function range (value, end, def) {
        return !value ? def : /^[@%&]$/.test(value) ? value + end : value
      }
      function lo (value) { return range(value, '', u.lo) }
      function hi (value) { return range(value, '~', u.hi) }

      var index = back ? '_link' : 'link'
      var gte = [index, lo(from), rel || u.lo, lo(to), u.lo, u.lo]
      var lte = [index, hi(from), rel || u.hi, hi(to), u.hi, u.hi]
      return {
        gte: gte,
        lte: lte,
        reverse: opts.reverse,
        back: back,
        rel: rel,
        source: src,
        dest: dst,
        live: opts.live,
        sync: opts.sync,
        old: opts.old,
        props: {
          keys: opts.keys !== false, // default: true
          meta: opts.meta !== false, // default: true
          values: opts.values === true // default: false
        }
      }
    }

    function testLink (a, e) { // actual, expected
      return e ? e.length === 1 ? a[0] === e[0] : a === e : true
    }

    index.links = function (opts) {
      opts = linksOpts(opts)
      return pull(
        index.read(opts),
        pull.map(function (op) {
          if (op.sync) return op
          return {
            source: op.key[opts.back ? 3 : 1],
            rel: op.key[2],
            dest: op.key[opts.back ? 1 : 3],
            key: op.key[5],
            _value: op.value.value
            // timestamp: op.value.timestamp
          }
        }),
        // in case source and dest are known but not rel,
        // this will scan all links from the source
        // and filter out those to the dest. not efficient
        // but probably a rare query.
        pull.filter(function (data) {
          if (data.sync) return true
          if (opts.rel && opts.rel !== data.rel) return false
          if (!testLink(data.dest, opts.dest)) return false
          if (!testLink(data.source, opts.source)) return false
          return true
        }),
        pull.map(function (op) {
          if (op.sync) return op
          return format(opts.props, op, op.key, op._value)
        })
      )
    }

    return index
  }
}
