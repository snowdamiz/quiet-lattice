# P1.E08.T09 pointer retention review

Verdict: EVIDENCE RETENTION PASS
Scope: committed Git LFS pointer identity against the already graded `0922f7f` packet and the retained blind-visual seal. Source/pointer check only.
Generated: 20261107T194054Z
Reviewer lane: independent nonvisual. No children. No checkout writes. No image open, payload rehash, capture, Blender, export, native, browser, or suite.

## Pins

| Item | Value |
|---|---|
| Checkout | `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465` |
| Branch | `task/P1-E08-T09-current-base` |
| HEAD | `d0a914c94754a6ba0c3b1f364e2254c2815b5f54` |
| Tree | `86fd5f5e1360babc68d9448a8f52039badd54240` |
| Parent | `0922f7fc3df310cbdd624d8fa5846b73a9cfe533` |
| Parent tree | `baa2cd37e8e767e73612161bca28fc425d87cde1` |
| Subject | `P1.E08.T09: retain offline six-unit capture evidence from 0922f7f` |
| Author time | `2026-11-07 07:44:27 -0500` |
| Porcelain | empty at review end |
| Ancestor of parent `a7304884b2c7e81a052dc472d1c020051c0fdbdd` | no |

Parent docs used for the seal were re-read at `a7304884b2c7e81a052dc472d1c020051c0fdbdd` (`Retain Mule bake timeout and Lark performance diagnosis`, `2026-11-07 14:37:50 -0500`). During the read the parent branch moved from `8026dc55308fc850da4730870fe5ccd59ef483e5` through `78f61c16a` to that tip. The fauna checkout stayed at `d0a914c`. The seal blobs below are identical to the introducing commit `bfef93d32e75421dbad9551a78f1d9bf202f14b9`.

## Diff

`git diff --raw HEAD^ HEAD` is 769 additions, mode `100644`, status `A`.

- 768 paths under `assets/renders/ui/fauna-packet-*`. Each git blob is a three-line Git LFS pointer (`version https://git-lfs.github.com/spec/v1`, `oid sha256:…`, `size …`). `filter: lfs` on the sampled paths. Zero malformed pointers.
- 1 record: `docs/review-records/p1-e08-t09/offline-six-unit-capture-0922f7f-retention.json`.
- `packages/client/src/gameplay/Fauna.js`, `packages/client/src/ui/HUD.js`, and `packages/tools/src/capture/screens.ts` are the same blobs as the capture parent. No `packages/` or `src/` path is in the diff.

## Comparison

Graded packet catalog: parent `docs/review-records/p1-e08-t09/capture-sixunits-0922f7f/visual-packet/artifacts.json.gz`, decompressed sha256 `e70b3c02bb16982f405cbf4f62f54e7c46e93b21a7125266ba5d74dd2fe99a1a`, 332093 bytes. That matches packet `SEAL.json` and the retention JSON `artifactIndex`. Packet `SEAL.json` sha256 `fda375b96c63b402639386fc83dc684e57ed44c5ea6adeff8d3ee8068cef5922`, 876 bytes, matches `VERDICT.md` and the retention JSON `packetSeal`. `sourceHead` / `sourceTree` are the capture parent above. Counts: still 60, sheet 6, frame 696, readout 6. Total 768 files / 418439146 bytes.

Committed pointer oid and size versus that catalog:

- missing in the commit: 0
- extra in the commit: 0
- oid mismatches: 0
- size mismatches: 0
- pointer byte sum: 418439146

Retention `artifactManifest` (6 units, 768 entries, 0 duplicate paths) matches the same oid and size on every path. Units: hit-turn day/night at 16x9 and 21x9, 82 files each; combat and combat-night, 220 files each. Each recorded `parentObservedExit.exitCode` is 0. Retention status is `RETAINED_OFFLINE_CAPTURE_EVIDENCE_ONLY`.

Blind seal `docs/review-records/p1-e08-t09/blind-visual-0922f7f/` at parent HEAD:

