# Disabled native qualification and capture proposal

This is a source specification, not a grant or a runnable authorization. Both
authorization flags remain false. `next-native-proposal.json` contains the exact
absolute paths, executable hashes, configs, five capture jobs, eight still work
items and all 437 files expected in a successful capture packet after its terminal
summary. No prospective output, grant or consumption path exists.

The next native qualification would use two sequential owned StationJob cohorts:
one encoder receiving exactly 189 diagnostic PNG frames and one validator after
the encoder cohort has released. The diagnostic pattern, 1920×1080 dimensions,
opaque alpha, frame IDs and 60 Hz timing are specified in the JSON. One source
frame remains in flight until its ACK; no RGB spool or retained PNG sequence is
proposed. The encoder and validator configs are the adjacent
`native189-encode-config.json` and `native189-validate-config.json`. The existing
worker supplies libx264rgb lossless encoding, a 190-packet surplus refusal probe,
and separate RGB/RGBA framehash decoding with exact 189-count/PTS/hash acceptance.

The capture remains exactly:

1. `motion-thalune-run-lod0`: 189 frames, `run_forward`, noon-lush, LOD0.
2. `motion-thalune-run-lod2`: the same 189-frame schedule at LOD2.
3. `stills-thalune-run`: eight stills at 0.4 s; noon-lush, night-exotic,
   open-space and noon-lush wireframe at each of LOD0/LOD2.
4. `validate-thalune-run-lod0`, after all three capture cohorts release.
5. `validate-thalune-run-lod2`, after the first validator releases.

Each reel has 15 lead-in frames, three 48-frame loops and 30 final-pose frames.
There is one render per frame and backpressure before the next frame. Each reel
has its own `captures/<id>/primary.mp4`, frame map and complete observations.
Native encoder/worker logs are under `proof/jobs/<capture-id>/native/`.
Validators have separate `inspections/<validator-id>/` and
`proof/jobs/<validator-id>/native/` namespaces, with probe/RGB/RGBA stdout, stderr
and command receipts. All five owned child logs and release receipts remain under
their own proof job directories. Exact paths and file inventory are in the JSON.

Limits remain 600 s capture and 60 s cleanup per job; probe 30 s and each decode
120 s; one encoder/decoder thread. Per reel: 39,354,368 bytes. Per still:
12,582,912 bytes. Per observation: 262,144 bytes. Packet metadata: 361,234,432
bytes, 512 files, with separate 131,072-byte failure/terminal reserves and atomic
replacement peaks counted. Native reports are bounded at 2 MiB. The 1 GiB archive
limit per job is a post-release acceptance limit, not a filesystem quota.

The existing capture/historical allowance is 19,493,289,984 bytes. The proposed
new native fixture adds four copies of a 106,463,232-byte fixture packet and two
1 GiB archive slots. The conservative combined proposal reserve is
**22,066,626,560 bytes**. This deliberately retains all historical allowances.
The timestamped free-space observation and margin are in the JSON. Neither that
observation nor the older snapshot is a future admission; recheck immediately
before any authorized allocation. The capture's existing admission floor was
not changed by this source binding unit.

Runtime prerequisites remain concrete and unresolved:

- There is no task-specific native-only 189-frame producer/grant runner in this
  candidate. The historical 132-frame replay is incompatible. The worker argv in
  the JSON require the existing owned lifecycle and a bound producer; they are
  not standalone launch instructions. The worker currently refuses while the
  candidate's runtime flag is false. Do not open capture authorization merely to
  run a fixture.
- An 8 GiB whole-cohort RSS stop threshold is proposed for qualification. Existing
  helpers do not implement this aggregate limit, and CPU tests do not measure
  native cohort memory. Bind an owned measurement/stop mechanism before native
  admission; do not infer it from the Blender process measurement.
- Vite resolves to this checkout's `packages/client/node_modules/.vite` and
  `.vite-temp`. The first was absent; the latter was empty at observation.
  Current cwd owners included Acid `node_repl` processes, so a generic Node
  process name is not treated as proof of Vite ownership or absence. Establish
  exclusive cache ownership and retention before native admission. The shared
  Playwright cache and eight pre-existing private/profile namespaces are not
  owned by this task and were not removed or modified.
- Python launcher and kernel-reported executable are the same verified local
  Python 3.12 binary. Node, tsx/esbuild, headless Chromium, Pillow code/native
  extensions, encoder, decoder, kernel image and exact lifecycle helpers have
  local identities. `/usr/lib/libproc.dylib` is a logical dyld-cache image without
  a standalone file here; no extracted-image hash or native helper qualification
  is claimed. Native inheritance, executable observations, memory/cache growth
  and release still need actual qualification.

Cleanup must continue to use the retained StationJob drain/archive and
`preserve_private_tmp`: positive kernel emptiness and absent coalition,
registration and recorded births; byte-preserving archive verification; removal
of only the exact caller-owned profiles/TMP namespaces. Failed/spent evidence is
retained. No retry into an old namespace, deletion of unknown caches or reuse of
an old grant is proposed.

Fresh independent integration/binding review and explicit parent native
authorization remain the next gates. This unit supplies neither whole T02 visual
acceptance nor E05.T04 gameplay integration.
