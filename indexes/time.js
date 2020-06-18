var ViewLevel = require('flumeview-level')

module.exports = function () {
  return ViewLevel(3, function (data) {
    return [data.timestamp]
  })
}
