# P1.E05.T03 guarded capture preparation

This enabled source candidate awaits independent review of the observation-budget correction and a fresh parent-issued one-unit grant. The original `review-thalune` unit at `84d7098432de296b1db916849804c912d1558cd3` is **FAILED/SPENT**: exit 1, zero images. Its grant, consumption, raw packet and parent release observations remain immutable. Parent-observed release is not capture success. There is no autonomous retry or multi-unit dispatch.

The fresh active paths use `viewmodel-packet-observations-7o2wl_r3`. No grant, consumption or output exists for these new identities. Missing or unauthenticated metadata refuses before helper import, allocation or launch. `--check` reports `ENABLED_AWAITING_PARENT_GRANT`; it does not qualify native work. The parent controls subsequent grant issuance, capacity and GPU scheduling.

## Inventory and admission

| Unit           | Files | PNGs | Readout cap | Output cap B |   Admission B |
| -------------- | ----: | ---: | ----------: | -----------: | ------------: |
| review-thalune |    12 |   11 |      16,384 |  184,565,760 | 5,402,312,704 |
| review-ixari   |    12 |   11 |      16,384 |  184,565,760 | 5,402,312,704 |
| review-ulgani  |    12 |   11 |      16,384 |  184,565,760 | 5,402,312,704 |
| view-thalune   |    19 |   18 |      32,768 |  302,022,656 | 5,754,683,392 |
| view-ixari     |    21 |   20 |      32,768 |  335,577,088 | 5,855,346,688 |
| view-ulgani    |    21 |   20 |      32,768 |  335,577,088 | 5,855,346,688 |
| return-thalune |     4 |    3 |      16,384 |   50,348,032 | 4,999,659,520 |

Total: **101 files: 94 PNGs and 7 readouts**. `inventory.json` lists every basename, in capture order. Every PNG is capped at 16 MiB. The three full first-person readouts retain full-precision material facts for every frame, both fire projections and incoming-people facts. A 19-frame serialization already measures 17,777 bytes before projections/packet metadata, so these readouts have a justified 32 KiB cap. No PNG count changes. The original 16 KiB Thalune arithmetic would be 5,754,634,240 B, not the proposed 5,754,433,536 B; the implemented additional 16 KiB readout allowance adds another 49,152 B across three copies.

Admission is `3 * outputCap + 4,848,615,424` bytes. The three physical copies are the original output, immutable decoder copy, and verified copy. All originals/failed partials remain. The fixed reserves are metadata 64 MiB, cache snapshot 64 MiB, profile working+archive 2 GiB, private TMP working+archive 1 GiB, helper logs working+archive 128 MiB, cache growth 256 MiB, filesystem 16 MiB and safety 1 GiB. Profile/TMP/helper working ceilings are half their paired allowance. The metadata reserve remains 64 MiB: helper target+atomic-temporary high-water storage 16 MiB, Node receipts 8 MiB, helper snapshot journal 8 MiB and caller receipt attempts under 32 MiB (64 KiB withheld for failure diagnostics). Individual caller snapshots are capped at 14 MiB. Every helper write attempt is counted as I/O traffic; repeated overwrites do not allocate a new permanent file. Each helper destination reserves twice its largest serialized body, including failed temporary writes. Caller/journal writes remain exclusive, with every attempt charged. Raw helper observations are retained before assertions; ordinary cleanup receipt failures remain errors while mandatory owned draining proceeds. Interruptions always unwind.

These are **observed native reserve ceilings, not OS quotas**. Native processes can grow between observations; this preparation does not certify their real footprint. Capture is bounded at 600 s, cleanup at 60 s, post-release copying/CPU decode at 45 s, and cache snapshot at 64 MiB/30 s. There are no movies, raw frame directories, new clips, image bake/render jobs, second browser stack or generalized operations framework.

## Actual consumers and fixture

Standard units call the existing exported `captureReview` with the three `characters/viewmodels/fp_*` assets and `outDir`. Their images are 1920×1080, with the existing 1920×2876 sheet. Authored shaded materials remain intact, including during wireframe inspection through the review's original-material map. Requested LOD2 is recorded separately from actual selected LOD0 in raw capture facts and image captions. Native stats/far facts must corroborate one LOD and the viewmodel class's 100 m far capture. Native overlay labels must corroborate Muzzle; Grip overlay is explicitly unsupported.

