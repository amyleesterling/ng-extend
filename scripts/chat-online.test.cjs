// "N online" in chat, end to end with the REAL gateway code, headless
// (Ames 2026-10-21: her chat said "1 online", only Nseraf, while she was
// chatting; her heartbeats had been refused since 3:05 PM by the gateway's
// daily write limit, 5,000 a player a day, which her five open tabs used up).
//
// Nothing here reaches a real server. The ewCommunityData handler is loaded
// from <functions>/index.js with Firebase stubbed, and everything it calls is
// answered here: CAVE's "who is this" (two fake players), Supabase's tables
// (in memory, with the joined_at trigger of chat_presence), the rate limit's
// Firestore counters (in memory). The browser side is the built app, with
// its gateway calls handed to that handler, its Supabase reads answered from
// the same tables, and the live updates (Supabase Realtime) sent over a fake
// socket as the tables change.
//
// The scene: "amy" (admin) with five tabs and "Nseraf" (pilot) with one. Amy's
// heartbeat count today starts at 4,994 of the 5,000, which is where it stood
// just before 3:05 PM. The run samples the "N online" chip and its list in
// Amy's first tab and in Nseraf's tab every 10 s, and Amy sends a chat
// message part way through.
//
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Run:    node scripts/chat-online.test.cjs --dist dist/min --functions functions
//         [--no-live] (live updates down: chat falls back to asking)
//         [--minutes 5] [--seed 4994] [--expect-bug] [--port 3497] [--gateway-ms 700]
// --expect-bug: pass when the bug shows (Amy drops out), for a control run
// against the code from before the fix.
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const Module = require('module');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const DIST = path.resolve(arg('dist', 'dist/min'));
const FUNCS = path.resolve(arg('functions', 'functions'));
const MINUTES = Number(arg('minutes', 5));
const SEED = Number(arg('seed', 4994));
const PORT = Number(arg('port', 3497));
const LIVE = !process.argv.includes('--no-live');
// The real gateway takes about a second (sign in check, identity reads, the
// write); the browser's own reads go straight to Supabase and are quicker.
const GATEWAY_MS = Number(arg('gateway-ms', 0));
const EXPECT_BUG = process.argv.includes('--expect-bug');
const PW = arg('playwright', 'C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = arg('chrome', 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe');
const SB = 'https://javthknksdcrlhiaaptj.supabase.co/rest/v1/';
const t0 = Date.now();
const secs = () => Math.round((Date.now() - t0) / 1000);

// ── The two players ──────────────────────────────────────────────────────
const PLAYERS = {
  'tok-amy': { caveId: 101, email: 'amy@test.pyr', name: 'Amy', username: 'amy', id: '146a3fec-0000-4000-8000-000000000101', tabs: 5 },
  'tok-nseraf': { caveId: 202, email: 'nseraf@test.pyr', name: 'Nseraf', username: 'Nseraf', id: '6d3db4d2-0000-4000-8000-000000000202', tabs: 1 },
};
const byToken = (auth) => PLAYERS[String(auth || '').replace(/^Bearer\s+/i, '')];

// ── Supabase tables, in memory ───────────────────────────────────────────
const tables = {
  users: Object.values(PLAYERS).map(p => ({ id: p.id, middleauth_email: p.email, username: p.username, display_name: p.name, total_edits: 0 })),
  admins: [{ id: 1, email: 'amy@test.pyr' }],
  pilot_members: [{ email: 'nseraf@test.pyr', enabled: true }],
  user_group_members: [], chat_presence: [], chat_messages: [], chat_reactions: [],
};
const stats = { presenceWrites: {}, presence429: 0, gateway: {}, chatPosted: 0, liveSent: 0 };
const listeners = new Set(); // live update sockets

