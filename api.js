
//these are the async functions.
var async = [
  'add',
  'getPublicKey',
  'getLatest'
]

//these are the readable streams.
var readable = [
  'createFeedStream',
  'createHistoryStream',
  'createLogStream',
  'messagesLinkedTo',
  'feedsLinkedTo',
  'feedsLinkedFrom'
]


//connect to server, and expose this api.
module.exports = function (opts) {
  if(!opts.id)
    throw new Error('must provide the local feed id')

  var api = {}
  async.forEach(function (name) {
    api[name] = function () {
      var args = [].slice.call(arguments)
      var cb = args.pop()
      if(!isFunction(cb))
        throw new Error('cb *must* be provided')
      //send request to backend.
    }
  })
  streams.forEach(function (name) {
    api[name] = function () {
      //connect this stream to the backend.
      return stream(name)
    }
  })

}