First-person units reuse `startVite`, `glArgs` and the existing Playwright Chromium launcher. `#foot` starts the real application's offline sandbox; the fixture refuses a live `game.net`. It settles the actual foot transition, stops the fixture's animation-frame driver, pins resolution, and advances original `Multitool.update` with explicit input. It does not substitute bones, clips, the meter, view transforms or runtime methods. The existing view pass is rendered at 1920×1080 and 2520×1080. Stills and raw facts come from the same synchronous render task. No server authority, gameplay unlock or codex manipulation is implied.

The 16:9 set is neutral, four settled sway extremes, raise 0/0.4 s, fire, overheat and underwater. The 21:9 set is neutral, one settled sway extreme, both raise endpoints, fire, overheat and underwater. Underwater must hide the view. Fire includes finite same-frame view/world/beam projections, both camera frusta and actual muzzle coordinates; x/y must align within 1e-5 NDC. Ixari and Ulgani add incoming gap/settled stills; the return unit contains only the Ulgani→Thalune gap/settled pair. Each transition first proves its incoming model is attached and visible in the real pass, then holds the actual target GLB request to expose the loader gap. A missing request, mode, model or required material fails instead of inventing a pose.

Before any PNG publication, live Skin and the selected people's Tool require all five complete 2048²/12-mip PBR slots. Bio is required for Thalune/Ixari, absent for Ulgani. Tool/Bio additionally require emission. CPU inspection independently validates all decoded PNG bytes, dimensions, exact inventories, material facts, state contradictions, LOD facts, incoming people and projections. CPU fixtures are synthetic test data, not visual evidence.

## Authority, binding and sequencing

`readiness.json` is an enabled, awaiting-grant source snapshot of this checkout's executable/runtime/assets/helper/dependency bytes and logical routes. It pins Node, tsx, esbuild, browser, Python launcher and self-observed kernel executable separately, decoder/Pillow and generated-cache locations. The four helpers were recovered in their original paths, byte-identical to `ca7d91e378e9d2f3f0ce8f0651475dcb843875d9`, in separate commit `c0191922b8e682660bf25b5de785143b9ab72c2e`. None of the historical capture packet was imported. The helper modules are imported only after admission and atomic consumption. The ordinary Chromium launch remains within StationJob/StageReceipts; no BrowserServer or replacement renderer is added.

`caller.py --prepare` performs local read-only binding/owner/absence probes and writes JSON to stdout. It starts no helper or native job. `caller.py --check readiness.json` rechecks those bindings and prospective paths. The committed readiness is the refreshed source candidate. Writing a fresh real grant remains a parent operation after independent correction review; the earlier disabled snapshots remain in Git and immutable evidence.

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

Metadata descriptors use `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`, then validate actual regular type, device/inode and size before bounded reads. Actual FIFO replacements between lstat/open are covered for grant, result and consumption, including closure. Cap+1 reads, same-buffer hashes/parsing, original/secondary errors, unknown byte observations, partial allocations and all-sinks in-memory evidence are covered. Failure never silently retries or unspends a grant. A failed/unproven native release forbids decoder dispatch. Independent correction review remains required before the parent issues a fresh grant. Historical R5 SOURCE PASS remains unchanged.

## Files and evidence

- `caller.py`, `boundary.py`, `bindings.py`, `native.py`: one-unit admission, snapshots, source/runtime bindings and recovered-helper adapter.
- `entry.mjs`, `fixture.mjs`, `resolve.mjs`: guarded native entry, actual application fixture and launch-free dependency resolver.
- `inspect_packet.py`: independent CPU PNG/readout inspector. Named to avoid shadowing Python's standard `inspect` module.
- `test_boundary.py`, `test_native.py`, `test_inspect.py`, `entry.test.mjs`, `fixture.test.mjs`: inert actual-boundary controls; at most two workers.
- `verify.py`, `audit.py`, `evidence/`: commands, exits, retained failures and protected-byte audit. This source correction produces no native captures or previews; the historical failed unit is retained separately.

Cross-lane reports used as source evidence: R3 `/private/tmp/p1-e08-t09-r3-independent-l9fn2t5y/REPORT.md`, R4 `/private/tmp/p1-e08-t09-r4-independent-pshs9o5k/REPORT.md`, R5 `/private/tmp/p1-e08-t09-r5-independent-xDKoJp/REPORT.md`. Their hashes and the T03 R1–R3 hashes are retained in `evidence/protected-hashes.json`. Existing source/CPU R3 PASS remains historical; native capture, live resource ownership, blind visual grading, T04 clips, full GPU smoke and whole T03 completion remain pending.

## Receipt schema and encoder prerequisite

