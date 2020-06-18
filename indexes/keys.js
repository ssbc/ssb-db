var ViewLevel = require('flumeview-level')

module.exports = function () {
  return ViewLevel(4, (msg) => [ msg.key ])
}