function splitTop(s) { // "a.eq.1,b.in.(2,3)" -> top level parts
  const out = []; let depth = 0, cur = '';
  for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch; }
  if (cur) out.push(cur); return out;
}
function test(row, col, opval) {
  const i = opval.indexOf('.'), op = opval.slice(0, i), v = opval.slice(i + 1), x = row[col];
  const s = x == null ? null : String(x);
  switch (op) {
    case 'eq': return s === v; case 'neq': return s !== v;
    case 'gt': return s != null && s > v; case 'gte': return s != null && s >= v;
    case 'lt': return s != null && s < v; case 'lte': return s != null && s <= v;
    case 'in': return splitTop(v.replace(/^\(|\)$/g, '')).map(z => z.replace(/^"|"$/g, '')).includes(s);
    case 'is': return v === 'null' ? x == null : v === 'true' ? x === true : x === false;
    case 'not': return !test(row, col, v);
    default: return true;
  }
}
function matcher(q) {
  const checks = [];
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'and' || k === 'or') {
      const parts = splitTop(v.replace(/^\(|\)$/g, '')).map(p => { const i = p.indexOf('.'); return [p.slice(0, i), p.slice(i + 1)]; });
      checks.push(row => k === 'and' ? parts.every(([c, o]) => test(row, c, o)) : parts.some(([c, o]) => test(row, c, o)));
    } else checks.push(row => test(row, k, v));
  }
  return row => checks.every(f => f(row));
}
const pick = (row, sel) => { if (!sel || sel === '*' || /\(/.test(sel)) return { ...row }; const o = {}; for (const c of sel.split(',')) o[c] = row[c] ?? null; return o; };
function emit(table, type, record, old) {
  for (const l of listeners) l(table, type, record, old);
}
/** One PostgREST request against the tables. Returns { status, body, headers }. */
function postgrest(method, table, q, body, headers = {}) {
  const rows = tables[table] || [];
  const match = matcher(q);
  const now = new Date().toISOString();
  let out = [];
  if (method === 'GET' || method === 'HEAD') {
    out = rows.filter(match);
    const order = q.get('order');
    if (order) { const [c, dir] = order.split('.'); out.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
    if (q.get('limit')) out = out.slice(0, Number(q.get('limit')));
    out = out.map(r => pick(r, q.get('select')));
  } else if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    const key = q.get('on_conflict');
    for (const b of list) {
      const prev = key ? rows.find(r => key.split(',').every(k => String(r[k]) === String(b[k]))) : null;
      if (table === 'chat_presence') {
        // the chat_presence_stamp_join trigger
        const joined = !prev || prev.last_seen_at < new Date(Date.now() - 120_000).toISOString() ? now : prev.joined_at;
        const row = { dataset: null, ...(prev || {}), ...b, joined_at: joined };
        if (prev) Object.assign(prev, row); else rows.push(row);
        const id = PLAYERS_BY_ID[row.user_id] || row.user_id;
        stats.presenceWrites[id] = (stats.presenceWrites[id] || 0) + 1;
        emit(table, prev ? 'UPDATE' : 'INSERT', { ...row }, prev ? { ...prev } : {});
        out.push({ ...row });
      } else {
        const row = { id: crypto.randomUUID(), created_at: now, ...b };
        rows.push(row);
        if (table === 'chat_messages') stats.chatPosted++;
        emit(table, 'INSERT', { ...row }, {});
        out.push(row);
      }
    }
    tables[table] = rows;
  } else if (method === 'PATCH') {
    for (const r of rows.filter(match)) { Object.assign(r, body); out.push({ ...r }); }
  } else if (method === 'DELETE') {
    const gone = rows.filter(match);
    tables[table] = rows.filter(r => !gone.includes(r));
    for (const r of gone) emit(table, 'DELETE', {}, { ...r });
    out = gone;
  }
  const single = /vnd\.pgrst\.object/.test(headers.accept || headers.Accept || '');
  if (single) {
    if (out.length !== 1) return { status: 406, body: JSON.stringify({ code: 'PGRST116', message: 'no rows' }) };
    return { status: 200, body: JSON.stringify(out[0]) };
  }
  return { status: method === 'POST' ? 201 : 200, body: method === 'HEAD' ? '' : JSON.stringify(out),
    headers: { 'content-range': `0-${Math.max(0, out.length - 1)}/${out.length}` } };
}
const PLAYERS_BY_ID = Object.fromEntries(Object.values(PLAYERS).map(p => [p.id, p.username]));

// ── The gateway, loaded from the code under test ─────────────────────────
const firestoreDocs = new Map();
const fakeDb = {
  collection: (c) => ({ doc: (id) => ({ path: c + '/' + id }), where() { return this; }, async get() { return { empty: true, docs: [] }; }, async add() { return {}; } }),
  runTransaction: async (fn) => fn({
    get: async (ref) => ({ exists: firestoreDocs.has(ref.path), data: () => ({ ...firestoreDocs.get(ref.path) }) }),
    set: (ref, v) => firestoreDocs.set(ref.path, { ...v }),
  }),
};
const fakeAdmin = {
  initializeApp() {}, credential: { applicationDefault: () => ({}) },
  firestore: Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => new Date(), increment: n => n }, Timestamp: { now: () => new Date() } }),
};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') return { onRequest: (opts, handler) => handler || opts };
  if (request === 'firebase-functions/params') return { defineSecret: (n) => ({ value: () => (n === 'EW_SUPABASE_SERVICE_KEY' ? 'sb_secret_test' : 'test') }) };
  if (request === 'firebase-admin') return fakeAdmin;
  return realLoad.apply(this, arguments);
};
// What the gateway itself fetches: CAVE identity and Supabase. Nothing else.
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  url = String(url);
  const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (/\/auth\/api\/v1\/user\/me$/.test(url)) {
    const p = byToken(h.authorization);
    return p ? new Response(JSON.stringify({ id: p.caveId, email: p.email, name: p.name }), { status: 200 })
      : new Response('{}', { status: 401 });
  }
  if (url.startsWith(SB)) {
    const u = new URL(url), table = u.pathname.replace('/rest/v1/', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    const r = postgrest(init.method || 'GET', table, u.searchParams, body, h);
    return new Response(r.body || null, { status: r.status, headers: r.headers || {} });
  }
  return new Response('{}', { status: 404 }); // never the network
};
const gateway = require(path.join(FUNCS, 'index.js')).ewCommunityData;
// Amy's heartbeats so far today, as they stood just before 3:05 PM.
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
firestoreDocs.set('guide_ratelimit/write:chat_presence:' + sha('amy@test.pyr'),
  { minStart: Date.now(), minCount: 0, dayStart: Date.now() - 19 * 3600_000, dayCount: SEED });

