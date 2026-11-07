# P1.E04.T06 capture packet inventory

Sealed 2026-11-07. Read-only. No pixels opened, no browser, capture, Blender, GPU, smudge, or LFS download. No worktree write. No PR, push, or merge.

This inventory is not a visual grade and not a visual PASS. A hash-bound copy of the existing capture01 and supplement01 bytes can be prepared from local objects. That copy is the packet already given a first T06 visual REVISE. It does not qualify commit `f1766f0`.

## Pins

| Item | Value |
|---|---|
| Candidate | `f1766f0db294bbd325cfa43e4b1494adc2dd0baf` detached at `/Users/andreyyurlov/.t3/worktrees/space/t3-af46806b` |
| Tree | `aa5bbb8a415a64e6641b3198f0c76c25cde3448b` |
| Worktree after this read | `HEAD (no branch)`, porcelain empty |
| Capture feature head | `e72ea15182ea02df5ebd7fba780cedad16c85d6b` |
| capture01 commit | `72a14839ce11309b996a607def40de1398d7ae04` |
| supplement01 commit | `c60c20876696953a056083aaf7e4de748e22e4e6` |
| Supplement recorded sourceHead | `72a14839ce11309b996a607def40de1398d7ae04` |
| Supplement capturedFeatureHead | `e72ea15182ea02df5ebd7fba780cedad16c85d6b` |
| Attempt | `390dfc95-3961-48a1-8eaf-4936e97210e8` |
| Grant sha256 | `22c4e959e4977958ccab4bf29f2c2cb9a8a8fddb3a391f8c371a76337d306c98` |
| Readiness sha256 | `13bedda4e520cc86ad0063c4d212fcc4cd2b627308bd5165614d1c64be6c1d2b` |
| Headless shell sha256 | `77d8278b1ac9d0687fad4e817ea83023ede09b1deef36e1864b49ba194ac9634` |
| Playwright core 1.64.1 | `829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d` |
| Playwright browsers.json | `2cfd419f71ac6475d81e1301fa86c34cf2a2a6bae2a0da4b5a2b18310216b6bf` |
| Node | `/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node` |
| Git | `/opt/homebrew/Cellar/git/2.56.0/bin/git` |
| Python | `3.14.8` at the Homebrew framework path in readiness.json |
| Workspace that captured | `/Users/andreyyurlov/.codex/worktrees/p1-e16-t09-count-rollover/space` |
| Preparation | `/private/tmp/P1-E04-T06-ui-final-036b0f1c` |
| ship.glb payload | `1dbeff57e5f7a28cc1f925b93a11dc45e40974617d4bad65689e45e517d77493`, 2200472 bytes, same blob `4ec8e609c54ed85a98d3a56d38c570535deea552` at both commits |
| Plan at the pin | blob `0346fc538a1424e4fb0895f8b4aa2b2242597140`, T06 still `[ ]` |
| Plan at reader `8026dc553` | blob `cc4fd05ffbc780f9bf059967e7c9985b3b23f553`, T06 `[R]` plus the hostile-sky bullet |
| Focused units | PASS 57/57, seal `/tmp/space-e04-t06-unit-f1766f0-20261107/SEAL.json`. CPU only. |
| Source map | `/private/tmp/space-e04-t06-source-review-f1766f0-20261107/REPORT.md` |

Readiness file hashes match `git cat-file` content at `e72ea151` for HUD.js, Cockpit.js, style.css, markers.js, RemoteEntities.js, RemoteShips.js, replay.js, and screens.ts. Those same blobs are unchanged at `f1766f0` except HUD.js.

