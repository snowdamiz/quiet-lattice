# P1.E04.T06 source map

Sealed 2026-11-07. Lane: independent source read of `f1766f0`. No checkout, no writes to HUD, Cockpit, style, capture, or remote files, no tests, no capture, no Blender, no GPU, no native, no browser, no push, no PR, no merge.

This is a source map. It is not a CPU pass, a smoke pass, or a visual grade.

## Pins

| Item | Value |
|---|---|
| Read from | `/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab` via `git show` / `git grep` |
| Reader HEAD | `8026dc55308fc850da4730870fe5ccd59ef483e5` (`Retain incomplete Lark source checkpoint receipts`) |
| Plan | `docs/IMPLEMENTATION_PLAN.md` at that HEAD, lines 204–205, marker `[R]` |
| Candidate | `f1766f0db294bbd325cfa43e4b1494adc2dd0baf` |
| Tree | `aa5bbb8a415a64e6641b3198f0c76c25cde3448b` |
| Branch tip | `codex/task/P1-E04-T06` is exactly `f1766f0` |
| Parent of tip | `c60c20876696953a056083aaf7e4de748e22e4e6` |
| Merge-base with reader HEAD | `ba2c07316291e04c68755d0c601d1654002befb9` |
| Ancestry | `f1766f0` is not an ancestor of `8026dc553` |
| Checkout | branch is not checked out in `git worktree list` |
| Plan blob at the pin | `0346fc538a1424e4fb0895f8b4aa2b2242597140` (line 204 is still `[ ]`; line 205 does not exist there) |
| Plan blob at reader HEAD | `cc4fd05ffbc780f9bf059967e7c9985b3b23f553` |

While this read was open, that checkout advanced by two commits this lane did not make: `78f61c16a` and `a7304884b2c7e81a052dc472d1c020051c0fdbdd` (`Retain Mule bake timeout and Lark performance diagnosis`, 2026-11-07 14:37:50 -0500). The plan blob is unchanged. `HUD.js` and `Cockpit.js` are unchanged between `8026dc553` and `a7304884`. `f1766f0` is still not an ancestor.

Eight commits sit on the branch after the merge-base. The tip changes one line. The criteria below are in the tree, from the earlier seven commits.

Lark hold checked and not entered: `/Users/andreyyurlov/.t3/worktrees/space/t3-7d211d96` is `6445c7ec07aa` on `t3/7d211d96`. The audit’s older Lark HEAD is stale. No Blender call.

## Tip delta

`f1766f0` changes only `packages/client/src/ui/HUD.js` (blob `ca278071c42673e52fd128278d80b12997bfa424`).

`HUD.js:916` replaces `classList.remove('out')` with `classList.toggle('out', false)` on a pilot mark that is in view. Both clear the `out` class. The call still runs every shown frame. The subject “skip redundant pilot visibility class updates” is not what the patch does. This line is not one of the plan sentences.

Reader HEAD still has `classList.remove('out')` at `HUD.js:912`.

## Criterion map

Plan sentences are the reader-HEAD text at lines 204–205. “Source” means the text is in the `f1766f0` tree. Tests named below were read and not executed.

