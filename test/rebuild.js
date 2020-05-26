const tape = require("tape");
const createSsb = require("./create-ssb");
const FlumeviewLevel = require('flumeview-level')


const { promisify } = require("util");

tape("basic rebuild", async (t) => {
  const db = createSsb();
  const feed = db.createFeed();

  const content = {
    type: "text",
    text: "hello",
  };

  const msg = await promisify(feed.add)(content);
  t.equal(msg.value.content, content, "message is added correctly");

  await promisify(db.rebuild)();

  t.end();
});

tape("new unboxer rebuild", async (t) => {
  const db = createSsb();
  const feed = db.createFeed();
  const myId = feed.keys.id;

  db.use('latestByBoxStatus', FlumeviewLevel(1, (msg) => {
    console.log('GOT MSG')
    if (typeof msg.value.content === 'string') {
      return ['boxed']
    } else {
      return ['unboxed']
    }
  }))

  db.addBoxer((content) => {
    const base64 = Buffer.from(JSON.stringify(content)).toString("base64");
    return `${base64}.box.base64json`;
  });

  const content = {
    type: "text",
    text: "hello",
    recps: [myId],
  };

  await promisify(feed.add)(content);

  const boxed = await promisify(db.latestByBoxStatus.get)('boxed')
  t.ok(boxed, "indexes can't see the unboxed message, it remains boxed")

  const msgBefore = await promisify(db.get)(0);

  t.equal(
    typeof msgBefore.value.content,
    "string",
    "content is an boxed string"
  );

  db.addUnboxer({
    key: (x) => x,
    value: (content) => {
      const suffix = content.indexOf(".box.base64json");
      if (suffix === -1) {
        return null;
      } else {
        const base64 = content.slice(0, suffix);
        const bytes = Buffer.from(base64, "base64");
        try {
          const json = JSON.parse(bytes);
          return json;
        } catch (_) {
          return null;
        }
      }
    },
  });

  await promisify(db.rebuild)()

  const msgAfter = await promisify(db.get)(0);

  t.equal(
    typeof msgAfter.value.content,
    "object",
    "content is an unboxed object"
  );

  t.equal(msgAfter.value.content.text, "hello", "content is unboxed correctly");

  // Test seems to be failing because FlumeDB rebuilds aren't actually
  // rebuilding anything. I could've sworn that I've seen a rebuild before, but
  // the view map doesn't see the message during the "rebuild". :/
  const unboxed = await promisify(db.latestByBoxStatus.get)('unboxed')
  t.ok(unboxed, 'indexes see the unboxed message')

  t.end();
});
