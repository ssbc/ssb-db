var path = require('path')

module.exports = require('rc')('ssb', {
  port: 5656,
  rpcPort: 5657,
  path: path.join(process.env.HOME, '.ssb')
})
