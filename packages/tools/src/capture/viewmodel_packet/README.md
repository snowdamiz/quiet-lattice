# P1.E05.T03 disabled capture preparation

This packet is **source/CPU preparation only**. Both `caller.RUNTIME_ENABLED` and `entry.ENTRY_ENABLED` are false; both inventory flags and the frozen readiness flags are false. No native unit, GPU ownership, visual result, server grant or whole-task acceptance is supplied. Fauna retains the first GPU slot. The parent must review this source, assign a slot, enable/recommit the exact caller and entry gates, regenerate bindings, and separately authorize each unit. There is no retry or multi-unit dispatch command.

## Inventory and admission

| Unit | Files | PNGs | Readout cap | Output cap B | Admission B |
|---|---:|---:|---:|---:|---:|
| review-thalune | 12 | 11 | 16,384 | 184,565,760 | 5,402,312,704 |
| review-ixari | 12 | 11 | 16,384 | 184,565,760 | 5,402,312,704 |
| review-ulgani | 12 | 11 | 16,384 | 184,565,760 | 5,402,312,704 |
| view-thalune | 19 | 18 | 32,768 | 302,022,656 | 5,754,683,392 |
| view-ixari | 21 | 20 | 32,768 | 335,577,088 | 5,855,346,688 |
| view-ulgani | 21 | 20 | 32,768 | 335,577,088 | 5,855,346,688 |
| return-thalune | 4 | 3 | 16,384 | 50,348,032 | 4,999,659,520 |

Total: **101 files: 94 PNGs and 7 readouts**. `inventory.json` lists every basename, in capture order. Every PNG is capped at 16 MiB. The three full first-person readouts retain full-precision material facts for every frame, both fire projections and incoming-people facts. A 19-frame serialization already measures 17,777 bytes before projections/packet metadata, so these readouts have a justified 32 KiB cap. No PNG count changes. The original 16 KiB Thalune arithmetic would be 5,754,634,240 B, not the proposed 5,754,433,536 B; the implemented additional 16 KiB readout allowance adds another 49,152 B across three copies.

Admission is `3 * outputCap + 4,848,615,424` bytes. The three physical copies are the original output, immutable decoder copy, and verified copy. All originals/failed partials remain. The fixed reserves are metadata 64 MiB, cache snapshot 64 MiB, profile working+archive 2 GiB, private TMP working+archive 1 GiB, helper logs working+archive 128 MiB, cache growth 256 MiB, filesystem 16 MiB and safety 1 GiB. Profile/TMP/helper working ceilings are half their paired allowance. Metadata attempt budgets are helper writes 16 MiB, Node receipts 8 MiB and caller receipts under 40 MiB (64 KiB withheld for admission/manifest records); individual caller result snapshots are capped at 20 MiB. Failed/repeated write attempts count. Raw helper observations are retained before assertions; ordinary cleanup receipt failures remain errors while mandatory owned draining proceeds. Interruptions always unwind.

These are **observed native reserve ceilings, not OS quotas**. Native processes can grow between observations; this preparation does not certify their real footprint. Capture is bounded at 600 s, cleanup at 60 s, post-release copying/CPU decode at 45 s, and cache snapshot at 64 MiB/30 s. There are no movies, raw frame directories, new clips, image bake/render jobs, second browser stack or generalized operations framework.

## Actual consumers and fixture

Standard units call the existing exported `captureReview` with the three `characters/viewmodels/fp_*` assets and `outDir`. Their images are 1920×1080, with the existing 1920×2876 sheet. Authored shaded materials remain intact, including during wireframe inspection through the review's original-material map. Requested LOD2 is recorded separately from actual selected LOD0 in raw capture facts and image captions. Native stats/far facts must corroborate one LOD and the viewmodel class's 100 m far capture. Native overlay labels must corroborate Muzzle; Grip overlay is explicitly unsupported.

First-person units reuse `startVite`, `glArgs` and the existing Playwright Chromium launcher. `#foot` starts the real application's offline sandbox; the fixture refuses a live `game.net`. It settles the actual foot transition, stops the fixture's animation-frame driver, pins resolution, and advances original `Multitool.update` with explicit input. It does not substitute bones, clips, the meter, view transforms or runtime methods. The existing view pass is rendered at 1920×1080 and 2520×1080. Stills and raw facts come from the same synchronous render task. No server authority, gameplay unlock or codex manipulation is implied.

The 16:9 set is neutral, four settled sway extremes, raise 0/0.4 s, fire, overheat and underwater. The 21:9 set is neutral, one settled sway extreme, both raise endpoints, fire, overheat and underwater. Underwater must hide the view. Fire includes finite same-frame view/world/beam projections, both camera frusta and actual muzzle coordinates; x/y must align within 1e-5 NDC. Ixari and Ulgani add incoming gap/settled stills; the return unit contains only the Ulgani→Thalune gap/settled pair. Each transition first proves its incoming model is attached and visible in the real pass, then holds the actual target GLB request to expose the loader gap. A missing request, mode, model or required material fails instead of inventing a pose.

