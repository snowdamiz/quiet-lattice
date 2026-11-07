# P1.E04.T06 focused unit verification

Verdict: **PASS**. Six authored files, 57 tests, 0 failed, 2364 chai assertion calls. Exit 0.

This is a CPU unit result on detached `f1766f0`. It is not a smoke pass, a visual grade, or a merge authorization.

## Pin

| Item | Value |
|---|---|
| Checkout | `/Users/andreyyurlov/.t3/worktrees/space/t3-af46806b` |
| HEAD | `f1766f0db294bbd325cfa43e4b1494adc2dd0baf` (detached) |
| Tree | `aa5bbb8a415a64e6641b3198f0c76c25cde3448b` |
| Branch ref left in place | `refs/heads/t3/af46806b` = `a7304884b2c7e81a052dc472d1c020051c0fdbdd` |
| Worktree porcelain after the run | 0 |
| Lockfile blob | `fa850c2e93a386a217a116f9c1d7f5d2bafffcd6` (unchanged) |
| HUD.js | `ca278071c42673e52fd128278d80b12997bfa424` |
| Cockpit.js | `b4e041e98203f0f4d9dc0925008cc76650552796` |
| style.css | `296c221594c06cacd6ea10ec1a6da301a7c2edce` |
| screens.ts | `dbb5650e9192bb03eebfa502e42a0ac78a46b7cc` |
| Lark hold | `/Users/andreyyurlov/.t3/worktrees/space/t3-7d211d96` still `6445c7ec0` on `t3/7d211d96` |

Checkout command (exit 0):

```
GIT_LFS_SKIP_SMUDGE=1 git -c filter.lfs.smudge= -c filter.lfs.process= -c filter.lfs.required=false checkout --detach f1766f0db294bbd325cfa43e4b1494adc2dd0baf
```

Dependencies (exit 0): `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --offline --frozen-lockfile`. Store `/Users/andreyyurlov/Library/pnpm/store/v11`. Reused 239, downloaded 0. pnpm 12.15.0, node v26.12.1. `node_modules` is gitignored.

LFS: `P1-E04-T06-capture01` is 1100 pointers plus 29 zero-byte non-pointers. `P1-E04-T06-supplement01` is 175 pointers. No `git lfs pull`.

## Runner

`package.json` script `test` is `vitest run` (vitest 5.0.5). Root `vitest.config.ts` sets `test.projects` to `packages/*`. Client `packages/client/vitest.config.ts` is node, timeout 60s, include `src/**/*.test.{js,ts}`.

`pnpm test -- <flags>` is forwarded as `vitest run -- <flags>`. Vitest treats that `--` as end of options, so the flags are ignored and every project runs. That happened twice before the focused command. Do not repeat it.

Focused command (exit 0), 2026-11-07T19:51:12Z to 19:51:14Z:

```
pnpm exec vitest run \
  --config /tmp/space-e04-t06-unit-f1766f0-20261107/vitest.config.mjs \
  --root /Users/andreyyurlov/.t3/worktrees/space/t3-af46806b/packages/client \
  --maxWorkers 1 \
  --no-file-parallelism \
  --pool forks \
  --reporter=verbose \
  --reporter=json \
  --outputFile.json=/tmp/space-e04-t06-unit-f1766f0-20261107/vitest.json \
  src/remote/markers.test.js \
  src/ui/pilotMarkers.test.js \
  src/entities/poolDisplays.test.js \
  src/entities/poolCaptures.test.js \
  src/remote/RemoteShips.test.js \
  src/remote/replay.test.js
```

The outside config copies the client environment and timeout, sets `include` to these six files, and adds `/tmp/space-e04-t06-unit-f1766f0-20261107/count-asserts.mjs`. `vitest list` on that config printed only these six files before the run. File start/end times do not overlap.

## Counts

Vitest JSON: `success=true`, 6 files passed, 17 suites passed, 57 passed, 0 failed, 0 pending, 0 todo. Duration 1.43s.

Chai `Assertion#assert` calls, counted in the worker. Two small tests match their `expect` calls exactly (1 and 3), so the counter is one call per matcher, including calls inside loops.

| File | Tests | Assert calls |
|---|---:|---:|
| markers.test.js | 16 | 470 |
| pilotMarkers.test.js | 6 | 62 |
| poolDisplays.test.js | 4 | 46 |
| poolCaptures.test.js | 4 | 648 |
| RemoteShips.test.js | 23 | 334 |
| replay.test.js | 4 | 804 |
| Total | 57 | 2364 |

