const test = require('node:test');
const assert = require('node:assert');
const bm = require('./blog-mail');

/** A pretend Resend: contacts by email, segments by name, every call logged. */
function fakeResend({ contacts = {}, segments = {}, topics = {}, bareTopics = false } = {}) {
  const calls = [];
  let n = 0;
  const resend = async (p, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, p, body: init.body });
    if (p === '/topics?limit=100') return { data: Object.entries(topics).map(([name, id]) => ({ id, name })) };
    if (p === '/topics' && method === 'POST') { const id = `t${++n}`; topics[init.body.name] = id; return { id }; }
    const tp = /^\/contacts\/([^/]+)\/topics$/.exec(p);
    if (tp && method === 'PATCH') {
      // Resend's docs show both shapes; this fake can insist on the bare one.
      const list = Array.isArray(init.body) ? init.body : init.body.topics;
      if (bareTopics && !Array.isArray(init.body)) { const e = new Error('resend 422'); e.status = 422; e.resend = true; throw e; }
      const c = contacts[decodeURIComponent(tp[1])];
      c.topics = { ...(c.topics || {}) };
      for (const t of list) c.topics[t.id] = t.subscription;
      return {};
    }
    if (p === '/segments' && method === 'GET') return { data: Object.entries(segments).map(([name, id]) => ({ id, name })) };
    if (p === '/segments' && method === 'POST') { const id = `seg${++n}`; segments[init.body.name] = id; return { id }; }
    let m = /^\/contacts\/([^/]+)$/.exec(p);
    if (m && method === 'GET') {
      const c = contacts[decodeURIComponent(m[1])];
      if (!c) { const e = new Error('resend 404'); e.status = 404; e.resend = true; throw e; }
      return c;
    }
    if (m && method === 'PATCH') { Object.assign(contacts[decodeURIComponent(m[1])], init.body); return {}; }
    if (p === '/contacts' && method === 'POST') { contacts[init.body.email] = { id: `c${++n}`, ...init.body }; return { id: contacts[init.body.email].id }; }
    if (/^\/contacts\/[^/]+\/segments\/[^/]+$/.test(p)) return {};
    if (p === '/broadcasts' && method === 'POST') return { id: `b${++n}` };
    if (/^\/broadcasts\/[^/]+\/send$/.test(p)) return {};
    throw new Error(`unexpected ${method} ${p}`);
  };
  return { resend, calls, contacts, segments, topics };
}
function io(extra = {}) {
  const f = fakeResend(extra.resendState);
  const subs = {}, marks = {};
  return {
    f, subs, marks,
    resend: f.resend, cache: {},
    subscribers: { set: async (e, v) => { subs[e] = { ...subs[e], ...v, lists: { ...(subs[e] || {}).lists, ...v.lists } }; } },
    sentPosts: {
      get: async (id) => marks[id] || null,
      set: async (id, v) => { marks[id] = { ...marks[id], ...v }; },
      claim: async (id, v, seen) => { if ((marks[id] ? marks[id].at : null) !== (seen ? seen.at : null)) return false; marks[id] = { ...marks[id], ...v }; return true; },
    },
    posts: async () => extra.posts || [],
    page: async (url) => (extra.pages || {})[url] || null,
    renderer: async () => (md) => md.split(/\n\n+/).map((b) => `<p>${b}</p>`).join('\n'),
    ...extra.io,
  };
}

test('subscribe: a new address joins the segment and only the list it asked for', async () => {
  const x = io();
  const r = await bm.handle('subscribe', { list: 'news', name: 'Kim', email: ' Kim@Example.org ', source: 'home' }, x);
  assert.deepStrictEqual(r, { ok: true, list: 'news', again: false });
  const c = x.f.contacts['kim@example.org'];
  assert.strictEqual(c.unsubscribed, false);
  assert.ok(x.f.calls.some((k) => k.p === `/contacts/kim%40example.org/segments/${x.f.segments[bm.SEGMENT]}`));
  assert.deepStrictEqual(c.topics, { [x.f.topics['Pyr news']]: 'opt_in' }, 'Pyr news only');
  const made = x.f.calls.filter((k) => k.p === '/topics' && k.method === 'POST').map((k) => k.body);
  assert.ok(made.every((t) => t.default_subscription === 'opt_out'), 'nobody is on a list by default');
  assert.strictEqual(x.subs['kim@example.org'].lists.news.resend, true);
});

