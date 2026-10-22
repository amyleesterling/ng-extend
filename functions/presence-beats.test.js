const test = require('node:test');
const assert = require('node:assert/strict');
const { presenceBeats, isPresenceBeat, BEAT_MS } = require('./presence-beats');

test('one heartbeat write per player per 20 s, the rest answered without writing', () => {
  let t = 0;
  const beats = presenceBeats({ now: () => t });
  assert.ok(beats.take('amy@x'));                 // first of five tabs at :00 writes
  for (let i = 0; i < 4; i++) assert.equal(beats.take('amy@x'), null);
  assert.ok(beats.take('nseraf@x'));              // another player is not held up
  t = BEAT_MS - 1; assert.equal(beats.take('amy@x'), null);
  t = BEAT_MS; assert.ok(beats.take('amy@x'));
});

test('a day of five tabs never runs out, and writes about once a minute', () => {
  let t = 0, writes = 0, answered = 0;
  const beats = presenceBeats({ now: () => t });
  // Five tabs, one a minute each, at spread out seconds (one hidden tab at :00).
  const phases = [0, 0.4, 18, 31, 47].map(s => s * 1000);
  for (let minute = 0; minute < 24 * 60; minute++) {
    for (const p of phases) { t = minute * 60_000 + p; beats.take('amy@x') ? writes++ : answered++; }
  }
  assert.equal(writes + answered, 7200);
  assert.ok(writes <= 3 * 24 * 60, `${writes} writes`); // never more than one per 20 s
  assert.ok(writes >= 24 * 60, `${writes} writes`);     // and at least one a minute
});

test('a failed write is released so the next heartbeat writes', () => {
  let t = 0;
  const beats = presenceBeats({ now: () => t });
  beats.take('amy@x').release();
  t = 1000; const claim = beats.take('amy@x');
  assert.ok(claim, 'written again straight away');
  t = 30_000; assert.ok(beats.take('amy@x'));     // the newer claim stays
  claim.release();                                // an old claim cannot undo it
  t = 31_000; assert.equal(beats.take('amy@x'), null);
});

test('only the presence upsert counts as a heartbeat', () => {
  assert.equal(isPresenceBeat({ table: 'chat_presence', method: 'POST' }), true);
  assert.equal(isPresenceBeat({ table: 'chat_presence', method: 'DELETE' }), false);
  assert.equal(isPresenceBeat({ table: 'chat_presence', method: 'GET' }), false);
  assert.equal(isPresenceBeat({ table: 'chat_messages', method: 'POST' }), false);
});

test('the list of players stays bounded', () => {
  let t = 0;
  const beats = presenceBeats({ now: () => t, max: 3 });
  for (const p of ['a', 'b', 'c', 'd']) beats.take(p);
  assert.ok(beats.take('a'), 'the oldest was dropped, so it writes');
});
