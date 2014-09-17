
var Blake2s = require('blake2s')

exports.groups = function (done) {
  var n = 0, error = null, values = []
  var finished = false
  return function () {
    var i = n++
    var j = 1
    return function (err, value) {
      //should never happen
      if(--j) return n = -1, done(new Error('cb triggered twice'))
      if(err) return n = -1, done(error = err)
      values[i] = value
      setImmediate(function () {
        if(--n) return
        if(finished) throw new Error('finished twice!!!')
        finished = true
        done(null, values)
      })
    }
  }
}

exports.bsum = function (value) {
  if('string' === typeof value)
    return new Blake2s().update(value, 'utf8').digest()
  if(Buffer.isBuffer(value))
    return new Blake2s().update(value).digest()
  if(!value)
    return new Blake2s().digest()
}

exports.isHash = function (v) {
  return Buffer.isBuffer(v) && v.length === 32
}

exports.isInteger = function (v) {
  return !isNaN(v) && Math.round(v)===v
}

var isBuffer = Buffer.isBuffer
var isArray = Array.isArray
function isObject (o) { return o && 'object' === typeof o }

function isHash(h) { return isBuffer(h) && h.length == 32 }

var traverse = exports.traverse = function (obj, each) {
  if(Buffer.isBuffer(obj) || !isObject(obj)) return
  if(!isArray(obj)) each(obj)
  for(var k in obj) {
    if(isObject(obj[k])) traverse(obj[k], each)
  }
}

exports.indexLinks = function (msg, each) {
  traverse(msg, function (obj) {
    if(obj.$rel && (obj.$msg || obj.$ext || obj.$feed)) each(obj)
  })
}
