# Handoff: a detailed stats page for EyeWire II

Paste this into a new chat to start the work.

---

You are adding a detailed stats page to EyeWire II, the citizen science
proofreading game built on neuroglancer. It should feel like the rest of the
game: the dark hologram and HUD style of Ames's scifi-ui library. Call her
Ames.

Repo: `seung-lab/ng-extend`, branch `eyewire-ii-community`. Vue 3 and Pinia
on top of a vendored neuroglancer.

## Before you write anything

1. **Claim a card** on the github-kanban board (ToolSearch the
   `mcp__github-kanban__*` tools first; agent `claude`, repository
   `seung-lab/ng-extend`). Leave a verified handoff when you stop.
2. **Make your own worktree** from `origin/eyewire-ii-community`. Do not work
   in `C:\Users\amyle\ng-extend`: several sessions share it and it is usually
   behind or diverged. Fetch before every rebase; the live branch moves many
   times a day.
3. In the new worktree run `npm install --legacy-peer-deps` (plain
   `npm install` crashes on this machine). `node_modules/neuroglancer` is
   tracked in git, so do not replace `node_modules` with a link, and restore
   it with `git checkout -- node_modules package-lock.json` after installing.
4. **Read these first**, in this order:
   - `C:\Users\amyle\scifi-ui\AGENTS.md` (the style rules, and why)
   - `docs/LEADERBOARD-ACCURACY.md` (what every number means)
   - `src/components/WeeklyRecapPanel.vue` and `UserProfilePanel.vue` (the
     stats that already exist, and how they are styled)

## Decide with Ames before building

"A detailed stats page" is not specified further. Bring her a short proposal
(a list and a rough layout, not code) covering:

- **Where it lives.** A new tab in the profile panel (it already has
  Overview, Trophy Case, My Cells, Datasets, Week in Science), its own
  full panel opened from a toolbar icon, or a replacement for Week in
  Science. On phones the top bar has no icon toolbar, so say how a phone
  reaches it.
- **Whose stats.** Your own only, any player's (the profile already takes a
  `viewUserId`), or the whole community too.
- **Which stats.** See the inventory below for what the data can support.
- **Time.** Rolling windows (24 hours, 7 days) or calendar weeks and months.
  They are different spans and show different numbers; the leaderboard doc
  explains.

Do not start the build until she has picked.

## The numbers, and the rules about them

These are counts of edits and completed cells. Not a scoring system. Never
call them points or a score.

The counting was audited and rebuilt on 2026-10-05. The rules that matter:

- **Never recount in the browser with your own rule.** Every "cells" number
  comes from one rule. Use the database's copy or the app's copy, never a
  third.
  - Database: view `ew_cell_completions` (one row per player, dataset and
    cell, with `done_at`), view `user_edit_counts` (the board's numbers,
    plus `edits_logged` and `completions_logged`), function
    `ew_weekly_ranking(p_week_start, p_metric, p_limit)` for a completed
    Monday to Monday UTC week.
  - App: `src/util/completion_rule.ts` (`completedCells(rows)`), used by
    `src/util/dataset_contribution.ts`. A test keeps it identical to the SQL.
- **An edit** is one split or merge the graph server accepted:
  `edit_log` rows with `operation in ('split','merge')` and
  `success is not false`. One row is one edit. Ignore `metadata.diff`.
- **Only edits made in the game count.** Do not pull a player's wider CAVE
  history into a stat.
- **Saved all-time totals** (`users.total_edits`, `cells_completed`,
  `total_annotations`, `current_streak`, `longest_streak`) are moved by the
  server only. The browser can not write them. Read them; never try to
  write them.
- **All-time cells can exceed what the log holds** for a few early players,
  because completions from before the log existed are in the saved total
  only. If a chart built from the log does not add up to the saved total,
  that is why. Say so on the page rather than hiding it.
- **`edit_log.task_id` on a `mark_complete` row is the task that happened to
  be active**, not necessarily the cell that was marked. Trust task ids only
  on `complete_task` rows.
- **The time column is `edit_log.timestamp`.** There is no `created_at`.
- **A stat that can not be read is "not available", never zero.** Follow
  `LeaderboardPanel.vue`: explicit loading, unavailable and empty states,
  no made-up or demo data, ever.
- **Two channels for one quantity read from one source.** If a number
  appears as a figure and as a bar, compute it once.

