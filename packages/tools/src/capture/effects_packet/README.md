# P1.E07.T14 disabled effects capture pilot

This is a source-only candidate for parent review. `caller.py`, `entry.mjs`, and
`readiness.json` are disabled. The actual CLIs exit 78 before reading readiness,
importing native helpers/capture code, allocating output, or launching a job.
There is no real grant. The existing source review at asset commit
`2643aca9d8b85a45498d85eb637d20260ebf06d1` remains separate from this caller review
and from native or visual acceptance.

The only proposed call is the existing exported
`captureReview('effects/gravitic', { asset: 'gravitic_pull', outDir })`.
The existing Review resolver finds the authored root. No common capture, Review,
Engine, screens, probe, trace, gameplay, exporter, library, source asset or texture
was changed. Four absent Station helpers were recovered byte for byte in their
own commit; `recovery.json` gives original commit, blob IDs, hashes and sizes.

## Source-only checks

Run from this checkout with its installed tools; no fetch or hydration:

```sh
python3 -B packages/tools/src/capture/effects_packet/controls.py
python3 -B packages/tools/src/capture/effects_packet/boundary_controls.py
python3 -B packages/tools/src/capture/effects_packet/revision_controls.py
node packages/tools/src/capture/effects_packet/controls.mjs
node node_modules/eslint/bin/eslint.js packages/tools/src/capture/effects_packet/*.mjs
node node_modules/prettier/bin/prettier.cjs --check packages/tools/src/capture/effects_packet/*.mjs packages/tools/src/capture/effects_packet/*.json
python3 -B packages/tools/src/capture/effects_packet/check_ready.py
```

`freeze.py` records current local dependency bytes and observes only its own
Python process's kernel executable. It never starts a capture. The published
Python launcher differs from macOS's Python.app process executable; both and the
Python framework are bound. Node, tsx, the esbuild binary resolved through tsx,
Playwright, the installed Chromium tree, decoder extension/stdlib, all client
public assets, source files and the retained review are bound. Node and Python
independently compute the same dependency tree hashes. Generated `.vite` and
`.vite-temp` directories have separate snapshot/growth accounting. macOS system
libraries in the OS dyld cache are platform dependencies, not claimed standalone
file byte pins. External system XPC ownership remains unqualified.

The frozen predecessor is informative. A later grant must bind the actual clean
source HEAD and tree after any enabling changes, and the exact new readiness
hash. `git status --porcelain --untracked-files=all` must be empty before consume
and again immediately before launch. A completed first pilot's real Git output
is dirty source for any hypothetical second grant: there is no successor
exemption, reuse, batch driver or implicit authorization.

## Call and receipt contract

The future parent grant must contain purpose
`EFFECTS_GRAVITIC_PULL_SINGLE_DISABLED_PILOT`, `oneUse: true`, the exact `pilot`
object, `authorizationId`, `readinessSha256`, `assetHead`, `source` (head, tree,
clean), timezone-aware `expiresAt`, `nativeReservesAccepted: true`, and a
`callerReview` path/hash. That independent review receipt must say `verdict: PASS`,
`scope: INDEPENDENT_EFFECTS_PILOT_CALLER_REVIEW`, and bind the same source object.
The authorization ID is also supplied in `EFFECTS_AUTHORIZATION`. These are
requirements, not a grant template file or authorization issued here.

Every admitted JSON file is type/size checked through an `O_NOFOLLOW` descriptor
before reading at most cap+1 bytes. Hash, parse, success fields and later manifest
checks use that same snapshot. Python also rejects duplicate keys and nonfinite
JSON constants. Readiness, grants, review, consumption, entry and parent terminal
receipts are capped at 2 MiB; perf is capped at 16 KiB. Tests perform real scratch
file replacement between read/hash/validation and instrument actual reads of
8 MiB metadata. Oversized files are rejected before reading any bytes.

Consumption uses exclusive creation before any native allocation. No failure
releases that identity. `StationJob` is registered in memory before its constructor
can fail. It alone launches and owns the Node capture, esbuild, Chromium children
and caffeinate. `StageReceipts` observes existing ordinary Chromium launch and
kernel ownership ports. Probe return values, unknown fields, partial exceptions,
primary and secondary errors are retained; wrappers restore the helper ports
without I/O when unwinding a deadline. Constructor/start failures without a proved
cohort retain their exact partials instead of guessing cleanup ownership.

