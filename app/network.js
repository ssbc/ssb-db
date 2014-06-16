var u = require('../util')
var blessed = require('blessed')
var network = require('../network')

function length (o) {
  return Object.keys(o).length
}

module.exports = function (screen, sbs, config) {

  var me = sbs.feed(sbs.id)

  known = false; friend = false

  var networkBox = blessed.box({
    bg: 'green',
    left:'center', top:'center',
    width: '80%',
    height: '80%',
    parent: screen,
    scrollable: true
  })

  networkBox.prepend(blessed.text({
    left: 2, content: 'Local Network'
  }))

  if (screen.autoPadding) {
    var list = networkBox
    list.children[0].rleft = -list.ileft + 2;
    list.children[0].rtop = -list.itop;
  }

  screen.render()

  var emitter = network(sbs, config)

  var views = {}

  emitter.on('update', function (peer) {
    var id = peer.id.toString('hex')
    if(id === sbs.id.toString('hex')) return

    var view = views[id]
    var content = [
      'Id       :' + id.substring(0, 40)+'...',
      'address  :' + peer.address + ':' + peer.port,
      'timestamp:'+ peer.timestamp
      //known / unknown etc.
    ].join('\n')

    if(!views[id]) {
      views[id] = blessed.box({
        parent: networkBox,
        bg: known ? friend ? 'green' : 'yellow' : 'red',
        top: 1 + length(views)*5,
        left: 2, right: 2,
        height: 4,
        content: content
      })

      var following = false

      var check = blessed.checkbox({
          bottom: 0, height: 2, right: 2, width: 10,
          bg: 'magenta',
          content: 'follow', keys: true, mouse: true
        })

      sbs.isFollowing(sbs.id, peer.id, function (err, follows) {
        if(follows) return following = true
        check.check(true)
      })

      check.on('check', function () {
        if(following) return
        console.error('check!')
        sbs.follow(peer.id, function (err) {
          check.setContent('following')
        })
      })

      check.on('uncheck', function () {
        check.check(true)
      })

      views[id].append(check)
    }
    else
      views[id].content = content

    screen.render()
  })

  return networkBox

}

if(!module.parent) {
  var screen = blessed.screen({smartCSR: true})
  var init = require('../init')
  var config = require('../config')
  var sbs = init(config)
  var network = require('../network')
  var n = network(sbs, config)

  module.exports(screen, sbs)

  screen.key(['C-q', 'C-c'], function () {
    process.exit(0)
  })

}