async function callGateway(bodyText) {
  const input = JSON.parse(bodyText || '{}');
  if (GATEWAY_MS) await new Promise(r => setTimeout(r, GATEWAY_MS));
  return new Promise((resolve) => {
    const res = { code: 200, set() { return res; }, status(c) { res.code = c; return res; },
      json(o) { resolve({ status: res.code, body: o }); return res; } };
    gateway({ method: 'POST', body: input, ip: '127.0.0.1', headers: {} }, res).catch(e => resolve({ status: 500, body: { message: String(e) } }));
  }).then(r => {
    const who = byToken('Bearer ' + (input.token || ''))?.username || 'anon';
    const status = r.status === 200 && r.body && r.body.status ? r.body.status : r.status;
    const k = `${input.method} ${input.table} ${status}`;
    stats.gateway[k] = (stats.gateway[k] || 0) + 1;
    if (input.table === 'chat_presence' && input.method === 'POST' && status === 429) stats.presence429++;
    if (process.env.LOGGW) console.log('GW', secs(), who, k);
    return r;
  });
}

// ── The built app, served here ───────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const PRESENCE_COLUMNS = ['user_id:uuid', 'name:text', 'last_seen_at:timestamptz', 'joined_at:timestamptz', 'dataset:text'].map(s => ({ name: s.split(':')[0], type: s.split(':')[1] }));
const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: typeof b === 'string' ? b : JSON.stringify(b) });

