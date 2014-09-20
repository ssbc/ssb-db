module.exports =
  function (done) {
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

