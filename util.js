
var Blake2s = require('blake2s')

exports.groups = function (done) {
  var n = 0, error = null, values = []
  return function () {
    var i = n++
    var j = 1
    return function (err, value) {
      //should never happen
      if(--j) return n = -1, done(new Error('cb triggered twice'))
      if(err) return n = -1, done(error = err)
      values[i] = value
      if(--n) return
      done(null, values)
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