The caller snapshots the complete available job instance before construction and
before/after cleanup, including fields outside `state` and unknown fields. Missing
ownership attributes are explicit. A `registered: false` attribute is never used
as proof that a bootstrap did not register. The actual `start()` subprocess and
ownership producers are observed before the helper's receipt I/O; exit, stdout,
stderr and unknown CompletedProcess fields survive receipt failure, SIGALRM and
combined publication failures. Observation ports are restored without I/O during
unwind. There is exactly one attempted start and no relaunch.

Before consumption (and thus the cache snapshot), and again immediately before
launch, a read-only owner guard queries the exact generated cache directories and
current-user Node/Vite cwd/argv routes for this task. Any open cache owner, related
Node/Vite process, malformed/partial observation or uncertainty refuses. The
guard uses capped `ps`/`lsof` output (256 KiB per command, 384 KiB per check), a
10-second deadline, at most 64 Node candidates, and a bounded 0.5-second reap for
its own read-only probe child on interruption. No competing process is signalled.
Executable names are enumerated before requesting only Node/Vite arguments;
unrelated programs' argument bodies are not queried. Disappearing Node candidates
need a fresh exact-PID absence observation. These are point-in-time observations,
not a host lock or OS quota. Refusal before consumption creates no output/evidence
root and preserves observations in memory even if bounded stderr also fails.
The cache copy compares identity, permissions, size, modification/change time and
content hashes. It records access time separately because the copy's own read
can update it without changing the cache content.

The shared cache reader acquires every ancestor with descriptor-relative
`O_NOFOLLOW|O_NONBLOCK` opens, retains directory identities, and admits regular
type, owner, identity and size before reading. Copy, source verification and
destination verification use that same reader. Each reads at most the admitted
size plus one growth byte, reconciles the descriptor afterward and checks that
every route component still names the opened identity. Enumeration is capped at
8,192 entries inside the existing 30-second phase. Failed copies remain charged
and retained; a content hash alone cannot admit a replacement link or inode.

The capture callback retains its original complete failure before the frozen
wait helper can normalize it or fail writing its receipt. Writer observations
are registered before filesystem probes; incomplete counts remain explicitly
partial. Later helper, receipt and cleanup failures stay secondary. A callback
deadline uses a distinct BaseException to unwind past the helper's own deadline
catch without its post-deadline receipt I/O; the original deadline is retained.

Capture has a 600-second outer phase. Nested wait receives remaining time; start
requires enough time for its existing 3-second bootstrap and 5-second handshake.
Cleanup has its own 60-second outer deadline, with 45 seconds for drain and the
remaining outer timer covering archive and release checks. A distinct outer
`PhaseExpired(BaseException)` cannot be swallowed by the helper's own
`DeadlineExpired` handler. Real SIGALRM controls cover capture and cleanup.

Only positive cohort live0, known-birth absence, job unregister, scratch/profile/
private-TMP release and owned assertion/listener absence permit the 45-second CPU
inspection phase. The PNG decoder runs inside the already existing caller process:
no ImageIO, Pillow, ffmpeg, Blender, browser or separate native codec process. It
validates every chunk CRC, the complete zlib stream, all scanlines and all five
PNG filters. The 12-file inventory, dimensions, exact entry hashes, actual perf
shape, manifest material `LIB_FX_Gravitic`, 576 triangles, one mesh, compressed
textures >0, `shown === 0` and `lods: [0]` are checked. LOD2 is a requested view
selecting authored LOD0; no LOD2 geometry is invented. Perf is retained, without
claiming T13 GPU attribution or a performance grade.
Palette validation permits one optional nonempty 1–256-entry PLTE for the
existing RGB/RGBA formats, only before the first IDAT, including empty IDATs.
Consecutive empty IDATs are valid; interrupted IDAT sequences are refused.

Terminal disk receipts always have `accepted: false`. A late write/close failure
cannot leave a durable accepted-true claim. All terminal writes must finish
before the in-memory caller returns success/OS exit 0. Failure publication tries
the evidence receipt, a packet fallback, then bounded stderr, while retaining all
errors in memory if every sink fails. Parent acceptance requires its independently
observed OS exit 0 and exact result/consumption receipt hashes, and revalidates
both snapshots. A file or cached success flag alone never accepts a pilot.

