const tape = require('tape')
const FlumeviewLevel = require('flumeview-level')
const { promisify } = require('util')
const pull = require('pull-stream')

const createSsb = require('./util/create-ssb')

tape('rebuild (basic)', async (t) => {
  t.plan(3)
  const db = createSsb()

  const content = {
    type: 'text',
    text: 'hello'
  }

  const msg = await promisify(db.publish)(content)
  t.equal(msg.value.content, content, 'message is added correctly')

  await promisify(db.rebuild)()
  t.pass('rebuilt')

  await promisify(db.close)()
  t.pass('closed')
})

tape('rebuild (with an unboxer that requires init)', async (t) => {
  t.plan(3)
  const db = createSsb()

  const unboxer = {
    init: function (done) {
      setTimeout(() => {
        t.ok(true, 'calls init')
        done()
      }, 1e3)
    },
    key: function (ciphertext) {
      if (!ciphertext.endsWith('.box.hah')) return

      return '"the msgKey"'
    },
    value: function (ciphertext) {
      const base64 = ciphertext.replace('.box.hah', '')
      return JSON.parse(
        Buffer.from(base64, 'base64').toString('utf8')
      )
    }
  }

  db.addUnboxer(unboxer)

  const content = {
    type: 'text',
    text: 'hello'
  }

  await promisify(db.publish)(content)

  await promisify(db.rebuild)()
  t.pass('rebuilt')

  await promisify(db.close)()
  t.pass('closed')
})

tape('rebuild (after new unboxer)', async (t) => {
  t.plan(7)
  const db = createSsb()
  const myId = db.id

  const latestByBoxStatus = db._flumeUse('latestByBoxStatus', FlumeviewLevel(1, (msg) => {
    if (typeof msg.value.content === 'string') {
      return ['boxed']
    } else {
      return ['unboxed']
    }
  }))

  db.addBoxer((content) => {
    const base64 = Buffer.from(JSON.stringify(content)).toString('base64')
    return `${base64}.box.base64json`
  })

  const content = {
    type: 'text',
    text: 'hello',
    recps: [myId]
  }

  await promisify(db.publish)(content)

  const boxed = await promisify(latestByBoxStatus.get)('boxed')
  t.ok(boxed, "indexes can't see the unboxed message, it remains boxed")

  const msgBefore = await promisify(db.get)({ id: boxed.key, meta: true, private: true })

  t.equal(
    typeof msgBefore.value.content,
    'string',
    'content is an boxed string'
  )

  db.addUnboxer({
    key: (x) => x,
    value: (content) => {
      const suffix = content.indexOf('.box.base64json')
      if (suffix === -1) {
        return null
      } else {
        const base64 = content.slice(0, suffix)
        const bytes = Buffer.from(base64, 'base64')
        try {
          const json = JSON.parse(bytes)
          return json
        } catch (_) {
          return null
        }
      }
    }
  })

  await promisify(db.rebuild)()
  t.pass('rebuilt')

  const msgAfter = await promisify(db.get)({ id: boxed.key, meta: true, private: true })

  // NOTE: Flumeview-Level doesn't actually unbox the message, since it only
  // runs `get(id)` under the hood.
  t.equal(
    typeof msgAfter.value.content,
    'object',
    'content is an unboxed object'
  )

  t.equal(msgAfter.value.content.text, 'hello', 'content is unboxed correctly')

  // Test seems to be failing because FlumeDB rebuilds aren't actually
  // rebuilding anything. I could've sworn that I've seen a rebuild before, but
  // the view map doesn't see the message during the "rebuild". :/
  const unboxed = await promisify(latestByBoxStatus.get)('unboxed')
  t.ok(unboxed, 'indexes see the unboxed message')

  await promisify(db.close)()
  t.pass('closed')
})

/* Note - this sequence of actions sets the database in a state which could get it in a locked state
 * In particular ssb-tribes requires boxer and unboxer initialistion, and they can depened on one
 * another, so if you're not careful.
 */

tape('rebuild (partial index, complex boxer/unboxer)', async (t) => {
  const name = `test-ssb-partial-index-${Date.now()}`

  t.plan(6)

  const ssb = createSsb(name, { temp: false })
  const { key } = await promisify(ssb.publish)({ type: 'test' })
  t.pass('published')

  await promisify(ssb.rebuild)()
  t.pass('rebuilt')

  await promisify(ssb.close)()
  t.pass('closed')

  const ssb2 = createSsb(name, { temp: false }, [require('ssb-tribes')])

  const result = await promisify(ssb2.get)(key)
  t.ok(result)

  await promisify(ssb2.publish)({ type: 'test' })
  t.pass('published again')

  await promisify(ssb2.close)()
  t.pass('closed again')
})

tape('rebuild (handles close)', (t) => {
  t.plan(4)
  const ssb = createSsb()

  pull(
    contentSource(400),
    pull.asyncMap(ssb.publish),
    pull.collect((err) => {
      if (err) throw err

      t.pass('rebuild started')
      ssb.rebuild((err) => t.error(err, 'rebuild done'))

      // for some reason this intermitently causes error:
      //   segmentation fault (core dumped)
      setTimeout(() => {
        t.pass('close started')
        ssb.close((err) => t.error(err, 'close done'))
      }, 0)
    })
  )
})

function contentSource (n) {
  return pull(
    pull.values(new Array(n).fill(0)),
    pull.map(() => {
      return {
        type: 'test',
        body: new Array(100).fill('cat')
      }
    })
  )
}
