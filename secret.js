var crypto = require('crypto')
var ecc = require('eccjs')
var k256 = ecc.curves.k256
var bsum = require('./util').bsum
var proquint = require('proquint-')

exports.encode = function (keys) {
  var PRIVATE = (keys && keys.private || keys) || exports.generate()
  keys = ecc.restore(k256, PRIVATE)
  var public = bsum(keys.public)

  var contents = [
  '### FOR YOUR EYES ONLY ###',
  '#',
  '# this is your SECRET name:',
  '',
  proquint
    .encodeCamelDash(keys.private)
    .split('-')
    .reduce(function (s, e, i) {
      return s + (i==4?'\n':i ? '-': '') + e
    },''),
  '',
  '# this name gives you magical powers.',
  '# with it you can mark your messages so that your friends can know',
  '# that they really did come from you.',
  '#',
  '# if any one learns your secret name, ',
  '# they can use it pretend to be you, or to destroy your identity.',
  '# NEVER show this to anyone!!!',
  '',
  '# NEVER edit your secret name. That will break everything and',
  '# you will have to start over.',
  '#',
  '# instead, share your public name',
  '# your public name: ' + proquint.encodeCamelDash(public),
  '# or as a hash : ' + public.toString('hex')
  ].join('\n')

  return contents
}

exports.decode = function (buffer) {
  buffer =
    buffer.toString('utf8')
      .replace(/\s*\#[^\n]*/g, '')

  return ecc.restore(k256, proquint.decode(buffer))
}

exports.generate = function () {
  //use node's crypto because eccjs expects to be in a browser
  //and wont beable to do random number generation properly.
  return ecc.restore(k256, crypto.randomBytes(32))
}

if(!module.parent)
  console.log(exports.create())
