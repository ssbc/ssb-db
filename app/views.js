
var d64 = require('d64')
var proquint = require('proquint-')

exports.INIT = function (msg, sbs, opts, cb) {

  var s = msg.message.toString('base64')

  return 'public key:\n'
    + s.substring(0, 44) + '\n'
    + s.substring(44)
    
//    + s.substring(0, 64)
//    + '\n' + s.substring(64))
//
}

exports.message = function (msg, sbs, opts, cb) {

  return (msg.message.toString('utf8'))

}

exports.follow = function (msg, sbs, opts, cb) {

  return ('followed: '+
    proquint.encodeCamelDash(msg.references[0]).substring(0, 43)
    )
}
