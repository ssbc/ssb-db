var createSSB = require('../create')
var tape = require('tape')

var ssb = createSSB('/tmp/text-test')
var text = ssb.addApp(require('../apps/text'))

var alice = ssb.createFeed()

tape('post', function (t) {

  text.post(alice, 'Hello World', function(err, msg, id) {
    if (err) throw err
    console.log('posted', id)
    text.getPost(id, function(err, text) {
      if (err) throw err
      t.equal(text, 'Hello World')
      t.end()
    })
  })
})