Before any PNG publication, live Skin and the selected people's Tool require all five complete 2048²/12-mip PBR slots. Bio is required for Thalune/Ixari, absent for Ulgani. Tool/Bio additionally require emission. CPU inspection independently validates all decoded PNG bytes, dimensions, exact inventories, material facts, state contradictions, LOD facts, incoming people and projections. CPU fixtures are synthetic test data, not visual evidence.

## Authority, binding and sequencing

`readiness.json` is a disabled snapshot of this checkout's executable/runtime/assets/helper/dependency bytes and logical routes. It pins Node, tsx, esbuild, browser, Python launcher and self-observed kernel executable separately, decoder/Pillow and generated-cache locations. The four helpers were recovered in their original paths, byte-identical to `ca7d91e378e9d2f3f0ce8f0651475dcb843875d9`, in separate commit `c0191922b8e682660bf25b5de785143b9ab72c2e`. None of the historical capture packet was imported. The helper modules are imported only after admission and atomic consumption. The ordinary Chromium launch remains within StationJob/StageReceipts; no BrowserServer or replacement renderer is added.

`caller.py --prepare` performs local read-only binding/owner/absence probes and writes JSON to stdout. It starts no helper or native job. `caller.py --check readiness.json` rechecks those bindings and prospective paths. Preparing a new runtime readiness and writing a real grant are parent operations after explicit authorization; do not overwrite this historical disabled snapshot.

The parent's external one-unit grant must contain:

```json
{
  "purpose": "P1-E05-T03-ONE-NATIVE-UNIT",
  "enabled": true,
  "authorizationId": "unique-parent-issued-identity",
  "unit": "review-thalune",
  "authorizedHead": "exact-current-clean-40-character-HEAD",
  "readySha256": "sha256-of-the-exact-enabled-readiness-bytes",
  "previous": []
}
```

This example is not a grant. Only the frozen paths are admitted. Future grant/output/evidence/consumption paths must be absent. Source HEAD is bound by the grant at execution, avoiding a self-referential committed readiness hash. Every unit uses the same unchanged HEAD. The final source binding/cleanliness check runs again before success.

For each predecessor, the next grant includes exactly `{unit, callerExit: 0, resultSha256, consumptionSha256}`. The parent must observe the actual caller process exit 0 before hashing those exact files. Disk results always say `accepted:false`, even on success, and remain `AWAITING_CALLER_COMPLETION`; they do not attest their own process exit. Admission authenticates and semantically validates each receipt from one capped snapshot, then reuses that object for its manifest. Original, decoder and verified outputs must match that authenticated manifest. Git accepts only those exact predecessor files; tracked/staged edits, unrelated untracked/ignored additions, extras and symlinks fail. Only the two explicitly owned, observed cache directories are excluded from the ignored-path baseline and separately bounded/pinned.

Metadata descriptors use `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`, then validate actual regular type, device/inode and size before bounded reads. Actual FIFO replacements between lstat/open are covered for grant, result and consumption, including closure. Cap+1 reads, same-buffer hashes/parsing, original/secondary errors, unknown byte observations, partial allocations and all-sinks in-memory evidence are covered. Failure never silently retries or unspends a grant. A failed/unproven native release forbids decoder dispatch. Fresh source review remains required before any enabling change.

## Files and evidence

- `caller.py`, `boundary.py`, `bindings.py`, `native.py`: one-unit admission, snapshots, source/runtime bindings and recovered-helper adapter.
- `entry.mjs`, `fixture.mjs`, `resolve.mjs`: disabled native entry, actual application fixture and launch-free dependency resolver.
- `inspect_packet.py`: independent CPU PNG/readout inspector. Named to avoid shadowing Python's standard `inspect` module.
- `test_boundary.py`, `test_native.py`, `test_inspect.py`, `entry.test.mjs`, `fixture.test.mjs`: inert actual-boundary controls; at most two workers.
- `verify.py`, `audit.py`, `evidence/`: commands, exits, retained failures and protected-byte audit. No captures or previews were produced in this unit.

Cross-lane reports used as source evidence: R3 `/private/tmp/p1-e08-t09-r3-independent-l9fn2t5y/REPORT.md`, R4 `/private/tmp/p1-e08-t09-r4-independent-pshs9o5k/REPORT.md`, R5 `/private/tmp/p1-e08-t09-r5-independent-xDKoJp/REPORT.md`. Their hashes and the T03 R1–R3 hashes are retained in `evidence/protected-hashes.json`. Existing source/CPU R3 PASS remains historical; native capture, live resource ownership, blind visual grading, T04 clips, full GPU smoke and whole T03 completion remain pending.