| Plan sentence | Class | Where |
|---|---|---|
| Full `#E9E7E2` inside about 500 m, about 70% past 1 km | Source | `packages/client/src/remote/markers.js:41-44` `pilotInk`. At or inside 500 m the mix weight is 1, so the channels are 233,231,226. At or past 1 km the weight is 0.7, blended toward halo `rgb(11,12,14)`. `style.css:1170` sets the unfaded label to `#e9e7e2`. Inline `HUD.js:981` overrides that with `pilotInk(m.dist)`. |
| Still 4.5:1 on their halo | Source formula, unread pixels | `markers.test.js:18-24` asserts `pilotInk(10000)` against halo `11,12,14` is at least 4.5. That test was not run. Contrast on a real sky, ground, or hull is visual-only and was not graded. |
| Names for the nearest 8 plus the crosshair pilot; the rest keep diamond and range | Source | `markers.js:22-38` `PILOT_NAMES = 8`, `selectNames`. `RemoteEntities.js:169-177` feeds `markers()` nearest first. `Game.js:1346-1347` appends those pilots in that order. `HUD.js:926` names from the on-screen subset, so off-screen pilots do not consume the eight. `HUD.js:1037` writes the name only when `p.named`, and always writes the range when a side fits. A side with no room keeps the diamond and drops the range label too (`placePilotLabel`). Crosshair means the on-screen mark closest to screen center. |
| Fading label moves with its diamond and reaches zero in about 150 ms | Source, unread pixels | `markers.js:23` `FADE_MS = 150`, `fadeTo` at `49-58`. `HUD.js` `holdLabel` moves the reserved box with the diamond and leaves `lbl.style.translate` empty. Inline opacity is the fade. `style.css` dropped the 0.15 s opacity transition on `.marker.player` and `.lbl`. `pilotMarkers.test.js` (fade loop around lines 90–113) encodes the 150 ms zero and the box tracking. Not run. Motion on screen is visual-only. |
| Diamond stroke full teal `#8FD3C8` with its keyline | Source color, unread pixels | `style.css:1152-1160`: 6 px icon, `border-color: #8fd3c8`, `box-shadow` 1 px `#0b0c0e` outside and inset. `--accent2` at `style.css:14` is the same hex. Painted pixels were not graded. |
| Far name dropped or dimmed to about 40% over a nearer hull | Source as drop | `HUD.js:928-929` sets `named` false when `occludesMarker` is true. Range and the diamond stay (`pilotMarkers.test.js:116-124`). There is no 0.4 opacity path. `RemoteEntities.js:180-191` `occludesMarker` rays the drawn hull. `RemoteShips.js:204-237` `covers` hits the current LOD and folded gear, skips exhausts, and clips to the camera interval and to the target’s distance, so only a nearer hull counts. The 40% alternative is absent. The plan’s “dropped or dimmed” is met by the drop. |
| Sensors clip: one pilot beyond reach, one boosting at the edge | Source scene, visual show | `replay.js:210-231` `crowdSensorsTicks`. `replay.test.js:112-140` expects id 223 undetected past 4000 m and id 224 boosting, detected, reach 8000 m, distance in (7600, 8000). `screens.ts:2492-2499` screen `remote-ships-crowd-sensors` plays `crowdSensors` and adds `sensorsOverlay`. The test was not run. Whether a capture frame shows that pair is visual-only. |
| NPC ship in that clip once P1.E08.T05 lands | Absent, and not due | `replay.js:211` and `screens.ts:2493` say NPC evidence waits. Reader plan line 289: `P1.E08.T05` is still `[ ]`. |
| Shield arc, hull bar, cockpit SHIELDS use `shieldMax` / `hullMax`, plating to 125 | Source at the pin; absent on the reader HEAD | Pin: `HUD.js:495-496` shield arc; `HUD.js:531` hull bar; `Cockpit.js:139` SHIELDS. `poolDisplays.test.js` and `poolCaptures.test.js` expect 125 with `shield_capacitor` and `hull_plating`, and 100 without. Not run. Reader HEAD still divides by 100: `HUD.js:497`, `HUD.js:531`, `Cockpit.js:139`. The plan’s `:497` and `:531` are the reader-HEAD lines, not the pin’s shield line. On the pin the hull bar is still line 531. |
| Hostile-sky hull percentage and 35% warning/alarm | Source at the pin; absent on the reader HEAD | Pin `HUD.js:512-524`. Fraction is `ship.hull / ship.stats.hullMax`. Text is `Hull ${Math.ceil(100 * hull)}%`. `critical` when biting and fraction `< 0.35`. Alarm when that is true and `ship.shield <= 0` and `g.time - this._alarmT > 1.6`, then `audio.play('alarm')`. `poolDisplays.test.js:70-104` locks Hull 82% at 0.81201, no critical and no alarm at exactly 0.35 even with shield 0, critical at 0.349, alarm only after shield hits 0, no second alarm at 1.6 s, second alarm just after, and no hull text when `hazardLevel` is 0. Not run. Reader HEAD `HUD.js:518-521` still prints `Math.ceil(ship.hull)` and compares `ship.hull < 35` (raw points). |
| Keep depleted-shield condition and alarm cadence; display only, not combat authority | Source | Same `ship.shield <= 0` and `> 1.6` as the reader HEAD. Diff from the merge-base to `f1766f0` has no combat, damage, authority, or `Ship.js` path. Product files are the 15 listed below. |
| Verify: marker/meter behavior tests | Source present, not executed | Files below. |
| Verify: smoke | Source present, not executed | `packages/tools/src/smoke/remote-markers.spec.ts:169` rejects more than nine visible names. Not run. |
| Verify: visual UI rubric on remote-ships captures | Visual-only | Not graded. Capture trees exist in the commit as Git LFS pointers (`assets/renders/ui/P1-E04-T06-capture01`, 1129 paths; `P1-E04-T06-supplement01`, 175 paths). Pointers were not smudged. `docs/PROGRESS.md` on this pin records the older P1.E04.T02 grades, including mean 3.86. That row is not a grade of `f1766f0`. |