async function setupContext(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  await ctx.addInitScript((tok) => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/');
    const t = { tokenType: 'Bearer', accessToken: tok, url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(t)); } catch (e) {} }
    try { localStorage.setItem('nge_chat_visible_v1', '1'); } catch (e) {}
  }, token);
  const host = `http://localhost:${PORT}`;
  // Anything not answered below never leaves the machine.
  await ctx.route(url => !String(url).startsWith(host), r => r.abort());
  await ctx.route(/\/auth\/api\/v1\/user\/(me|cache)|sticky_auth\/api\/v1\/user\/me/, r => {
    const p = byToken(r.request().headers().authorization) || PLAYERS[token];
    return r.fulfill(json({ id: p.caveId, email: p.email, name: p.name }));
  });
  await ctx.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await ctx.route(/cloudfunctions\.net|run\.app/, async r => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' });
    if (!/\/ewCommunityData$/.test(req.url())) return r.fulfill(json({ ok: true, data: null, status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' }));
    const out = await callGateway(req.postData());
    return r.fulfill(json(out.body, out.status));
  });
  await ctx.route(/javthknksdcrlhiaaptj\.supabase\.co\/rest\/v1\//, r => {
    const req = r.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS' }, body: '' });
    // Reads the browser makes itself. Writes to these tables only go through the gateway.
    if (req.method() !== 'GET' && req.method() !== 'HEAD') return r.fulfill(json({ message: 'not here' }, 401));
    const out = postgrest(req.method(), u.pathname.replace('/rest/v1/', ''), u.searchParams, undefined, req.headers());
    return r.fulfill({ status: out.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': '*', ...(out.headers || {}) }, body: out.body });
  });
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, ws => {
    if (!LIVE) return ws.close({ code: 1006, reason: 'live updates down' });
    const channels = new Map(); // topic -> { joinRef, bindings: [{id, event, table}] }
    let nextId = 1000;
    const send = (m) => { try { ws.send(JSON.stringify(m)); } catch (e) {} };
    const listener = (table, type, record, old) => {
      for (const [topic, ch] of channels) {
        const ids = ch.bindings.filter(b => b.table === table && (b.event === '*' || b.event === type) && !b.filter).map(b => b.id);
        if (!ids.length) continue;
        stats.liveSent++;
        send([null, null, topic, 'postgres_changes', { ids, data: { schema: 'public', table, commit_timestamp: new Date().toISOString(), type,
          record, old_record: old, columns: table === 'chat_presence' ? PRESENCE_COLUMNS : [], errors: null } }]);
      }
    };
    listeners.add(listener);
    ws.onClose(() => listeners.delete(listener));
    ws.onMessage(raw => {
      let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
      const [joinRef, ref, topic, event, payload] = m;
      if (topic === 'phoenix' && event === 'heartbeat') return send([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]);
      if (event === 'phx_join') {
        const bindings = (payload?.config?.postgres_changes || []).map(b => ({ ...b, id: nextId++ }));
        channels.set(topic, { joinRef, bindings });
        return send([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings } }]);
      }
      if (event === 'phx_leave') { channels.delete(topic); return send([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]); }
      if (ref) send([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]);
    });
  });
  return ctx;
}

