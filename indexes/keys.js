const Reduce = require('flumeview-reduce')

module.exports = function () {
  const createIndex = Reduce(1, function (acc, data, seq) {
    if (!acc) acc = {}
    acc[data.key] = seq
    return acc
  })

  return function (log, name) {
    const index = createIndex(log, name)
    const get = index.get
    index.get = function (key, cb) {
      get(function (err, value) {
        if(err) cb(err)
        else if(!value || value[key] == null) cb(new Error('not found:'+key))
        else log.get(value[key], cb)
      })
    }
    console.log(index)
    return index
  }
}










