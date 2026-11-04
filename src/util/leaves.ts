/**
 * Falling leaves (Ames 2026-11-04: "can we make fall foliage fall from the
 * top of the site").
 *
 * In the fall (src/util/season.ts: from 22 September to the end of
 * Thanksgiving week), every five to ten minutes a light shower of autumn
 * leaves drifts down from the top of the screen, swaying and turning over as
 * it goes, and is gone in about ten seconds. The first comes half a minute or
 * so after Pyr opens.
 *
 * Every leaf that falls onto the chat stays there (Ames: "ALL the leaves
 * that fall onto chat should stay on chat. it ruins the illusion
 * otherwise"), so a pile builds up over the showers, stacked a little where
 * leaves meet. The pile rides on the chat's top edge as it moves or changes
 * size, hides while the chat sits faded and comes back when it opens. Only
 * the turkey, kicking through it on his walk, sends leaves flying
 * (src/util/turkey.ts calls kickLeaves); switching the leaves off clears it.
 *
 * They never get in the way: one see-through canvas that ignores the mouse,
 * made when the first leaf appears and taken away after the last one goes.
 * While only the pile is left, nothing moves: it looks four times a second
 * whether the chat moved, and redraws only then.
 *
 * The leaf button by the chat box (outside Thanksgiving week, when the turkey
 * button takes its place) and Settings, "Falling leaves", are one switch
 * (userPrefs.hideLeaves): off, the leaves go and the button goes grey; on, a
 * shower falls straight away. Calm screen keeps them away.
 */
import { useUserPreferencesStore } from '../store';
import { isCalm } from './calm';
import { fallSeason } from './season';
import { AUTUMN, leafShapes, leafVein, pick } from './leaf_shapes';

// Every five to ten minutes (Ames 2026-11-04).
const FIRST_MS = [25_000, 50_000], EVERY_MS = [5 * 60_000, 10 * 60_000];
/** The most leaves the pile on the chat holds. */
const MAX_RESTING = 80;

export function leavesSeason(): boolean { return fallSeason(); }

export function leavesHidden(): boolean {
  try { return useUserPreferencesStore().prefs.hideLeaves === true; } catch { return false; }
}

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const between = ([a, b]: number[]) => a + Math.random() * (b - a);
/** Leaves may show: in season, switched on, a lively screen, a visible tab. */
export const leavesOn = () => leavesSeason() && !leavesHidden() && !isCalm() && !reduced() && !document.hidden;
/** Switched off altogether (the pile goes too), as opposed to a hidden tab. */
const leavesOff = () => !leavesSeason() || leavesHidden() || isCalm() || reduced();

type Kind = 'fall' | 'rest' | 'blow' | 'kick';
interface Leaf {
  kind: Kind; x: number; y: number; vx: number; vy: number;
  size: number; rot: number; spin: number; flip: number; phase: number; squeeze: number;
  shape: Path2D; colour: string; alpha: number;
  // Falling: where it sways about, and how.
  baseX: number; fall: number; sway: number; freq: number;
  /** Falling: lands on the chat box if it meets it. */
  lands: boolean;
  /** Resting: where along the chat's top edge it lies, and how far up the
   *  pile (where leaves meet they stack). */
  relX: number; lift: number;
  /** Kicked up: seconds left. */
  life: number;
}

let leaves: Leaf[] = [];
let cv: HTMLCanvasElement | null = null, ctx: CanvasRenderingContext2D | null = null;
let W = 0, H = 0, dpr = 1, running = false, last = 0, time = 0;

function newLeaf(kind: Kind, x: number, y: number, size: number): Leaf {
  return {
    kind, x, y, vx: 0, vy: 0, size, rot: Math.random() * 6.283, spin: (Math.random() - 0.5) * 2.4,
    flip: 1.2 + Math.random() * 2, phase: Math.random() * 6.283, squeeze: 1,
    shape: pick(leafShapes()), colour: pick(AUTUMN), alpha: 0.9,
    baseX: x, fall: 0, sway: 0, freq: 0, lands: false, relX: 0, lift: 0, life: 0,
  };
}

