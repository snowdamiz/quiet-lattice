# Native189 diagnostic handoff

This activation configures only `THALUNE_NATIVE189_DIAGNOSTIC_ONLY`:
`native-189-encode` followed by positive owned-cohort release, then
`native-189-validate`. `readiness.nativeFixtureAuthorization=true` is required by
the existing CLI. `runtimeAuthorization=false` and plan.captureAuthorization=false
keep the later 378-motion/eight-still browser capture disabled. No grant, consumed
record, run directory or native job was created in this unit.

The parent already has user authorization. After the T13 quiet window and
mechanical review, create one fresh grant at the unchanged, currently absent path:

`/private/tmp/t02-native189-r04-20261107-t3-11167406-grant.json`

Use grant.schema.json for the 12 required fields. grant.example.json is deliberately
non-operational: epoch-zero expiry, all-zero HEAD, example ID, and the wrong grant
location. Replace those fields when the parent creates the actual grant. Bind the
**final clean activation commit from delivery**, the exact current readiness,
plan and candidate-index hashes, a fresh authorizationId, and current Unix time
plus 1,800 seconds. Admission permits at most 3,600 seconds. Do not use the R5
review head as the activation head, and do not run freeze.py: it resets both flags
false. No source, toolchain or allowlist update is required for this handoff.

From `/Users/andreyyurlov/.t3/worktrees/space/t3-11167406`, with PATH exactly equal
to command.json's environmentOverrides.PATH, the one-shot command is:

```sh
/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B packages/tools/blender/characters/animations/thalune-run-candidate/native189.py --execute --grant /private/tmp/t02-native189-r04-20261107-t3-11167406-grant.json
```

command.json provides the absolute argv, working directory and exact environment.
Do not use a package manager or another Python/Node/toolchain wrapper. The CLI now
passes native-source admission and refuses at the absent grant. Its legacy
no-argument source-only preflight, and caller --preflight, require both flags
false and therefore refuse after activation. This behavior is unchanged; it is
not a reason to change code or disable assertions. Browser caller --execute
still refuses with SOURCE_ONLY_RUNTIME_DISABLED.

The parent must recheck absence, clean HEAD, source/software identities, current
capacity and ownership at execution. The earlier approximately 32 GB observation
is not admission. The unchanged runner rechecks source, expiry, cancellation,
HEAD, retained inputs and free space before allocation and dispatch. The grant
and receipts use the existing regular-file/type/size admission and one capped
2 MiB snapshot for hash and semantics. A spent or failed namespace is retained;
never reuse the consumed claim or silently retry. A cancellation sentinel holds
the unit. A new attempt requires a distinct reviewed namespace if this one is
spent; none is spent now, so its plan/paths are unchanged.

Exact outputs and hashes are indexed in next-launch.json. The prospective root is
`/private/tmp/t02-native189-r04-20261107-t3-11167406`. Its one reel and frame map are
`packet/captures/motion-thalune-run-lod0/{primary.mp4,frame-map.json}`. Validation
is under `packet/inspections/native-189-validate/`: validation.json,
surplus-refusal.json, and separate probe/rgb/rgba stdout, stderr and command JSON.
The negative190 raw logs remain in the validator's proof job native directory.
Each of the two jobs has separate proof/jobs/<id>/receipt.json, worker-config.json,
worker-entry.json, native/ logs/failures and owned-job/ release/archive evidence.
Final proof/result.json and packet/integration-result.json retain terminal facts.
The sibling consumed and cancel paths are unchanged. next-launch.json lists all
14 final packet files and exact proof/log paths; no prospective path was allocated.

Limits remain 189 opaque 1920×1080 frames at 60 Hz, one ACK in flight, no retained
PNG sequence or RGB spool, libx264rgb with one encoder thread, CPU decodes with one
thread, and 39,354,368 bytes per reel. Probe: 30 seconds; each RGB/RGBA/surplus
inspection: 120 seconds; cohort: 600 seconds; cleanup: 60 seconds; final inspection:
30 seconds. Positive integer exit zero and positive owned release are required
before validation. The surplus control is bounded at 190 decoded frames.

The aggregate owned RSS stop is **8,589,934,592 bytes**, sampled every 0.2 seconds
with a three-second sample deadline. Unknown membership/RSS, reuse, drift,
excess, cancellation or errors hold dispatch and use existing bounded release.
This is not an OS quota and does not claim unrelated XPC processes.

The unchanged combined reserve is **22,066,626,560 bytes**: four declared
1,217,495,040-byte copy slots, eleven 1 GiB archive allowances, 16 MiB Git,
1 GiB staging and 4 GiB safety. Only one fixture packet is created; three copy
slots are reserved. Retained input inventory remains 157 files / 874,877 bytes,
with a 570,425,344-byte ceiling. Native packet metadata acceptance stays 64 MiB;
per-job archive acceptance stays 1 GiB; future Vite cache admission remains joint
384 MiB / 4,096 entries. No old free-space or cache-owner report is fresh admission.

The process map is byte-identical to R5. It does **not** bind VTEncoderXPCService.
This diagnostic uses libx264rgb and software decoding (`-hwaccel none`) and does
not invoke a browser or VideoToolbox. Unexpected owned executables must still
refuse; no Apple-directory or XPC allowlist is added. Actual browser capture later
needs the exact owned Apple executable closure and current cache ownership bound
before its own activation. This diagnostic grant cannot authorize that capture.

The parent's actual observed OS exit must be exactly zero. Disk status
NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT is provisional, not proof of the
runner's exit or permission to capture. Preserve original result/consumption
snapshots, failed writes, unknown release facts and all failed artifacts. The
three historical pnpm task-state deviations and full snapshot FAILED/MISMATCH
remain retained; no restoration or cleanup is authorized by this handoff.
