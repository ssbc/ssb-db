  var screen = blessed.screen({smartCSR: true})
  var init = require('../init')
  var config = require('../config')
  var sbs = init(config)
  var network = require('../network')
  var n = network(sbs, config)

  screen.key(['C-q', 'C-c'], function () {
    process.exit(0)
  })

module.exports = screen