test('subscribe: the blog form joins the blog list; no list means the blog', async () => {
  const x = io();
  await bm.handle('subscribe', { name: 'Kim', email: 'kim@example.org' }, x);
  assert.deepStrictEqual(x.f.contacts['kim@example.org'].topics, { [x.f.topics['Blog posts']]: 'opt_in' });
});

test('subscribe: joining a second list keeps the first', async () => {
  const x = io();
  await bm.handle('subscribe', { list: 'blog', name: 'Kim', email: 'kim@example.org' }, x);
  await bm.handle('subscribe', { list: 'news', name: 'Kim', email: 'kim@example.org' }, x);
  assert.deepStrictEqual(x.f.contacts['kim@example.org'].topics, { [x.f.topics['Blog posts']]: 'opt_in', [x.f.topics['Pyr news']]: 'opt_in' });
  assert.ok(x.subs['kim@example.org'].lists.blog && x.subs['kim@example.org'].lists.news);
});

test('subscribe: after unsubscribing from everything, signing up again brings back only that list', async () => {
  const x = io({ resendState: { contacts: { 'kim@example.org': { id: 'c1', email: 'kim@example.org', unsubscribed: true, topics: { t9: 'opt_in' } } },
    segments: { [bm.SEGMENT]: 's1' }, topics: { 'Blog posts': 't9', 'Pyr news': 't8' } } });
  const r = await bm.handle('subscribe', { list: 'news', name: 'Kim', email: 'kim@example.org' }, x);
  assert.strictEqual(r.again, true);
  const c = x.f.contacts['kim@example.org'];
  assert.strictEqual(c.unsubscribed, false);
  assert.deepStrictEqual(c.topics, { t8: 'opt_in', t9: 'opt_out' });
  assert.ok(!x.f.calls.some((k) => k.p === '/contacts' && k.method === 'POST'), 'no second contact');
});

test('subscribe: works whichever topics body shape Resend takes', async () => {
  const x = io({ resendState: { bareTopics: true } });
  await bm.handle('subscribe', { list: 'news', name: 'Kim', email: 'kim@example.org' }, x);
  assert.deepStrictEqual(x.f.contacts['kim@example.org'].topics, { [x.f.topics['Pyr news']]: 'opt_in' });
});

test('subscribe: the bot trap and bad input', async () => {
  const x = io();
  assert.deepStrictEqual(await bm.handle('subscribe', { name: 'b', email: 'b@b.co', _honey: 'x' }, x), { ok: true });
  assert.strictEqual(x.f.calls.length, 0);
  await assert.rejects(bm.handle('subscribe', { name: 'Kim', email: 'not an email' }, x), { status: 400 });
  await assert.rejects(bm.handle('subscribe', { name: '', email: 'kim@example.org' }, x), { status: 400 });
  await assert.rejects(bm.handle('nope', {}, x), { status: 400 });
});

const POST = { id: 'p1', slug: 'new-post', title: 'A new post', summary: 'Short.', body: 'Hello there.', published_at: '2026-11-06T10:00:00Z' };
const LIVE_PAGE = { 'https://connectome.quest/blog/new-post/': '<h1>A new post</h1>' };

test('check: posts from before going live are never sent', async () => {
  const since = Date.parse(bm.LIVE_SINCE);
  assert.ok(bm.LIVE_SINCE === '__LIVE_SINCE__' || since >= Date.parse('2026-11-06T00:00:00Z'), 'LIVE_SINCE is the moment Ames said go');
  // Every post on the blog when it went live is older than LIVE_SINCE.
  const x = io({ posts: [{ ...POST, published_at: '2026-11-05T12:00:00Z' }], pages: LIVE_PAGE });
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, []);
  assert.ok(!x.f.calls.some((c) => c.p === '/broadcasts'));
});

