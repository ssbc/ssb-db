var views = require('./views')
var proquint = require('proquint-')
var d64 = require('d64')
var blessed = require('blessed')
var pull = require('pull-stream')
var dateFormat = require('dateformat')
var feed = module.exports = function (screen, sbs, config) {

var dots = '.............................................'

  var feedBox = blessed.box({
    parent: screen,
    bg: 'green',
    left:'center', top:'center',
    width: '99%',
    height: '80%',

    //scroll doesn't work unless there is a border.
    border: 'ascii',
    scrollable: true,
    scrollbar: {
      ch: '*',
      inverse: true
    },
    alwaysScroll: true,
    keys: true
  })

  feedBox.focus()

  var textarea = blessed.textarea({
    width: '80%',
    height: '60%',
    left: 'center', top: 'center',
    bg: 'blue',
    keys: true, mouse: true
  })
  var reading = false

  textarea.key(['C-`', 'C-s'], function () {
    if(!reading) return

    console.error('writing:', textarea.getValue())

    textarea.detach()
    screen.focusPop()
    screen.render()

    var message = new Buffer(textarea.getValue())

    sbs
      .message('message', message, [], function (err, msg) {
        if(err) throw err
        console.error('wrote', msg)
        reading = false
      })
  })

  screen.key('enter', function () {
    reading = true
    screen.append(textarea)
    screen.saveFocus()
    textarea.readInput(function () { })
    screen.render()
  })

  var top = 0

  pull(
    sbs.createFeedStream({live: true}),
    pull.drain(function (msg) {

      console.error('APPEND', msg)

      var author = proquint
        .encodeCamelDash(msg.author).substring(0, 21)
      var type = msg.type.toString('utf8')

      var label = author + '/' + msg.sequence + ' : ' + type
      var content

      if(Object.hasOwnProperty.call(views, type)) {
        content = views[type](msg, sbs, {})
      }
      else {
        content = (
          msg.author.toString('hex')
          + ':' + msg.sequence + '\n'
        )
      }

      content = content
        .split('\n')
        .map(function (e) { return '  ' + e })
        .join('\n')

        .replace(/\s+$/g, '')
      var height = content.split('\n').length + 2

      var wrapper = blessed.box({
        content:
          label + dots.substring(label.length)
        + dateFormat(msg.timestamp, 'yyyy-mm-dd hh:mm:ss')
        + '\n' + content,
        width: 70, left: 2, top: top, height: height
      })

      top += height

      console.error(msg.author.toString('hex'), msg.sequence)
      console.error(msg.message.toString('utf8'))

//      var content = blessed.text({parent: wrapper, top: 2, left: 2})

      feedBox.append(wrapper)
      feedBox.focus()
      screen.render()

    }, function (err) {
      if(err) throw err
      console.error('ENDENDEND')
    })
  )

}


if(!module.parent) {

  var init = require('../init')
  var config = require('../config')
  var sbs = init(config)

  var screen = blessed.screen({smartCSR: true})
  var network = require('../network')
  var n = feed(screen, sbs, config)

  screen.key(['C-q', 'C-c'], function () {
    process.exit(0)
  })
}
