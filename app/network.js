
var beacons = require('../beacons')
var blessed = require('blessed')

function length (o) {
  return Object.keys(o).length
}

module.exports = function (screen, sbs, config) {

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

  var emitter = beacons(sbs, config)

  var views = {}

  emitter.on('update', function (peer) {
    var id = peer.id.toString('hex')
    var view = views[id]
    var content = [
      'Id       :' + id.substring(0, 40)+'...',
      'address  :' + peer.address + ':' + peer.port,
      'timestamp:'+ peer.timestamp
      //known / unknown etc.
    ].join('\n')

    if(!views[id])
      views[id] = blessed.box({
        parent: networkBox,
        bg: known ? friend ? 'green' : 'yellow' : 'red',
        top: 1 + length(views)*5,
        left: 2, right: 2,
        height: 4,
        content: content
      })
    else
      views[id].content = content

    screen.render()
  })

}

if(!module.parent) {
  var screen = blessed.screen({smartCSR: true})
  module.exports(screen)

  screen.key('C-q', function () {
    process.exit(0)
  })

}
