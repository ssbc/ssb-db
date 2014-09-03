var createSSB = require('../create')
var tape = require('tape')
var rimraf = require('rimraf')

try { rimraf.sync('/tmp/profile-test'); console.log('Deleted old db'); } catch (e) {}
var ssb = createSSB('/tmp/profile-test')
var profile = ssb.addApp(require('../apps/profile'))

var alice = ssb.createFeed()
var bob = ssb.createFeed()

tape('set nickname, lookup by nickname', function (t) {

  profile.setNickname(alice, 'alice', function(err, msg, id) {
    if (err) throw err
    console.log('set alice nickname')
    profile.setNickname(bob, 'bob', function(err, msg, id) {
      console.log('set bob nickname')
      profile.lookupByNickname('alice', function(err, ids) {
        if (err) throw err
        console.log('looked up alice', ids)
        t.equal(ids[0].toString('hex'), alice.id.toString('hex'))
        t.equal(ids.length, 1)
        t.end()
      })
    })
  })
})

tape('get profile', function (t) {
  console.log('looking up alice\'s profile', alice.id)
  profile.getProfile(alice.id, function(err, profile) {
    if (err) throw err
    console.log('looked up alice\'s profile', profile)
    t.equal(profile.nickname, 'alice')
    t.end()
  })
})

tape('lookup by nickname with multiple matches', function (t) {

  profile.setNickname(bob, 'alice', function(err, msg, id) {
    console.log('gave bob an identity crisis')
    profile.lookupByNickname('alice', function(err, ids) {
      if (err) throw err
      console.log('looked up alice', ids)
      t.equal(ids.length, 2)
      t.end()
    })
  })
})

