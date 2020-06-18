var ViewLevel = require('flumeview-level')

module.exports = function () {
  return ViewLevel(3, data => [data.timestamp])
}
