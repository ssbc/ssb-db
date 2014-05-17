

function listToObj(ary) {
  var obj = {}
  ary.forEach(function (data) {
    obj[data.key.toString('hex')] = data.value
  })
  return obj
}

function compare (a, b) {
  var l = Math.min(a.length, b.length)
  for(var i = 0; i < l; i++) {
    if(a[i]<b[i]) return -1
    if(a[i]>b[i]) return  1
  }
  return a.length - b.length
}

module.exports = function (sb) {

  return replicate(function (cb) {
    pull(sb.lastest(), pull.collect(function (err, ary) {
      if(err) cb(err)
      else cb(null, ary)
    })
  }, function (me, you) {
    me  = listToObj(me)
    you = listToObj(you)
    //we now that I have a list
    //of what you have, and where
    //you are up to. I'll look in my database
    //and see if I can help you.
    var feeds = []
    for(var key in you) {
      if(me[key] != null && you[key] < me[key])
        //send key's feed after you[key]
        feeds.push(scuttlebutt.feed(key).createReadStream())
    }
    return {
      source:
        many(feeds),
      sink:
        pswitch(function (msg) {
          return msg.author.toString('hex')
        }, function (id) {
          return sb.feed(id).createWriteStream()
        })
    }
  })

}