| File | e72ea151 content sha256 | f1766f0 content sha256 |
|---|---|---|
| HUD.js | `3859b00c7b299bce3a7051874d41c5966a474136aeb5e7b1b172f6fc28a7f47a` (52560 bytes, blob `164ad6c8c`) | `0ebf8734139d6d7e0d56375ebc6addb0f8b1ff87e24c5c8b9b0d9490ec58929a` (52567 bytes, blob `ca278071c`) |
| Cockpit.js | `e5b0e757d4c1d430d1b9cae719e7221b549088207fc188d83f8521ec5b17942c` | same |
| style.css | `40cae0433978d67f8a49e9308f4abc3c267e2ae90d23dd5d44d8626971e64094` | same |
| markers.js | `a5cf6fe31ca6d13bb457f8826b4af65cdea67df08504df42da5e8a039c39a376` | same |
| RemoteEntities.js | `10ee48bde0e224c657b9d20a595d2be04fd80af9e3a92587ee0ddc9f29d3dd57` | same |
| RemoteShips.js | `79b8644e36d023ced495cce972d568e4b25889b86f023971f32e9f9d37931898` | same |
| replay.js | `9de6a193b514d6b0cc8299c111e18c063cde347a42b67400f4571db43ddd441a` | same |
| screens.ts | `4f4a19b2aa1968d411867ba51e1e99e207fa400d52c0744fdf43cacd5d5144a4` | same |

## Source delta

`git diff e72ea151 f1766f0` outside `assets/renders` is one line in `packages/client/src/ui/HUD.js`: `classList.remove('out')` becomes `classList.toggle('out', false)`. The render trees of both packets are identical from `c60c208` to `f1766f0` (`git diff --stat` empty). capture01 is also identical from `72a14839` to `f1766f0`.

Supplement checkout identity is `72a14839`, which adds capture01 and does not change those product blobs. Its feature pin remains `e72ea151`. The pixels therefore belong to `e72ea151`. The HUD line in `f1766f0` was committed after both packets. A metadata reading of these bytes does not qualify that line.

Packet-internal status is still pending: provenance `visualGrade` is `PENDING_INDEPENDENT_ARTIFACT_ONLY_REVIEW`; both `result.json` files say `CAPTURED_PENDING_VISUAL_REVIEW`. All seven capture stages and the supplement receipt record `captureSucceeded: true`.

## Required coverage

Plan 0.10.3 for UI: screenshots at 16:9 and 21:9, plus a short 60 fps frame clip. The pin's T06 block also requires the marker, pool, and sensors behavior, and smoke. The reader-HEAD plan adds the hostile-sky hull percentage and 35% warning as display-only. `P1.E08.T05` is still `[ ]` at the pin, so the NPC ship is not due.

| View | 16:9 still 1920×1080 | 21:9 still 2520×1080 | Motion |
|---|---|---|---|
| remote-ships | yes | yes | 150 jpg, 2.5 s, 16:9, labeled 60 fps |
| remote-ships-crowd | yes | yes | 120 jpg, 2.0 s, 16:9 |
| remote-ships-crowd-sensors | yes | yes | 120 jpg, 2.0 s, 16:9 |
| remote-ships-pads | yes | yes | 150 jpg, 2.5 s, 16:9 |
| remote-ships-surface | yes | yes | 150 jpg, 2.5 s, 16:9 |
| remote-ships-bay | yes | yes | 120 jpg, 2.0 s, 16:9 |
| remote-ships-pools | yes, plus full-125, half-125, cockpit-half-125, hazard-35-125, hazard-critical-125 | same five extras | 150 jpg, 2.5 s, 16:9 |
| supplement crowd transition | no 16:9 still | `visual/21x9.png` | 120 jpg under `visual/frames/`, 2.0 s, 2520×1080 |

capture01 also has seven `clip-sheet.png` files at 2400×1192. Supplement adds a CPU-derived contact sheet and `visual/crowd-transition-viewing-copy.mp4` (h264, 120 frames, `60/1`, 2.000 s, libx264, hardware acceleration none). The video provenance calls that file a viewing copy of the JPEGs. `runtimeFpsEstablished` in the supplement manifest is false. Clip receipts say screenshots were throttled to about 6 wall-clock frames/s.

Counts in capture01 `media-manifest.json`: 991 images, 322720869 bytes. Cross-check against local payload sha256: 991 match, 0 path miss, 0 hash miss. Supplement media manifest: 123 files, exact relative path, sha256, and size match, 0 miss.

## Prior grades