test('check: a new post goes once, to the blog segment, only when its page is live', async () => {
  const live = { since: '2026-11-06T00:00:00Z' };
  const old = { ...POST, id: 'p0', slug: 'old-post', title: 'Old', published_at: '2026-11-01T00:00:00Z' };
  const x = io({ posts: [POST, old], pages: {}, io: { live } });
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, [], 'page not built yet');
  x.page = async (u) => LIVE_PAGE[u] || '<h1>Old</h1>';
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, ['new-post'], 'old posts never go');
  const b = x.f.calls.find((c) => c.p === '/broadcasts');
  assert.strictEqual(b.body.segment_id, x.f.segments[bm.SEGMENT]);
  assert.strictEqual(b.body.topic_id, x.f.topics['Blog posts'], 'only to people on the blog list');
  assert.strictEqual(b.body.subject, 'A new post');
  assert.strictEqual(b.body.from, '"Pyr: Map the Brain" <blog@connectome.quest>');
  assert.match(b.body.html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  assert.match(b.body.html, /href="https:\/\/connectome\.quest\/blog\/new-post\/"/);
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, [], 'never twice');
  assert.strictEqual(x.f.calls.filter((c) => /\/send$/.test(c.p)).length, 1);
});

test('check: a post another run is sending is left alone', async () => {
  const x = io({ posts: [POST], pages: LIVE_PAGE, io: { live: { since: '2026-11-06T00:00:00Z' } } });
  x.marks.p1 = { state: 'sending', at: new Date().toISOString(), tries: 1 };
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, []);
});

test('test: goes only to the Test segment, and subscribes Ames again', async () => {
  const x = io({ posts: [POST], resendState: { contacts: { 'amyleerobinson@gmail.com': { id: 'c9', unsubscribed: true } }, segments: {} } });
  await bm.handle('test', { slug: 'new-post' }, x);
  const b = x.f.calls.find((c) => c.p === '/broadcasts');
  assert.strictEqual(b.body.segment_id, x.f.segments[bm.TEST_SEGMENT]);
  assert.notStrictEqual(b.body.segment_id, x.f.segments[bm.SEGMENT]);
  assert.strictEqual(x.f.contacts['amyleerobinson@gmail.com'].unsubscribed, false);
  assert.strictEqual(x.f.contacts['amyleerobinson@gmail.com'].topics[x.f.topics['Blog posts']], 'opt_in');
  await assert.rejects(bm.handle('test', { slug: 'missing' }, x), { status: 404 });
});

test('emailBody: videos, phone pictures, sizes and links become email safe', () => {
  const html = [
    '<div class="blog-post__video"><iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="YouTube video" loading="lazy"></iframe></div>',
    '<figure class="blog-post__figure blog-post__figure--small" data-size="small"><picture><source media="(max-width: 700px)" srcset="https://x/p.png" /><img src="https://x/a.png" alt="A" loading="lazy" /></picture><figcaption>Cap</figcaption></figure>',
    '<p>See <a href="/blog/">the blog</a>.</p>',
  ].join('\n');
  const out = bm.emailBody(html);
  assert.doesNotMatch(out, /<iframe|<picture|<source|<figure|class=/);
  assert.match(out, /https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk/);
  assert.match(out, /max-width:50%/);
  assert.match(out, /href="https:\/\/connectome\.quest\/blog\/"/);
});

test('excerpt: short posts go whole; long ones stop at a block, never inside code', () => {
  assert.deepStrictEqual(bm.excerpt('One.\n\nTwo.'), { md: 'One.\n\nTwo.', cut: false });
  const para = Array(120).fill('word').join(' ');
  const long = [para, '```\ncode line\n\nmore code\n```', para, '## Heading', para, para, para].join('\n\n');
  const { md, cut } = bm.excerpt(long);
  assert.strictEqual(cut, true);
  assert.strictEqual((md.match(/```/g) || []).length % 2, 0, 'a code fence is never cut in half');
  assert.doesNotMatch(md, /## Heading\s*$/, 'never ends on a heading');
});
