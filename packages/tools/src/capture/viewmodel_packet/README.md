# P1.E05.T03 guarded capture preparation

This source candidate enables the caller, entry, inventory and readiness gates. It remains **awaiting independent R4 and a separate parent-issued grant for each unit**. No real grant, consumption, output or native evidence exists. Enabling source is not native acceptance or authority to dispatch. Only the parent may issue the first unit grant after R4 PASS, current capacity and the GPU schedule. There is no retry or automatic multi-unit dispatch.

The exact active paths have the fresh `viewmodel-packet-r4-bpmhg9qg` identity. Historical v1 paths and proof records remain untouched. Missing or unauthenticated grant/consumption metadata refuses before helper import, allocation or launch. `--check` reports `ENABLED_AWAITING_PARENT_GRANT`; it cannot qualify a native run.

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

`readiness.json` is an enabled, awaiting-grant source snapshot of this checkout's executable/runtime/assets/helper/dependency bytes and logical routes. It pins Node, tsx, esbuild, browser, Python launcher and self-observed kernel executable separately, decoder/Pillow and generated-cache locations. The four helpers were recovered in their original paths, byte-identical to `ca7d91e378e9d2f3f0ce8f0651475dcb843875d9`, in separate commit `c0191922b8e682660bf25b5de785143b9ab72c2e`. None of the historical capture packet was imported. The helper modules are imported only after admission and atomic consumption. The ordinary Chromium launch remains within StationJob/StageReceipts; no BrowserServer or replacement renderer is added.

`caller.py --prepare` performs local read-only binding/owner/absence probes and writes JSON to stdout. It starts no helper or native job. `caller.py --check readiness.json` rechecks those bindings and prospective paths. The committed readiness is the refreshed source candidate. Writing a real grant remains a parent operation after R4; the earlier disabled snapshots remain in Git and immutable evidence.

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

Metadata descriptors use `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`, then validate actual regular type, device/inode and size before bounded reads. Actual FIFO replacements between lstat/open are covered for grant, result and consumption, including closure. Cap+1 reads, same-buffer hashes/parsing, original/secondary errors, unknown byte observations, partial allocations and all-sinks in-memory evidence are covered. Failure never silently retries or unspends a grant. A failed/unproven native release forbids decoder dispatch. Independent R4 source review remains required before the parent issues a grant.

## Files and evidence

- `caller.py`, `boundary.py`, `bindings.py`, `native.py`: one-unit admission, snapshots, source/runtime bindings and recovered-helper adapter.
- `entry.mjs`, `fixture.mjs`, `resolve.mjs`: guarded native entry, actual application fixture and launch-free dependency resolver.
- `inspect_packet.py`: independent CPU PNG/readout inspector. Named to avoid shadowing Python's standard `inspect` module.
- `test_boundary.py`, `test_native.py`, `test_inspect.py`, `entry.test.mjs`, `fixture.test.mjs`: inert actual-boundary controls; at most two workers.
- `verify.py`, `audit.py`, `evidence/`: commands, exits, retained failures and protected-byte audit. No captures or previews were produced in this unit.

Cross-lane reports used as source evidence: R3 `/private/tmp/p1-e08-t09-r3-independent-l9fn2t5y/REPORT.md`, R4 `/private/tmp/p1-e08-t09-r4-independent-pshs9o5k/REPORT.md`, R5 `/private/tmp/p1-e08-t09-r5-independent-xDKoJp/REPORT.md`. Their hashes and the T03 R1–R3 hashes are retained in `evidence/protected-hashes.json`. Existing source/CPU R3 PASS remains historical; native capture, live resource ownership, blind visual grading, T04 clips, full GPU smoke and whole T03 completion remain pending.

## Receipt schema and encoder prerequisite

Consumption metadata uses `schema: "viewmodel-consumption/1"`; result metadata uses `schema: "viewmodel-result/1"`. Result protocol fields remain at the root: identity/pins, `accepted:false`, `checksPassed`, `status`, `released`, `output`, `outputManifest`, and the three failure fields. The producer and authenticated successor consumer require these explicit schemas. Entry admission requires the consumption schema too. Protocol fields have ordinary JSON value semantics and cannot become graph envelopes.

All other fields, including unknown future fields, are retained together under `observations`, with `observationEncoding: "raw-graph-or-tree/1"`. Shared/cyclic observation values retain the bounded graph representation, types and stable reference identities. They are never used as substitutes for protocol success/identity/manifest fields. Primary and secondary failure facts stay explicit at the protocol root. A successful provisional receipt still requires the parent's observed OS exit 0 before successor admission.

R3 independently established a conditional refusal for a VM-owned cohort containing Apple `VTEncoderXPCService`. This candidate binds exactly `/System/Library/Frameworks/VideoToolbox.framework/Versions/A/XPCServices/VTEncoderXPCService.xpc/Contents/MacOS/VTEncoderXPCService`, SHA256 `a3af9d8f1d6423de4d6303c323f5132122181e01367155d325fc9bde3ed872b5`, 167,280 bytes. The entire route must be root-owned and non-writable by group/others. Readiness includes the actual strict Apple codesign verification, designated requirement, platform identity, protected route and codesign executable. The unchanged observer still requires current cohort membership, UID, birth identity, coalition and executable identity. Inert actual-observer controls reject missing/wrong binary bindings and wrong ownership. This is source/CPU proof; VM creation or external ownership of an XPC service remains unqualified.

The effects pilot diagnosis at `/private/tmp/p1-e07-t14-native-failure-3pevk0mk/APPENDIX-C2.md` and reviewed source `6b4073305af21efe5c6cf5ecc09f78406b637a42` informed this narrow prerequisite. Its native failure and metadata-budget diagnosis are historical effects evidence, not a reproduced VM failure. No segmented effects evidence system was imported; VM receipt budgets remain unchanged. No encoder, browser or native job was launched.
