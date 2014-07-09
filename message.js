


module.exports = function (opts) {

  var zeros = opts.hash(new Buffer(0))
  zeros.fill(0)

  function sign (msg, keys) {

    msg.signature =
      opts.sign(keys, opts.hash(opts.encode(msg)))

    return msg
  }

  function create (keys, type, content, prev) {
    return sign({
      prev: prev ? opts.hash(opts.encode(prev)) : zeros,
      author: opts.hash(keys.public),
      type: type,
      message: content,
      sequence: prev ? prev.sequence + 1 : 1,
      timestamp: Date.now()
    }, keys)
  }

  create.sign = sign

  return create
}