Consumption metadata uses `schema: "viewmodel-consumption/1"`; result metadata uses `schema: "viewmodel-result/1"`. Result protocol fields remain at the root: identity/pins, `accepted:false`, `checksPassed`, `status`, `released`, `output`, `outputManifest`, and the three failure fields. The producer and authenticated successor consumer require these explicit schemas. Entry admission requires the consumption schema too. Protocol fields have ordinary JSON value semantics and cannot become graph envelopes.

All other fields, including unknown future fields, are retained together under `observations`, with `observationEncoding: "raw-graph-or-tree/1"`. Shared/cyclic observation values retain the bounded graph representation, types and stable reference identities. They are never used as substitutes for protocol success/identity/manifest fields. Primary and secondary failure facts stay explicit at the protocol root. A successful provisional receipt still requires the parent's observed OS exit 0 before successor admission.

R3 independently established a conditional refusal for a VM-owned cohort containing Apple `VTEncoderXPCService`. This candidate binds exactly `/System/Library/Frameworks/VideoToolbox.framework/Versions/A/XPCServices/VTEncoderXPCService.xpc/Contents/MacOS/VTEncoderXPCService`, SHA256 `a3af9d8f1d6423de4d6303c323f5132122181e01367155d325fc9bde3ed872b5`, 167,280 bytes. The entire route must be root-owned and non-writable by group/others. Readiness includes the actual strict Apple codesign verification, designated requirement, platform identity, protected route and codesign executable. The unchanged observer still requires current cohort membership, UID, birth identity, coalition and executable identity. Inert actual-observer controls reject missing/wrong binary bindings and wrong ownership. This is source/CPU proof; VM creation or external ownership of an XPC service remains unqualified.

The effects pilot diagnosis at `/private/tmp/p1-e07-t14-native-failure-3pevk0mk/APPENDIX-C2.md` and reviewed source `6b4073305af21efe5c6cf5ecc09f78406b637a42` informed this narrow prerequisite. Its native failure and metadata-budget diagnosis are historical effects evidence, not a reproduced VM failure. No segmented effects evidence system was imported; VM receipt budgets remain unchanged. No encoder, browser or native job was launched by that CPU prerequisite correction.

## R4 correction boundaries

The exact pinned `@playwright/test/index.js` is CommonJS. `productionCapture` reads its dynamic-import default; the package's installed public ESM and CJS exports share the same Chromium singleton. CPU controls import both actual modules and intercept only that singleton's launch port. They preserve primary/browser/Vite failures through actual shared capture and receipt publication. No browser or native job is started by these controls.

A historical T13 full-Chrome/BrowserServer cohort included `SetStoreUpdateService`; replaying that member through this packet's unchanged helper/map correctly refuses an unbound executable. This packet uses ordinary headless-shell with different bytes. That history does not establish that this route creates the service or authorize a new binding. No Storemember allowlist expansion was made; if such an owned member appears, the current packet will refuse and retain the facts for the parent. That R4 candidate subsequently passed historical R5 SOURCE review; the failed pilot and current correction are recorded below.

## Native failure correction

The native record identifies PID54994 as VTEncoder and PID55005 as MTLCompilerService, both UID501 in coalition `[42831,42832]`, with distinct recorded birth identities. The new exact MTL binding is `/System/Library/Frameworks/Metal.framework/Versions/A/XPCServices/MTLCompilerService.xpc/Contents/MacOS/MTLCompilerService`, SHA256 `65af927ce641351e604bf36da7a664e5350d583483c7e5f3fe799e0d0db7a78b`, 389,760 bytes. Readiness verifies the root-owned, nonwritable route and strict Apple designated signature `identifier "com.apple.MTLCompilerService" and anchor apple`. Current signature/hash proof does not establish historical process bytes. Unchanged helpers still require current owner/birth/coalition/executable observations; unknown executables and Storemember remain refused unless separately bound.

VM CPU replay reproduced `Raw observation node ceiling` while publishing the native error's attached evidence. The original caller encoded that graph before publication, then encoded its graph representation again. The correction keeps the original exception and encodes each protocol field once. Complete failure results retain every returned helper observation, shared/cyclic unknown fact and cleanup error. The full `viewmodel-result/1` schema and predecessor contract are unchanged; no segmented effects format is imported.

After both full sinks fail, one exclusive `consumed.json.failure-summary.json` write is attempted from the existing withheld allowance, followed by a bounded stderr diagnostic. Its schema is `viewmodel-publication-failure/1`, with `accepted:false` and `completeRecordDurable:false`; it carries explicit truncated prefixes/counts, not complete evidence. Complete facts remain in the returned in-memory record, with publication failures separate from primary/cleanup failures. If every sink is unavailable, memory cannot survive process exit and no durable claim is made. Interrupted publication stops later file sinks and emits only the reserved last diagnostic. The CLI returns its real status without catching its own normal `SystemExit`.