const readChip = (page) => page.evaluate(() => {
  const b = document.querySelector('.nge-chat-online');
  // The list is open in the watched tabs; open it again if it closed.
  if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
  return new Promise(r => setTimeout(r, 300));
}).then(() => page.evaluate(() => {
  const b = document.querySelector('.nge-chat-online');
  const names = [...document.querySelectorAll('.nge-chat-online-name .nge-chat-online-who')].map(e => e.textContent.trim());
  return { chip: b ? b.textContent.trim() : '(no chip)', names };
}));

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const { chromium } = require(PW);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pages = { amy: [], Nseraf: [] };
  for (const [token, p] of Object.entries(PLAYERS)) {
    const ctx = await setupContext(browser, token);
    for (let i = 0; i < p.tabs; i++) {
      const page = await ctx.newPage();
      page.on('pageerror', e => { if (process.env.LOGERR) console.log('PAGEERR', p.username, String(e).slice(0, 200)); });
      await page.goto(`http://localhost:${PORT}/?quiet`, { waitUntil: 'domcontentloaded' });
      pages[p.username].push(page);
    }
  }
  const watch = { amy: pages.amy[0], Nseraf: pages.Nseraf[0] };
  // Open the online list in the two watched tabs once the chip is there.
  for (const page of Object.values(watch)) {
    await page.waitForSelector('.nge-chat-online', { timeout: 90_000 }).catch(() => {});
    await page.click('.nge-chat-online').catch(() => {});
  }
  console.log(`run: gateway ${path.relative(process.cwd(), FUNCS) || FUNCS}, app ${path.relative(process.cwd(), DIST)}, live updates ${LIVE ? 'on' : 'DOWN'}, amy's count starts at ${SEED} of 5000`);
  console.log('  t   amy\'s tab                       Nseraf\'s tab                    refused heartbeats');
  const samples = [];
  let sent = false;
  const until = Date.now() + MINUTES * 60_000;
  while (Date.now() < until) {
    if (!sent && Date.now() - t0 > 150_000) {
      sent = true; // Amy keeps chatting, as she did at 4:55 PM
      await watch.amy.evaluate(() => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
        pinia._s.get('chat').sendMessage('still here, chatting');
      }).catch(e => console.log('send failed', String(e).slice(0, 120)));
    }
    const s = { t: secs(), amy: await readChip(watch.amy).catch(() => ({ chip: '?', names: [] })), Nseraf: await readChip(watch.Nseraf).catch(() => ({ chip: '?', names: [] })), refused: stats.presence429 };
    samples.push(s);
    const cell = (v) => `${v.chip} [${v.names.join(', ')}]`.padEnd(32);
    console.log(`${String(s.t).padStart(4)}s ${cell(s.amy)} ${cell(s.Nseraf)} ${s.refused}`);
    await new Promise(r => setTimeout(r, 10_000));
  }
  console.log('gateway answers:', JSON.stringify(stats.gateway));
  console.log('presence rows written:', JSON.stringify(stats.presenceWrites), 'chat messages saved:', stats.chatPosted, 'live updates sent:', stats.liveSent);

  // Verdict, from the samples after everyone has had a minute to arrive.
  const late = samples.filter(s => s.t >= 60);
  const both = (v) => v.chip === '2 online' && v.names.includes('amy') && v.names.includes('Nseraf');
  const amyGone = (v) => v.chip === '1 online' && !v.names.includes('amy') && v.names.includes('Nseraf');
  const results = [];
  const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + detail : '')); };
  if (process.argv.includes('--expect-blink')) {
    // Control for the online window: no heartbeat refused, and still people drop out.
    const short = late.filter(s => !both(s.amy) || !both(s.Nseraf));
    check('control: someone drops out of "N online" with nobody refused', short.length > 0 && stats.presence429 === 0,
      short.map(s => `${s.t}s ${s.amy.chip}/${s.Nseraf.chip}`).join('; ') || 'none');
  } else if (EXPECT_BUG) {
    check('control: amy drops out of her own "N online" while chatting', late.some(s => amyGone(s.amy)), late.filter(s => amyGone(s.amy)).length + ' samples');
    check('control: and out of Nseraf\'s', late.some(s => amyGone(s.Nseraf)));
    check('control: her heartbeats were refused (429)', stats.presence429 > 0, stats.presence429);
    check('control: her chat message still went through', stats.chatPosted > 0);
  } else {
    check('amy sees "2 online" with herself and Nseraf in every sample', late.every(s => both(s.amy)), late.filter(s => !both(s.amy)).map(s => `${s.t}s ${s.amy.chip}`).join('; ') || 'all');
    check('Nseraf sees "2 online" with amy and Nseraf in every sample', late.every(s => both(s.Nseraf)), late.filter(s => !both(s.Nseraf)).map(s => `${s.t}s ${s.Nseraf.chip}`).join('; ') || 'all');
    check('no heartbeat refused', stats.presence429 === 0, stats.presence429);
    check('amy\'s chat message went through', stats.chatPosted > 0);
  }
  await browser.close();
  server.close();
  const ok = results.every(Boolean);
  console.log(ok ? 'ALL PASS' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