### What the data can support

Readable with the app's public key (through `src/supabase.ts`):

| Source | What it gives |
|---|---|
| `edit_log` | Every logged action with `timestamp`, `operation`, `dataset`, `success`, `metadata`, `op_key`. Operations: split, merge, mark_complete, unmark_complete, complete_task, claim_task, release_task, set_cell_type, annotate. Enough for edits per day, splits against merges, activity by hour or weekday, per dataset breakdowns, cells per week. |
| `ew_cell_completions` | Each completed cell with when it was completed and on which dataset. |
| `user_edit_counts` | Per player: all-time, 7 day and 24 hour edits and cells, streaks. |
| `weekly_winners` | Saved weekly podiums, edits and cells, back to April 2026. |
| `badge_awards`, `special_badge_awards`, `special_badges` | Badges earned. |
| `help_requests`, `help_responses`, `issue_tags` | Second opinions asked and given, tags placed and resolved. |
| `cave_completions_mirror` | Older retina completions from CAVE, keyed by CAVE user id. Lags by days and has no MEC. A supplement to the log, never the reference. |
| `proofreading_tasks` | Cell Library tasks: claimed, completed, by dataset. |

Datasets carry tag variants in old rows (`eyewire_ii` is the retina). Use
`datasetTagVariants` and `canonicalDataset` from `src/datasets.ts` and
`dataset_contribution.ts`, not string matching of your own.

Read a player's log a page at a time (`.range()`, 1000 rows), ordered by
`timestamp` then `id`. There are under 2,000 log rows today, but do not
write anything that assumes that.

If the page needs a number that would mean reading the whole log for every
player in the browser, ask for a database view or function instead, write
the SQL as a new `supabase-*.sql` file (safe to re-run, changes no existing
rows), test it on the in-memory PostgreSQL the way
`functions/leaderboard-accuracy.test.js` does, and give the file to Ames.
You can not run SQL in production; she runs it in the Supabase editor.

## The look

Source of truth for style: `C:\Users\amyle\scifi-ui`
(https://github.com/amyleesterling/scifi-ui, live at
https://amyleesterling.github.io/scifi-ui). Motion ideas:
https://amyleesterling.github.io/experimental-UI/ (pages: motion, models,
spatial, applied, playground), whose tag line is "interfaces that move
because something is happening".

- **Carry real values across.** scifi-ui's first rule is that components are
  extracted from shipping code, never approximated. For this page that runs
  the other way too: open the component file, read its whole stylesheet, and
  use its numbers. Do not rebuild a look from memory of how it appears.
- **Start from what the game already has**, so the page matches its
  neighbours: `WeeklyRecapPanel.vue` (stat tiles, `RollUp.vue` for numbers
  that count up), `LeaderboardPanel.vue`, `UserProfilePanel.vue`
  (`nge-profile-section-label`, the three column Overview),
  `NotificationFeedPanel.vue` (the Weekly Champions podium),
  `src/util/panel_collapse.ts` (the morph and light beam used when panels
  open and shrink), `src/find_path_status.ts` (the generative path search
  loader, a good model for a loading state that is not a spinner).
- **Useful scifi-ui parts for stats:** `data-readout`, `neural-hud`,
  `holo-timeline`, `recap-roll`, `panel-surface`, `letter-reveal`,
  `path-search`. Read each one's header and its demo in
  `components/index.html` before using it.
- **Motion means something.** Only ambient things loop; everything else runs
  once. A number rolls up because it was just loaded; a bar grows because
  it is being drawn. Nothing animates forever on a page nobody is looking
  at. Honour `prefers-reduced-motion`.
- **Ames's standing preferences:**
  - No em or en dashes anywhere a player can read. Commas and periods.
  - No gradient text.
  - No thin italic on dark backgrounds.
  - Unit symbols (µm, nm) are never uppercased by `text-transform`.
  - Side panels are narrow panels, not full screen overlays, on desktop.
  - Real data only. No mock numbers, placeholder charts or sample players,
    not even while loading.
- **Charts.** There is no chart library in the app and you should not add a
  heavy one. The existing visuals are hand drawn SVG and canvas. Do the
  same, in the HUD line style (thin strokes, the cyan `126 224 255` and
  blue `74 158 255` accents used across the panels, amber for trophies).