/** The chat box leaves land on: the top of the chat panel while it is open,
 *  however tall (Ames 2026-11-04: "I thought they were supposed to land on
 *  top of chat!"), or minimized. Never while it sits faded (quiet): "only
 *  ... if chat is open or minimized, not in half hidden mode". */
function chatBox(): DOMRect | null {
  const panel = document.querySelector('.nge-chat-float');
  if (!panel || panel.classList.contains('nge-chat-float--quiet')) return null;
  const r = panel.getBoundingClientRect();
  return r.width && r.top > 40 ? r : null;
}

function blow(l: Leaf, dir = Math.random() < 0.5 ? -1 : 1) {
  l.kind = 'blow';
  l.vx = dir * (150 + Math.random() * 120);
  l.vy = -(50 + Math.random() * 70);
  l.spin = dir * (3 + Math.random() * 4);
}

function ensureCanvas() {
  if (cv && W === window.innerWidth && H === window.innerHeight) return;
  W = window.innerWidth; H = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.className = 'nge-leaves';
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    ctx = cv.getContext('2d');
  }
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:8999;`;
}

function clearAll() {
  leaves = [];
  cv?.remove(); cv = null; ctx = null;
  running = false;
}

function draw() {
  const c = ctx;
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const vein = leafVein();
  const box = chatBox();
  for (const l of leaves) {
    // The pile sits on the chat's top edge, wherever the chat is now, and
    // is not drawn while the chat is faded or closed.
    if (l.kind === 'rest') {
      if (!box) continue;
      l.x = box.left + Math.max(6, Math.min(box.width - 6, l.relX));
      l.y = box.top - l.size * l.squeeze * 0.5 - l.lift;
    }
    if (l.kind === 'fall') l.x = l.baseX + Math.sin(time * l.freq * 6.283 + l.phase) * l.sway;
    const sq = l.kind === 'rest' ? l.squeeze : 0.25 + 0.75 * Math.abs(Math.cos(time * l.flip + l.phase));
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.translate(l.x, l.y);
    c.rotate(l.rot);
    c.scale(l.size * sq, l.size);
    c.globalAlpha = l.alpha;
    c.fillStyle = l.colour;
    c.fill(l.shape);
    c.globalAlpha = l.alpha * 0.4;
    c.lineWidth = 0.06;
    c.strokeStyle = '#5a2a10';
    c.stroke(vein);
  }
  c.globalAlpha = 1;
}

let lastBox = '';
function step(now: number) {
  if (leavesOff()) { clearAll(); return; }
  // A hidden tab: keep everything, look again later.
  if (document.hidden) { setTimeout(() => { last = performance.now(); requestAnimationFrame(step); }, 1000); return; }
  ensureCanvas();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; time += dt;
  const box = chatBox();
  let resting = leaves.filter(l => l.kind === 'rest').length;
  for (const l of leaves) {
    if (l.kind === 'fall') {
      const before = l.y;
      l.y += l.fall * dt;
      l.rot += l.spin * dt;
      // Lands on the chat box: lies nearly flat on its top edge.
      if (l.lands && box && resting < MAX_RESTING && l.x > box.left + 8 && l.x < box.right - 8) {
        // Lying on its side, half its squeezed width above the edge, so all
        // of it shows on top of the chat panel (which is drawn over this
        // layer) instead of half of it tucking behind.
        const squeeze = 0.45 + Math.random() * 0.3, top = box.top - l.size * squeeze * 0.5;
        if (before < top && l.y >= top) {
          l.kind = 'rest'; l.relX = l.x - box.left;
          // Stacks a little on the leaves already lying where it lands.
          const under = leaves.filter(o => o.kind === 'rest' && o !== l && Math.abs(o.relX - l.relX) < 12).length;
          l.lift = Math.min(5, under) * 3;
          l.rot = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1) + (Math.random() - 0.4) * 0.3;
          l.squeeze = squeeze;
          resting++;
        }
      }
    } else if (l.kind === 'blow') {
      l.vy += 140 * dt;
      l.x += l.vx * dt; l.y += l.vy * dt;
      l.rot += l.spin * dt;
    } else if (l.kind === 'kick') {
      // Kicked up by the turkey: a little arc, fading out.
      l.vy += 420 * dt;
      l.x += l.vx * dt; l.y += l.vy * dt;
      l.rot += l.spin * dt;
      l.life -= dt;
      l.alpha = Math.max(0, Math.min(0.9, l.life * 1.5));
    }
  }
  leaves = leaves.filter(l => l.kind === 'rest' || (l.y < H + 40 && l.x > -60 && l.x < W + 60 && (l.kind !== 'kick' || l.life > 0)));
  if (!leaves.length) { clearAll(); return; }
  // Only the pile left: nothing moves, so redraw only when the chat moved,
  // and look again a little later.
  if (leaves.every(l => l.kind === 'rest')) {
    const key = box ? `${box.left},${box.top},${box.width}` : '';
    if (key !== lastBox) { lastBox = key; draw(); }
    setTimeout(() => { last = performance.now(); requestAnimationFrame(step); }, 250);
  } else {
    lastBox = '';
    draw();
    requestAnimationFrame(step);
  }
}

function run() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(step);
}

/** One shower. */
export function shower() {
  if (!leavesOn() || leaves.some(l => l.kind === 'fall')) return;
  ensureCanvas();
  const n = Math.max(12, Math.min(36, Math.round(W / 50)));
  for (let i = 0; i < n; i++) {
    const l = newLeaf('fall', Math.random() * W, -30 - Math.random() * H * 0.7, 18 + Math.random() * 16);
    // A little faster than at first (Ames: "They should fall a little faster").
    l.fall = 75 + Math.random() * 55;
    l.sway = 18 + Math.random() * 40;
    l.freq = 0.5 + Math.random() * 0.7;
    l.lands = true;
    leaves.push(l);
  }
  // A few more over the chat box, so a little pile always gathers there.
  const box = chatBox();
  if (box) {
    for (let i = 0; i < 4; i++) {
      const l = newLeaf('fall', box.left + 20 + Math.random() * Math.max(0, box.width - 40), -30 - Math.random() * H * 0.5, 18 + Math.random() * 16);
      l.fall = 75 + Math.random() * 55;
      l.sway = 8 + Math.random() * 12;
      l.freq = 0.5 + Math.random() * 0.7;
      l.lands = true;
      leaves.push(l);
    }
  }
  run();
}

let lastKick = 0;
/**
 * The turkey's feet at (x, y) on screen, walking toward `dir` (1 right, -1
 * left): now and then a leaf or two flies up behind him, and any leaf resting
 * near his feet is sent flying.
 */
export function kickLeaves(x: number, y: number, dir: number) {
  if (!leavesOn()) return;
  const now = performance.now();
  for (const l of leaves) {
    if (l.kind === 'rest' && Math.abs(l.x - x) < 45 && Math.abs(l.y - y) < 40) blow(l, dir);
  }
  if (now - lastKick > 380 + Math.random() * 400) {
    lastKick = now;
    ensureCanvas();
    const count = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const l = newLeaf('kick', x - dir * 12, y - 4, 10 + Math.random() * 8);
      l.vx = -dir * (40 + Math.random() * 90);
      l.vy = -(150 + Math.random() * 120);
      l.spin = (Math.random() - 0.5) * 9;
      l.life = 0.9 + Math.random() * 0.5;
      leaves.push(l);
    }
  }
  if (leaves.length) run();
}

/** The leaf button: leaves off (grey button), or back on with a shower now. */
export function toggleLeaves() {
  const hide = !leavesHidden();
  try { useUserPreferencesStore().save({ hideLeaves: hide }); } catch { return; }
  if (!hide) shower();
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(range: number[]) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; shower(); schedule(EVERY_MS); }, between(range));
}

let started = false;
export function startLeaves() {
  if (started || !leavesSeason()) return;
  started = true;
  schedule(FIRST_MS);
}