`P1.E04.T02` mean 3.86 is round 4 of Remote entities in the pin's `docs/VISUAL-REVIEW.md` (legibility 3, hud-fit 4, motion 4, palette 4, correctness 3, spec 4, performance 5). Round 5 of that task is mean 4.14 and is what filed T06. Those rows cite `assets/renders/ui/remote-ships*/`. They are not a grade of this packet or of `f1766f0`.

One T06 visual grade exists, and it is not in the candidate tree. Commit `725d153f47710b6440a133096cfbbeb27e7f26bc` (2026-11-02 19:20 -0500, not an ancestor of `f1766f0`) records the first independent grade of the supplement commit `c60c208`. Scores: hierarchy 4, fit 5, motion 3, theme 5, correctness 4, spec 4, performance 2. Mean 3.86. REVISE. Motion fails observed 60 fps. Performance fails whole-UI under 1 ms (`wholeUiCostMs` null, assessment `INCONCLUSIVE`). The grader inspected 25 stills, eight sheets, and 82 unique original frames and made no further capture request. `/tmp/p1-e04-t06-visual1-sol-final` is no longer on disk. `git log --all -S '## P1.E04.T06' -- docs/VISUAL-REVIEW.md` returns only `725d153`.

That grade applies to these exact artifact trees and to HUD content `3859b00c…`. It does not name `f1766f0` and does not cover HUD content `0ebf8734…`. Sending the same 1275 oids out as an ungraded blind packet would repeat that first round. The focused unit PASS does not change that.

## Object check

Local LFS store `/Users/andreyyurlov/Documents/dev/space/.git/lfs/objects`. Every pointer was sha256-checked against the object bytes. Pointer text alone was not treated as verification.

| Set | Files | Hash-verified payloads | Empty git blobs | Missing | Size mismatch | Hash mismatch | Payload bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| capture01 | 1129 | 1100 | 29 | 0 | 0 | 0 | 334148480 |
| supplement01 | 175 | 175 | 0 | 0 | 0 | 0 | 59663096 |
| Total | 1304 | 1275 | 29 | 0 | 0 | 0 | 393811576 |

Media verified: 1080 jpg, 33 png, 1 mp4. Metadata verified: 161 non-media payloads. The 29 empty blobs are `capture-execution.log` plus per-job `go`, `release`, `stdout.txt`, and `stderr.txt`. They have no payload. Five payload hashes are shared copies of the same bootstrap, helper, unload, or derived-attribution JSON. Those copies match each other.

Line inventory: `inventory.jsonl`, 1304 lines, sha256 `a94a7a6642b8812fba7e880c38ae7c1c163d7b0bb13789d9458c54c7061c2fc4`.

## Missing for a grade of f1766f0

- No capture whose feature head is `f1766f0`. The HUD classList line has no frame.
- Observed wall-clock 60 fps motion. The packets say the frames are deterministic 1/60 s steps captured at about 6 wall-clock fps.
- A whole-UI cost under 1 ms. Supplement trials report HUD-script medians 0.6–0.8 ms and leave `wholeUiCostMs` null.
- 21:9 motion for the six screens other than the one crowd-transition supplement. 0.10.3 asks for a clip; capture01 supplies 16:9 clips for all seven screens, and the supplement is the one extra 21:9 clip already consumed by the first grade.
- NPC ship in the sensors clip. `P1.E08.T05` is still `[ ]`.
- A 40% name-dim frame. The source path at both commits drops the name. There is no 0.4 opacity capture because that alternative is absent in source.
- Alarm audio and cadence. Pool stills include hazard-35-125 and hazard-critical-125 at both aspects. Rasters do not carry the alarm.
- The original viewing-record file. The verdict prose survives only in `725d153`.
- Smoke on this pin. The unit seal records smoke as not executed.

## Disposition

Prepare the hash-bound packet only as the identity of the already-graded `e72ea151` / `c60c208` evidence: 1275 local payloads, 393811576 bytes, manifests matched. Do not hand those same oids to a fresh grader as ungraded proof of `f1766f0`. Any later visual claim for the tip needs pixels captured from HUD content `0ebf8734139d6d7e0d56375ebc6addb0f8b1ff87e24c5c8b9b0d9490ec58929a`, and it still has to supply the motion and whole-UI evidence the first grade withheld.