Display band, read from the same lines, not a missing sentence: `Math.ceil` makes every fraction in `(0.34, 0.35)` render `Hull 35%` while `critical` is already on. Exactly `0.35` renders `Hull 35%` and is not critical. The test locks the strict `< 0.35` boundary and does not assert the 0.349 string.

## Product files in the tree versus the merge-base

```
packages/client/src/entities/Cockpit.js
packages/client/src/entities/poolCaptures.test.js
packages/client/src/entities/poolDisplays.test.js
packages/client/src/remote/RemoteEntities.js
packages/client/src/remote/RemoteShips.js
packages/client/src/remote/RemoteShips.test.js
packages/client/src/remote/markers.js
packages/client/src/remote/markers.test.js
packages/client/src/remote/replay.js
packages/client/src/remote/replay.test.js
packages/client/src/ui/HUD.js
packages/client/src/ui/pilotMarkers.test.js
packages/client/src/ui/style.css
packages/tools/src/capture/screens.ts
packages/tools/src/smoke/remote-markers.spec.ts
```

Blobs at `f1766f0`: HUD `ca278071c42673e52fd128278d80b12997bfa424`, Cockpit `b4e041e98203f0f4d9dc0925008cc76650552796`, style `296c221594c06cacd6ea10ec1a6da301a7c2edce`, markers `2c59399419ab1c9dfc9d306f959c378907f763e7`, RemoteEntities `5b30a1ce9ca80e66284e9ef37f7dc861a049488d`, RemoteShips `fe30b6eb051736c5156ddd34d12e7bf0aa55609c`, replay `bd9b9a36650db7db3fdc816d59c07c44faea62ad`, screens `dbb5650e9192bb03eebfa502e42a0ac78a46b7cc`, poolDisplays test `4b9ae7b4cf1d82b835d4ac32ee4c58557d62c78b`.

## Next concrete step

Run the authored unit tests on a disposable checkout of `f1766f0` only: `markers.test.js`, `pilotMarkers.test.js`, `poolDisplays.test.js`, `poolCaptures.test.js`, `RemoteShips.test.js`, `replay.test.js`. Do not run smoke, capture, Blender, or a browser. Do not edit `HUD.js`, `Cockpit.js`, `style.css`, or `screens.ts`. Do not use `t3-7d211d96`. Leave the visual rubric of the existing remote-ships packets to a separate lane. Leave the NPC ship until `P1.E08.T05` leaves `[ ]`. Leave landing and Trunk alone: the reader HEAD still has the raw 35-point hull warning, and this report does not authorize a merge.
