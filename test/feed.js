'use strict'
var tape     = require('tape')
var level    = require('level-test')()
var sublevel = require('level-sublevel/bytewise')
var pull     = require('pull-stream')
var ssbKeys  = require('ssb-keys')
var createFeed = require('ssb-feed')
var multicb  = require('multicb')

module.exports = function (opts) {

  tape('simple', function (t) {

    var db = sublevel(level('test-ssb-feed', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    console.log(opts)
    var feed = createFeed(ssb, opts.generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      t.assert(!!msg)
      t.assert(!!msg.key)
      t.assert(!!msg.value)
      pull(
        ssb.createFeedStream(),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 2)
          t.assert(!!ary[0].key)
          t.assert(!!ary[0].value)
          t.assert(!!ary[1].key)
          t.assert(!!ary[1].value)
          console.log(ary)
          t.end()
        })
      )
    })

  })

  tape('tail', function (t) {

    var db = sublevel(level('test-ssb-feed2', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var feed = createFeed(ssb, opts.generate(), opts)

    console.log('add 1'); console.log('add 2');
    var nDrains = 0, nAdds = 2;
    feed.add('msg', 'hello there!', function (err, msg1, lasthash) {
      if(err) throw err
      function addAgain() {
        feed.add('msg', 'message '+nDrains, function(err, msgX, hashX) {
          if(err) throw err
          t.equal(msgX.previous, lasthash)
          console.log(msgX.previous, lasthash)
          lasthash = hashX;
          nAdds++;
          console.log('add', nAdds);
          if (err) throw err;
          if (nAdds > 7) {
            console.log('TIMEOUT');
            throw new Error('Should have had 5 drains by now.');
          }
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

  tape('tail, parallel add', function (t) {

    var db = sublevel(level('test-ssb-feed3', {
      valueEncoding: opts.codec
    }))

    var ssb = require('../')(db, opts)

    var feed = createFeed(ssb, opts.generate(), opts)

    console.log('add 1'); console.log('add 2');
    var nDrains = 0, nAdds = 2, l = 7
    feed.add('msg', 'hello there!', function (err, msg1, lasthash) {
      if(err) throw err

      function addAgain() {
        console.log('ADD')
        feed.add('msg', 'message '+nDrains, function(err, msgX, hashX) {
          t.equal(msgX.previous, lasthash)
          console.log(msgX.previous, lasthash)
          lasthash = hashX;
          nAdds++;
          console.log('add', nAdds);
          if (err) throw err;
          if (nAdds > 7) {
 //           console.log('TIMEOUT')
//            throw new Error('Should have had 5 drains by now.')
          }
        });
        if(--l) addAgain()
      }

      pull(
        ssb.createFeedStream({ tail: true }),
        pull.drain(function (ary) {
          nDrains++;
          console.log('drain', nDrains)
          if (nDrains == 5) {
            t.assert(true);
            t.end()
          }
        })
      )
      addAgain();
    })
  })

  tape('keys only', function (t) {
    var db = sublevel(level('test-ssb-feed5', {
      valueEncoding: opts.codec
    }))
    var ssb = require('../')(db, opts)
    var feed = createFeed(ssb, opts.generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      t.assert(!!msg)
      pull(
        ssb.createFeedStream({ values: false }),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 2)
          t.ok(typeof ary[0] == 'string')
          t.ok(typeof ary[1] == 'string')
          console.log(ary)
          t.end()
        })
      )
    })
  })

  tape('values only', function (t) {
    var db = sublevel(level('test-ssb-feed6', {
      valueEncoding: opts.codec
    }))
    var ssb = require('../')(db, opts)
    var feed = createFeed(ssb, opts.generate(), opts)

    feed.add('msg', 'hello there!', function (err, msg) {
      if(err) throw err
      t.assert(!!msg)
      pull(
        ssb.createFeedStream({ keys: false }),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.equal(ary.length, 2)
          t.ok(typeof ary[0].content.type == 'string')
          t.ok(typeof ary[1].content.type == 'string')
          console.log(ary)
          t.end()
        })
      )
    })
  })

  tape('avoid locking the thread during adds', function (t) {

    var n = 100

    var db = sublevel(level('test-ssb-feed7', {
      valueEncoding: opts.codec
    }))
    var ssb = require('../')(db, opts)
    var feed = createFeed(ssb, opts.generate(), opts)

    console.log('adding', n, 'messages')
    var ts = Date.now()
    var interval = setInterval(function () {
      var _ts = Date.now()
      var diff = _ts-ts
      console.log('checkpoint', diff)
      if (diff > 1000)
        throw "thread locked for 1s"
      ts = _ts
    }, 500)

    var done = multicb()
    for (var i=0; i < n; i++) {
      feed.add('msg', ''+i, done())
    }

    done(function (err) {
      if (err) throw err
      console.log('done!')
      clearInterval(interval)
      t.end()
    })
  })

}


if(!module.parent)
  module.exports(require('../defaults'))
