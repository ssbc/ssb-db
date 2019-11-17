// <local-flume-use>
const flume = require('flumedb')
const test = require('tape') 
const localFlumeUse = (remoteLog) => {
  // Create local instance of flumedb that depends on the remote log.
  // Views will be created locally but the log will remain remote.
  const localFlume = flume(remoteLog)

  // Name could probably be removed, but it makes for better error messages.
  const use = (name, createView) => {
    localFlume.use(name, createView)
    return localFlume.views[name]
  }

  return use
}
// </local-flume-use>

const view = require('flumeview-level')
const ssb = require('../').init({}, { temp: true })

test('basic localFlumeUse() support', (t) => {
  // Use the remote log to create a `use()` function that makes local views.
  // This means you can create views from ssb-client, not just the server config!
  const use = localFlumeUse(ssb.log)

  // Use a simple view that lets us look up messages by their key.
  const findByKey = use('example', view(1, ({ key}) => [key]))

  const content = {type: 'test', text: 'hello world'}

  ssb.publish(content, (err, publishedMessage) => {
    t.error(err, 'publish() successq')
    const key = publishedMessage.key

    findByKey.get(key, (findErr,foundMessage) => {
      t.error(findErr, 'get() success')
      t.deepEqual(foundMessage.value.content, content, 'content match')
      t.end()
    })
  })
})