| File | Git blob | Content sha256 | Bytes | Matches its seal entry |
|---|---|---|---|---|
| `SEAL.json` | `6d681be37c312daf4f734f52b488d0a36925a085` | `208b105d0a44f10341d4299917196be4da31422d973a45da440dcd967cceeac4` | 506 | `MANIFEST.json` `sealSha256` |
| `VERDICT.md` | `8804fdd78c62c771d1de8ac23c1a4597c2c03c7d` | `60b092d2398ed29c5498f527894e589f2579fd6245df047dde947928319e6f58` | 5839 | yes |
| `scores.json` | `b378781e877efad5c7a19daa34dc8b22bab68946` | `9c3e3aa6055b88e21e9fb9ce97d82e62da588faf74e36df50f058d1463744a02` | 529 | yes |
| `inventory.json` | `81dc85d211460e85bbf67246f6681a91afb5a3c3` | `2aa05d9c4a7c9830c41219200c7d4678b942fd53b9ff3cc117c56c7a50d31838` | 31244 | yes |
| `verification.json` | `d63a2ce7ffb628efe73042138b84048a1d919612` | `8c88849785db2955f575e97068eb041d9263950cf001ecb9a174902998cb62c8` | 260 | yes |

`VERDICT.md` line 8 is `VERDICT: PASS` (generated `2026-11-07T12:52:28Z`, mean 4.71). `verification.json` is `ok: 768`, `errors: []`, same source pin. `inventory.json` lists the 72 still, sheet, and readout files; each sha256, byte size, kind, and path matches `artifacts.json` and therefore the pointers. The 696 frame hashes live in `artifacts.json` only. All 696 frame pointers match those records.

Side checks that also match: `docs/art-bible.md` at the capture parent and at parent `a7304884` is sha256 `8349af52a0318b508a789725c3d9418b0bcfcd26c610a4ea4f4553f230be25f6`, 27744 bytes (packet seal entry). `readiness.json` at the capture parent and at `d0a914c` is the same blob `a6c099e3b1b371cad053ea0a0deffce46236e40f`, sha256 `46b1b713e8026c6daa8ed321ae78752bcf7fd11230c93eae0a1f4026c9ba951f`, 183091 bytes. Parent `capture-sixunits-0922f7f/six-unit-summary.json` is sha256 `5624d462f90941ed284a99164e27ccf770d33ab027a9d529ff0cedf612f5880e`, 7420 bytes, matching the retention `parentSummary` claim. The scratch paths named in that JSON (`/private/tmp/fauna-visual-packet-current-xmd3v6d9`, `/private/tmp/p1-e08-t09-six-unit-retention-6hh3b4xx`, `/private/tmp/space-fauna-parent-unit1-r4-uiweok3o/six-unit-summary.json`) are absent. The comparison used the committed objects.

## Qualifications

This PASS is committed pointer oid/size identity. It does not regrade pixels and does not qualify observed realtime 60 fps, live-server behavior, or whole-task acceptance.

The worktree files are LFS-smudged: 66 PNG, 696 JPEG, 6 `readout.txt`. The pointer text is the git blob. This lane did not recompute sha256 over those smudged bytes. An empty `git status --porcelain` means the index stat cache matched; it is not a fresh payload rehash.

The retention JSON limits still disclaim a visual grade. That commit is `2026-11-07 07:44:27 -0500`, before the seal (`VERDICT.md` `2026-11-07T12:52:28Z`, seal commit `2026-11-07 07:54:34 -0500`). The visual PASS stays the retained seal. This lane did not edit the retention JSON.

`docs/PROGRESS.md` line 1001 at `a7304884` still says the blind visual grade remains in flight. `docs/IMPLEMENTATION_PLAN.md` line 279 still says visual and whole-task acceptance remain pending. The seal already records visual PASS for packet `0922f7f`. Whole-task acceptance stays open on the plan verify line (two headless clients see the same herd; `pnpm gate:removed`). Neither sentence was edited here. No review file under `docs/review-records/` on the fauna commit names `d0a914c`.

## Out of lane

Lark, Mule, and the other audit holds were not entered. No paused work was resumed. No push, PR, merge, or Trunk comment.

## Next concrete step

Leave `t3-06487465` at `d0a914c` and do not regrade or recapture this packet. The parent may cite this PASS and the existing seal `docs/review-records/p1-e08-t09/blind-visual-0922f7f/` when it updates the stale progress and plan sentences. Whole-task closure remains the plan verify line and is a separate gate.
