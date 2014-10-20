
function isObject (o) {
  return o && 'object' === typeof o
}

function isString (s) {
  return 'string' === typeof s
}

module.exports = function (opts) {

  var zeros = opts.hash(new Buffer(0))
  zeros.fill(0)

  function sign (msg, keys) {

    msg.signature =
      opts.keys.sign(keys, opts.hash(opts.codec.encode(msg)))

    return msg
  }

  function create (keys, type, content, prev) {

    //this noise is to handle things calling this with legacy api.
    if(Buffer.isBuffer(content) || isString(content))
      content = {type: type, value: content}
    if(isObject(content))
      content.type = content.type || type
    //noise end

    return sign({
      previous: prev ? opts.hash(opts.codec.encode(prev)) : zeros,
      author: opts.hash(keys.public),
      sequence: prev ? prev.sequence + 1 : 1,
      timestamp: Date.now(),
      timezone: new Date().getTimezoneOffset(),
      message: content,
    }, keys)
  }

  create.sign = sign

  return create
}
