


module.exports = function (opts) {

  var zeros = opts.hash(new Buffer(0))
  zeros.fill(0)

  function sign (msg, keys) {

    msg.signature =
      opts.keys.sign(keys, opts.hash(opts.codec.encode(msg)))

    return msg
  }

  function toBuffer (b) {
    return Buffer.isBuffer(b) ? b : new Buffer(b, 'utf8')
  }

  function create (keys, type, content, prev) {
    return sign({
      previous: prev ? opts.hash(opts.codec.encode(prev)) : zeros,
      author: opts.hash(keys.public),
      sequence: prev ? prev.sequence + 1 : 1,
      timestamp: Date.now(),
      timezone: new Date().getTimezoneOffset(),
      type: toBuffer(type),
      message: toBuffer(content),
    }, keys)
  }

  create.sign = sign

  return create
}
