const HLRU = require('hashlru')
const { metaBackup } = require('./util')
const cloneDeep = require('lodash.clonedeep')

function isFunction (f) { return typeof f === 'function' }
function isString (s) { return typeof s === 'string' }

function box (content, boxers, feedState) {
  if (!content.recps) return content

  if (typeof content.recps === 'string') content.recps = [content.recps]
  if (!Array.isArray(content.recps)) throw new Error('private message field "recps" expects an Array of recipients')
  if (content.recps.length === 0) throw new Error('private message field "recps" requires at least one recipient')

  var ciphertext
  for (var i = 0; i < boxers.length; i++) {
    const boxer = boxers[i]
    ciphertext = boxer(content, feedState)

    if (ciphertext) break
  }
  if (!ciphertext) throw RecpsError(content.recps)

  return ciphertext
}

function RecpsError (recps) {
  return new Error(
    'private message requested, but no boxers could encrypt these recps: ' +
    JSON.stringify(recps)
  )
}

function unbox (msg, readKey, unboxers) {
  if (!msg || !isString(msg.value.content)) return msg

  var plain
  for (var i = 0; i < unboxers.length; i++) {
    const unboxer = unboxers[i]

    if (isFunction(unboxer)) {
      plain = unboxer(msg.value.content, msg.value)
    }
    else {
      if (!readKey) readKey = unboxer.key(msg.value.content, msg.value)
      if (readKey) plain = unboxer.value(msg.value.content, msg.value, readKey)
    }
    if (plain) break
  }

  if (!plain) return msg
  return decorate(msg, plain)

  function decorate (msg, plain) {
    var value = {}
    for (var k in msg.value) { value[k] = msg.value[k] }

    // set `meta.original.content`
    value.meta = metaBackup(value, 'content')

    // modify content now that it's saved at `meta.original.content`
    value.content = plain

    // set meta properties for private messages
    value.meta.private = true
    if (readKey) { value.meta.unbox = readKey.toString('base64') }

    // backward-compatibility with previous property location
    // this property location may be deprecated in favor of `value.meta`
    value.cyphertext = value.meta.original.content
    value.private = value.meta.private
    if (readKey) { value.unbox = value.meta.unbox }

    return {
      key: msg.key,
      value,
      timestamp: msg.timestamp
    }
  }
}

/* NOTE
 * currently when flumedb passes messages to each view (index) it runs
 * an unbox on encrypted messaged FOR EVERY VIEW
 *
 * This is a temporary easy solution to reduce some wasted CPU cycles
 * without having to change deep things about flumedb
 */
const CACHE_SIZE = 512
// at max, this cache would be ~4MB (may be larger with meta opts attached)
// but in reality many messages are much smaller than 8kB,
// and this cache tracks messages it can't unbox as `false` which is useful
// and takes up ~0kB

function unboxWithCache (id) {
  var cache = HLRU(CACHE_SIZE)

  function cachedUnbox (msg, readKey, unboxers) {
    if (!msg || !isString(msg.value.content)) return msg

    const cached = cache.get(msg.key)

    if (cached === false && !readKey) return msg
    else if (cached) return cloneDeep(cached)

    const result = unbox(msg, readKey, unboxers)
    if (isString(result.value.content)) cache.set(msg.key, false)
    else cache.set(msg.key, result)

    return result
  }

  cachedUnbox.resetCache = function () {
    cache = HLRU(CACHE_SIZE)
  }

  return cachedUnbox
}
unbox.withCache = unboxWithCache

module.exports = {
  box,
  unbox
}
