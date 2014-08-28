'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')

module.exports = function (opts) {

  tape('simple', function (t) {

    var db = sublevel(level('test-ssb-feed', {
      valueEncoding: require('../codec')
    }))

    var ssb = require('../')(db, opts)

    var feed = ssb.createFeed(opts.keys.generate())

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      pull(
        ssb.createFeedStream(),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 2)
          console.log(ary)
          t.end()
        })
      )
    })

  })

  tape('tail', function (t) {

    var db = sublevel(level('test-ssb-feed2', {
      valueEncoding: require('../codec')
    }))

    var ssb = require('../')(db, opts)

    var feed = ssb.createFeed(opts.keys.generate())

    console.log('add 1'); console.log('add 2');
    var nDrains = 0, nAdds = 2;
    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      function addAgain() {
        feed.add('msg', 'message '+nDrains, function(err) {
          nAdds++;
          console.log('add', nAdds);
          if (err) throw err;
          if (nAdds > 7) {console.log('TIMEOUT'); throw 'Should have had 5 drains by now.';}
        });
      }
      var int = setInterval(addAgain, 300);
      pull(
        ssb.createFeedStream({ tail: true }),
        pull.drain(function (ary) {
          nDrains++;
          console.log('drain', nDrains)
          if (nDrains == 5) {
            t.assert(true);
            t.end()
            clearInterval(int);
          }
        })
      )
      addAgain();

    })

  })
}


if(!module.parent)
  module.exports(require('../defaults'))
