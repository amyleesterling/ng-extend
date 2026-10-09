# Handoff: 2D images load slowly across the site

From Ames, 2026-10-09: "investigate why 2D is loading slowly across the site in many places." Written by the session that launched the Loyalty Achievements, so this can have its own dedicated chat.

**Nothing has been measured yet.** This file gives the starting facts, where the code is, and an order to work in. Everything under "Guesses" is a guess.

## What is being asked

Find out why the 2D view (the cross section images, shown as "2D EM" or "2D images" in the layer tabs) is slow to fill in, in many places, and fix the cause. Not the loading sign: the loading itself.

## Ask Ames first

The report is one sentence. Before measuring, get:

1. **Where.** Which datasets (Retina, MEC, Sandbox, MICrONS, BANC, FlyWire, CA3, H01) and which places in the game (free exploring, a claimed cell, tutorials, practice cells, the Cell Library jump, a shared link).
2. **Who.** Her own machine, or reports from players. If players, which ones and on what connection or device.
3. **Since when.** Always, or after a particular day. The game deploys many times a day, so a date narrows it to a handful of commits.
4. **What slow looks like.** Grey panel for seconds, blocky images that sharpen late, or images that never sharpen until the view is nudged.

## Facts (read from the code on 2026-10-09, branch `eyewire-ii-community` at `126c97b`)

- **Memory limits are set by the game at start:** GPU 2 GB, system 3 GB (`src/store.ts`, `initializeWithViewer`, about line 424). Tutorial 1's saved state carries the same numbers (`src/tutorial-1.ts`).
- **A loading sign already exists:** `src/util/image_loading_hint.ts`. It polls every 400 ms, reads each visible image layer's `layerChunkProgressInfo` (`numVisibleChunksNeeded`, `numVisibleChunksAvailable`), and shows a card after the view has sat still for 2.5 s without filling. Its header records one known cause: **the Sandbox image is stored uncompressed, about 3.8 MB a piece, and a 2D view needs about twenty pieces** (a player, Annkri, reported exactly that dataset).
- **A coarse detail setting can be saved into a view.** `src/practice.ts` (about line 908) forces `sliceViewRenderScaleTarget` back to 1 on practice views because a saved view drew the images as grey blocks and counted as fully loaded, so no sign showed. That fix covers practice views only.
- **Panels have needed a rebuild to sharpen.** Commit `91d7e98` (2026-10-08): "Tutorials: the 2D panel is rebuilt once after opening, so the images sharpen without pressing Space twice." That is a symptom of the same family: the view not asking for the right pieces until something forces it.
- **The Cell Library clamps zoom on a jump:** `src/components/CellLibraryPanel.vue` about line 1691 sets `crossSectionScale` to 4 when it is above 5.
- **neuroglancer is a pinned fork:** `github:seung-lab/neuroglancer#737a902c8740ff37500ba0f2f658beacbbdd7c5a` in `package.json`. One tracked file under `node_modules/neuroglancer` is patched in the repo (`sliceview/wire_frame.ts`), and `npm ci` overwrites it.
- **Recent 2D related commits** (find more with `git log -i --grep="2D\\|loading\\|slice"`): `dc0c389` and `956cf88` (the loading sign, 2026-10-06), `5ad287c` (practice views at full detail, 2026-10-07), `48190bc` (sign waits for a still view, 2026-10-08), `91d7e98` (tutorial panel rebuild, 2026-10-08).

## Guesses, in the order I would test them

1. **The data itself is heavy on some datasets.** Uncompressed or large image pieces (known for the Sandbox). Check each dataset's image source: format, piece size, bytes per piece, whether the server compresses, and response times. If this is it, the fix is on the data or its host, not in the game.
2. **Too much is being requested.** A view at high detail, a large panel, or several image layers visible at once multiplies the pieces needed. Compare `numVisibleChunksNeeded` across places and layouts.
3. **The view is not asking until nudged.** The "rebuild the panel" and "coarse detail" fixes suggest views restored from a saved state can sit at the wrong detail or size. Look for a panel that reports itself complete while blocky, or needs a move to start.
4. **The game is competing with the loading.** Polls and watchers on the main thread (the loading sign itself every 400 ms, practice watchers, highlight, annotation counting, chat) or work that makes neuroglancer redo its piece list. Profile a still view while it fills.
5. **The memory limits evict pieces that are still needed,** so they are fetched again. Watch the piece queue while panning back and forth over the same place.
6. **Segmentation and meshes crowd out the images.** If image pieces queue behind mesh or segmentation requests, the 2D panel waits. Check the request order in the network panel.

## How to measure, so the answer is a number

- **Always measure against a control.** The same saved state opened in plain neuroglancer (no game) is the control: if it is just as slow there, the game is not the cause.
- **Network panel:** for one still view, count image requests, bytes each, time each, how many run at once, and whether any repeat.
- **In the page:** read `layerChunkProgressInfo` on each image layer over time (the loading sign's `imageProgress` shows how) to get time to full for a view.
- **Per dataset and per place:** a small table of time to full, pieces needed and bytes, for each dataset and each place Ames names.
- **A tab that is not on screen does not animate.** The browser pane used by Claude sessions can be hidden, and a hidden tab never draws, so timings from it are meaningless. Use Playwright or a visible window.

## Working rules for this repo

- **Call her Ames.**
- **Iterate on the dev server, never on production.** `npm run dev-server-win`. Use `npm ci --legacy-peer-deps`; plain `npm install` crashes on her machine.
- **Two remotes.** `amy` is her fork and the routine push target. Pushing `origin`'s `eyewire-ii-community` deploys to production; do that only when she says "deploy". Other branches pushed to `origin` become test sites that close after a day.
- **Other sessions deploy to production many times a day.** Rebase before any push, and never force push `origin`.
- **Every deploy a player can notice adds an entry at the top of `static/changelog.json`** (see CHANGELOG-RULE in `README.md`).
- **Player text:** the game is called Pyr; no em or en dashes; "Achievement", never "badge".
- **Use the shared kanban board** (github-kanban tools) from the start: list, claim, note, hand off.
- **Verify before asserting,** and say what was not checked. A push is not a deploy; check the live site.
- **Do not paper over it.** Changing when the loading sign appears does not make anything load faster. Report the cause first, then propose the fix.

## First steps

1. Ask Ames the four questions above.
2. Reproduce one slow place she names, on the dev server and on production, and time it.
3. Open the same state in plain neuroglancer and time it. That splits "the data" from "the game".
4. Work down the guesses in order, with a number for each one ruled in or out.
5. Show Ames the table and the cause before changing anything.