Per-test names are in `SEAL.json` and `asserts.jsonl`.

## Fixture semantics

`markers.test.js` builds a 1920×1080, 60° camera and a 12×4×14 m box. It checks `pilotInk(10000)` against halo `11,12,14` at ≥ 4.5:1, fade exactly 0 at 150 ms and reversible from the current opacity, screen projection, mark gap, nudge/slide, label side and room margin, social keep-outs from a stub and from `SocialUI.covers()`, and hull-corner outlines. No pixels.

`pilotMarkers.test.js` stubs `document.createElement` and calls `HUD.updatePilots` at 1920×1080. Twelve pilots: nearest eight named, plus the on-screen mark closest to center, deduped when that pilot is already in the eight. Ink is `rgb(233, 231, 226)` at 499 m, `rgb(200, 198, 194)` at 750 m, `rgb(166, 165, 162)` at 4000 m. A blocked label reaches opacity 0 at 150 ms on the HUD clock while its box tracks the diamond and `style.translate` stays empty. Occlusion drops `named` only; range text and the mark stay. The `out` class is absent. The tests do not spy on `classList.toggle` versus `remove`.

`poolDisplays.test.js` builds HUD and Cockpit prototypes with stub DOM and canvas, then draws a real `Ship`. For both `[]` and `['shield_capacitor', 'hull_plating']` it expects full, 0.997, and low fractions on the shield arc, hull width, and cockpit shield bar (125 vs 100 come from `Ship.setSkills`). Hostile sky: `Hull 82%` at `0.81201` and not critical; `Hull 35%` at exactly `0.35` with shield 0, not critical, no alarm; critical at `0.349` while shield is 1; one alarm when shield hits 0; no second alarm at `game.time` 11.6; a second alarm at 11.6001; no `Hull` text and no critical class when `hazardLevel` is 0. It does not assert the text at `0.349`.

`poolCaptures.test.js` does not open a browser or write an image. `page.evaluate` runs the function and `page.waitForTimeout` is a no-op, so `settle`'s 1200 ms wait does not sleep. It calls `SCREENS['remote-ships-pools']` stills and motion. Stills at 16:9 and 21:9 set skills to capacitor + plating (`shieldMax`/`hullMax` 125) and expect shield/hull pairs full 125/125, half 62.5/62.5, cockpit half, hazard 0/43.75, critical 0/43.625, unchanged across a zero-duration frame. Five stills × 120 `window.step` frames = 600 steps. Motion holds shield and hull at 100 (80% of 125) through parked and unparked clip frames.

`RemoteShips.test.js` uses synthetic Three.js meshes, not GLB files. It covers modelled hulls (Lark only; mule/swift/tug null), LOD thresholds 240 px and 60 px with 15% hysteresis, vertex materials, plating, strobes, distance dimming past 150 m, and occlusion: camera near/far interval, target range, pitch 0 and −π/2, back faces clear on fine LODs, double-sided coarsest occludes, nearer hull only. Gear, lights, and a 40-ship capacity of 64 are in-memory.

`replay.test.js` uses a seeded station hierarchy and real `decodeSnapshot` / `RemoteEntities`. `encodeStream` expects a full snapshot then position deltas, removal of id 2 at tick 20, and arrival delay in `[0.06, 0.10)`. `SnapshotReplay` plays an 80-tick circle and expects interpolation error under 0.05 m. `flypastTicks` expects 81 ticks of three player Larks in frame `7:station`, nose along velocity, in front of the local ship. `crowdSensorsTicks` expects 24 players per tick; after 101.2 s, id 223 is undetected past 4000 m and id 224 is boosting, detected, reach 8000 m, distance in `(7600, 8000)`, for more than 200 readings. No NPC is in the stream.

## Out of scope, on purpose

Smoke, browser, Blender, GPU, image capture, and the visual rubric were not run. No push, PR, or Trunk comment. `screens.ts` was imported by `poolCaptures.test.js` and not edited.

## Deviation

Before the focused command, two `pnpm test` invocations ran the whole workspace because of the `--` forwarding above. Both exited 0: 213 files, 2714 tests. The first is `vitest.stdout` (15.42s, 213 workers). The second was `pnpm run test -- --version` (13.02s, 213 workers). They did not change the tree. The focused run is the one that executed only the six files, serially.
