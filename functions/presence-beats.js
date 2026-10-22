'use strict';

// Chat presence heartbeats (the "N online" list), for ewCommunityData.
//
// Every open Pyr tab says "I'm here" once a minute, all day. These used to be
// counted like any other change a player makes, against the gateway's write
// limit of 5,000 a day per player per table (and 20,000 a day for everyone).
// A player with five tabs open sends about 7,200 a day, so by mid afternoon
// every heartbeat was refused and they dropped out of "N online", for others
// and for themselves, while their chat messages (a different table) still
// went through (Ames 2026-10-21: gone from 3:05 to 7:52 PM, back when her
// 24 hour count started over).
//
// A heartbeat only refreshes the one row the server stamps for that player,
// so it gets its own limit instead: at most one write per player every
// BEAT_MS. A heartbeat inside that time is answered at once without touching
// the database (no identity reads, no write, no live update sent to every
// open chat): the row is at most BEAT_MS old, well inside the online window.
// This is per server instance, which is all a heartbeat needs.
const BEAT_MS = 20_000;

function presenceBeats({ ms = BEAT_MS, max = 5000, now = () => Date.now() } = {}) {
  const last = new Map(); // verified email -> time of the write in flight or done
  return {
    /** Null when this player's row was written under `ms` ago (answer without
     *  writing). Otherwise a claim: call release() if the write then fails, so
     *  the next heartbeat writes. */
    take(who) {
      const t = now(), prev = last.get(who);
      if (prev !== undefined && t - prev < ms) return null;
      last.delete(who);
      last.set(who, t);
      if (last.size > max) last.delete(last.keys().next().value);
      return {
        release() {
          if (last.get(who) !== t) return;
          if (prev === undefined) last.delete(who); else last.set(who, prev);
        },
      };
    },
  };
}

/** A presence heartbeat: the upsert of your own chat_presence row. */
const isPresenceBeat = (input) => input && input.table === 'chat_presence'
  && String(input.method || '').toUpperCase() === 'POST';

module.exports = { presenceBeats, isPresenceBeat, BEAT_MS };