Each complete write is encoded once, admitted and charged before dispatch; failed writes retain their charge. Refused attempts are counted separately from dispatched bytes. Both result/fallback plus the failure-only path are checked absent before allocation. These additional metadata paths do not change the 101-file image/readout inventory or any admission ceiling. See `NATIVE-FAILURE-CORRECTION.md` and its exclusive evidence for exact RED/GREEN and protection proof.

## Live sampling correction

The real VM callback reproduced profile/private-TMP deletion and rename races. Live sampling now uses descriptor-anchored, no-follow metadata traversal of the three pinned owned roots. Descendant ENOENT and directory identity changes produce retained partial facts, including original errors; permission errors, other I/O errors, wrong owners, symlinks and root replacement still fail and drain. Known socket/FIFO entries are counted as metadata without opening their contents.

Samples explicitly say `atomic:false` and `settled:false`. Even a fully enumerated sample is not a complete immutable inventory. Partial samples retain measured bytes, entries, path/operation/error facts and timing. Each sample is capped at two seconds, 100,000 entries, depth 64 and 32 losses; repeated partial coverage is limited to two seconds, 128 retained partial samples and 256 KiB of partial evidence. The failing sample remains retained. Existing working-byte ceilings are unchanged. These observations cannot prove a live process's instantaneous footprint.

The actual CPU caller control physically renamed a Vite-shaped cache directory during the live callback. Generated-cache reads occurred only before capture and after proved release; they remain strict. The original final settlement, archive copy/hash checks, release gates and frozen helpers are byte-identical. Mutation after the real helper's copy still refuses. See `LIVE-SAMPLING-CORRECTION.md` for exact-base RED, focused GREEN, preservation and readiness evidence. No native attempt or real grant was made for this correction.

## Observation budget correction after native attempt 2

Native attempt 2 at `a78c7e5f58e399fcecab0197b65ffe42500cb16a` is also **FAILED/SPENT**: exit 1, 18.485242416 seconds, zero images. The helper saved `Raw helper observation ceiling exceeded`; both full caller sinks failed with `Raw observation node ceiling`. Only the bounded caller failure summary and helper/parent records survived. The missing in-memory helper history is unavailable and has not been reconstructed. Both failed native attempts remain unchanged.

Actual native capture now writes helper event snapshots to a task-local lossless journal under its already admitted evidence directory. Repeated canonical snapshots use explicit definition/reference records; every occurrence remains in completion order. The independent `callSequence` retains invocation order for nested helpers without defeating content deduplication. Each snapshot retains its existing raw graph representation, unknown fields, aliases, cycles and bytes without graph-encoding that representation again. Identity namespaces are snapshot-local, as they were in the original per-field `raw()` observations. Content deduplication does not claim original Python identity across observation times.

The journal has an 8 MiB exclusive-write reserve, with capture limited to 6 MiB and the remainder reserved for cleanup/index. Segments contain at most 1 MiB expanded transport; a single event is at most 2 MiB. The dictionary is bounded to 16 MiB/16,384 entries, logical and transport expansion to 1 GiB, and the index to 256 KiB. Definitions reset explicitly at the dictionary boundary. Every segment carries compressed/expanded sizes and SHA256; the typed result's required `helperEvidence` manifest binds the same index and ordered bytes. Strict nonblocking/no-follow snapshots, complete zlib EOF, bounded expansion, exact inventory and counters are checked after positive release and again during authenticated successor admission. The image/readout inventory stays 101 files; journal files consume metadata/filesystem reserves, not image slots.

First helper/collection exceptions are retained before unchanged `StationJob.wait` normalization. Storage or encoding failure stops capture dispatch and retains the pending event/bytes; ordinary recording errors do not prevent mandatory drain. Failed segments, index attempts and complete-record publication failures remain distinct. An incomplete journal can never qualify a successor. Complete journal validation is required before CPU image decoding. If both full receipt sinks fail, the existing bounded summary/stderr remain honest about incomplete durability; a durable journal prefix is not a complete record.

These finite limits do not promise every possible 600-second workload will fit. Capture's 600-second timeout is not evidence-volume admission. Unknown/uncompressible or excessive data must refuse, retaining its prefix and pending memory rather than dropping facts or enlarging a ceiling. See `OBSERVATION-BUDGET-CORRECTION.md` for measured arithmetic, actual-boundary RED/GREEN, source/CPU proof limits and immutable historical evidence. Fresh independent review is required before a parent schedules a new one-use grant.