## Exact inventory

All paths are relative to the one fresh output root in readiness, in actual
`captureReview` write order:

1. `gravitic_pull/noon-lush_lod0.png`
2. `gravitic_pull/noon-lush_lod2.png`
3. `gravitic_pull/wireframe_lod0.png`
4. `gravitic_pull/wireframe_lod2.png`
5. `gravitic_pull/overlay.png`
6. `gravitic_pull/far_lod2.png`
7. `gravitic_pull/night-exotic_lod0.png`
8. `gravitic_pull/night-exotic_lod2.png`
9. `gravitic_pull/open-space_lod0.png`
10. `gravitic_pull/open-space_lod2.png`
11. `gravitic_pull/perf.json`
12. `gravitic_pull/sheet.png`

Individual views are 1920×1080. The standard labelled two-column sheet is
1920×2876 (ten cells, 540px image height +28px label, 36px heading).
Evidence includes `admission.json`, `prelaunch-source.json`, `tmp-admission.json`,
`entry-consumed.json`, `entry.json`, `inspection.json`, `terminal.json`, and
`result.json`; the unchanged helper owns `job/` receipts, archived logs/profiles,
and `preserved_private_tmp`. `cache-before/` is the finite cache snapshot.
`failed-entry.json` and `failed-result.json` in the output root are failure-only
fallbacks and invalidate normal output inventory. Failed partials are retained.

## Budget ledger

| Writer/reserve | Bytes | Actual semantics |
|---|---:|---|
| Capture outputs | 184,565,760 | 11×16 MiB PNG +16 KiB perf; attempted writes reserved before writing |
| Future LFS copy | 184,565,760 | Reserve only; no Git add/LFS adoption in this pilot |
| Future parent hydration | 184,565,760 | Reserve only; no second worktree image copy |
| Controlled metadata | 67,108,864 | Python 32 MiB +Node 32 MiB, including failed attempted writes |
| Cache snapshot | 67,108,864 | One copy; cap checked before/while copying; 30 seconds; partials retained |
| Profile work +archive | 2,147,483,648 | 1 GiB observed source threshold; helper copytree precedes source removal |
| Private TMP work +archive | 1,073,741,824 | 512 MiB observed nonprofile source threshold; verified copy precedes removal |
| Helper logs work +archive | 134,217,728 | 64 MiB observed source threshold; constructor and failed jobs included |
| Cache growth | 268,435,456 | Observed Vite cache growth allowance |
| Filesystem metadata | 16,777,216 | Directory/link/socket and filesystem overhead reserve |
| Safety | 1,073,741,824 | Free-space reserve at admission and while observing |
| **Admission total** | **5,402,312,704** | **One pilot only** |

There is no image staging or image archive copy. The standard capture writes
each final file once. Native profile/TMP/log/cache thresholds are observations,
may overshoot between samples, and are not OS quotas. Live Chromium singleton
links are counted as links and never followed. After release, the existing helper
refuses unsupported leftover TMP entries instead of deleting them speculatively.

## Remaining gates and inventory

R2-2 remains open: the current shared `capture.ts` cleanup can replace a page
failure and skip a later cleanup. P1.E14.T15 owns the common lifecycle correction
in a separate worktree. This checkpoint adds no task-local browser/Vite method
interception. Adopt the parent's reviewed T15 commit, verify the original
consumer reproduction through the default loader (including standard cause/errors),
and refresh bindings before claiming this finding closed. A disabled binding
audit is not acceptance of the still-pending shared lifecycle.

Parent review and a fresh exact one-use grant are still required; fauna remains
first in the GPU queue. No native launch or visual acceptance occurred here.
All 59 authored roots still await their applicable native/static visual review;
this pilot proposes only one root, not the remaining 58. The 32 proposed motion
records still require gameplay/Recall playback supplied by their owning tasks.
No new motion, alpha-overlap, 21:9, atlas stepping or batch generator is included.
The prior CPU previews under `assets/blend/effects/evidence/previews/` remain
unchanged iteration evidence, not independent visual grades. No new captures or
development-shot PNGs are retained by these controls.