## How things are wired

- **A toolbar icon:** add to `TOOLBAR_ICON_DEFS` in
  `src/data/toolbar-icons.ts` (inline SVG, 16 unit viewBox, the shared `S`
  style), then handle its id in `ExtensionBar.vue` (`showX` ref, the icon
  click switch, `isIconActive`, the open panel list near line 513). Icons
  that should appear for existing players need an auto inject entry with a
  marker; read `resolveToolbarOrder` before touching it.
- **A profile tab:** `UserProfilePanel.vue`, the `activeTab` union near
  line 155 and the tab strip in the template. Tabs lazy load on first open
  (see the `watch(activeTab, …)` calls).
- **A modal panel:** `ModalOverlay.vue` wraps Profile, Leaderboard,
  Settings and Recap. The leaderboard's `peek` mode shows how a panel can
  sit on top without dimming the page.
- **Phones:** `body.nge-mobile` and `src/mobile.css`. Floating panels
  become bottom sheets, modals go full screen, inputs must be 16px. The
  bottom nav is in `ExtensionBar.vue`. Check the page at phone width.
- **Stores:** `src/store.ts` is one large file of Pinia stores
  (`useUserStatsStore`, `useProofreadingBackendStore`, and more). The local
  stats store is a per browser tally and is wrong across devices; prefer
  reading the database, as `WeeklyRecapPanel.vue` does.
- **Vue files are not type checked by the build.** A wrong identifier in a
  `.vue` file fails at runtime, silently. Check names and imports by hand.
- **Never toggle a class by hand on a Vue rendered element**; the next
  render wipes it. Bind it with `:class`.
- Files mix CRLF and LF. Keep each file's own line endings.

## Building, testing, shipping

- `npm run build` writes `dist/min`. It prints about a thousand type errors
  from neuroglancer's spec and benchmark files; those are old noise. What
  matters is any `X [ERROR]` line and any error under `src/`.
- Serve the build with
  `python -m http.server <port> --directory dist/min` and test with
  Playwright from `C:/Users/amyle/hidden-worlds/node_modules/playwright`
  (Chrome at
  `C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`,
  swiftshader flags for WebGL). Do not use the hidden Browser pane for
  anything animated: its tabs can be `document.hidden`, and
  `requestAnimationFrame` never fires.
- To get past the login screen in a test, set the pinia stores through
  `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`.
  **Intercept every call to the server functions**
  (`cloudfunctions.net`, `run.app`) and every non GET call to Supabase in
  your test, so a test can never write to production.
- Look at screenshots of your own work before you say it is done. Check an
  empty player, a busy player, the unavailable state, and phone width.
- **Shipping.** Remote `amy` is Ames's fork: push there freely. Remote
  `origin` is the lab's repo, and every push to `eyewire-ii-community`
  there deploys the live game. Push to `origin` only when Ames says
  "deploy", after a fetch and rebase. Then find the run by its head SHA
  (`gh run list --workflow on_dev_branch_push.yml --json databaseId,headSha`),
  watch it, and confirm from the live site
  (`https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com`,
  grep the bundle for a string only your build has). A push is not a
  deploy. Pushing any other branch name to `origin` builds a test site at
  `<branch>-dot-brain-wire-dot-seung-lab.ue.r.appspot.com`, which is the
  way to let Ames try it on her phone; delete the branch afterwards.
- **Server code** lives in `functions/` and is deployed separately to
  Firebase project `eyewire-ii-e4d52`. A stats page should not need it. If
  you think it does, stop and ask. Lesson from 2026-10-05: a server branch
  that only switched on after a database change broke every profile read
  for about twenty minutes, because it was tested before the change
  existed. Test the state the system will be in, not the one it is in.
- Never rewrite history or force push a shared branch. Undo with a revert
  commit.
- Never print keys or tokens. The public Supabase key in `src/supabase.ts`
  is public by design; nothing else is.

## What done looks like

- Ames picked the place, the audience and the stats, and what shipped
  matches.
- Every number on the page can be traced to one of the sources above, and
  agrees with the leaderboard and Week in Science for the same player and
  span.
- Loading, empty, unavailable and phone states exist and were looked at.
- No dashes in copy, no demo data, nothing looping that is not ambient.
- Deployed on her word, verified from the live URL, and the kanban card
  carries the handoff.
