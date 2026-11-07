TASK: P1.E05.T02 — final native189 mechanical activation/binding, Appendix C.2

STATUS: DONE for configuration and CPU admission verification. No native run or
grant occurred. Parent mechanical review and a fresh one-use diagnostic grant/run
after the T13 quiet window remain next under existing user authorization.

SUMMARY: Enabled only readiness.nativeFixtureAuthorization, as required by the
unchanged native CLI, while retaining runtimeAuthorization=false. Refreshed the
candidate index and audit metadata. Source, helpers, protocol, plan, assets,
playback, toolchain and process allowlist remain exact R5 bytes. The existing 11
operational paths are absent, so no new namespace or plan is needed. This unit
provides an exact command, grant schema/inert example and current bindings without
launching or granting the two native cohorts.

Base/reviewed source: `b6ad8528c7fe504817078fcfe0f253caac45020d`, tree
`3a8f15923b5314dd894012f98d5728bb99a9a69d`; branch
`codex/task/P1-E05-T02-thalune-reel-candidate`. Independent R5 PASS:
`/private/tmp/t02-native189-r5-independent-znhry9ge/REPORT.md`. Final activation
commit/tree are in the handoff. This report is not a grant. Parent grants must bind
the final activation HEAD, not the earlier R5 source-review HEAD.

FILES CHANGED:

- readiness.json: nativeFixtureAuthorization false → true only. The ordinary
  capture flag remains false; all other values, bindings and source hashes match.
- candidate-index.json: native-only waiting-for-grant phase, native flag, and the
  exact updated readiness row. No executable/source row changes.
- source-audit.json: current activation metadata, focused verification and hashes.
- revision-09/: bounded admission fixture, schema/example, command, LAUNCH.md,
  next-launch.json, reports, provenance and hash manifest. No existing algorithm,
  helper, source, asset or historical report was changed. runtime-bindings.json
  remains immutable identity/provenance evidence; its old flags are not the CLI's
  activation gate. The gate reads readiness.json.

VERIFY:

- **22 focused CPU controls PASS**, driver exit 0. Actual native.verify_sources
  and check_plan accept the configured checkout identities. The actual consume
  function accepts the exact 22,066,626,560-byte reserve boundary through inert
  ports and refuses one byte below it. Negative controls cover wrong purpose,
  captureGo/nativeFixtureGo, job order and frame count, expired/overlong lifetime, wrong
  HEAD/readiness/plan/index hashes, wrong grant path, cancellation, existing run,
  spent consumption, native disabled, capture enabled and cached-ready drift.
  Unknown grant data survives the positive memory record.
- All synthetic grants/snapshots, consumed records and output directories in those
  tests remain **in memory**. The clean-HEAD and free-space ports are inert for
  consume fixtures. No actual grant/consumption/output path is written. This is
  CPU admission evidence, not live resource admission. Final clean HEAD is checked
  separately after commit. The actual main path with absent grant is also
  instrumented: NativeAdapter/Popen are never reached and retained native helper
  modules are not imported.
- **Five actual CLI gates return expected exit 1**, with all 11 operational paths
  absent before/after: native --execute --grant <actual absent path> gives
  FileNotFoundError; browser caller --execute gives SOURCE_ONLY_RUNTIME_DISABLED;
  Python -O native entry gives T02_ASSERTIONS_REQUIRED; the two legacy source-only
  preflights give AssertionError because they require both flags false. These
  refusals are intentional and are not runtime or test failures. Raw stdout and
  complete stderr tails are retained under evidence/; no code was changed to
  alter those preflight semantics.
- Exact argv, cwd, PATH and exits are in commands.json and evidence/. Admission
  uses the pinned Python3.12 with -B and a finite 180-second driver bound. CLI
  checks are bounded at 30 seconds each. JSON/schema-shape and new test AST checks
  pass; no dependency was installed. New report formatting uses direct pinned
  Node/local Prettier, without pnpm or another package-manager invocation.
- The 525 prior controls and R5's 56 fresh controls remain **retained prior
  disabled-source evidence**, not rerun or added to this unit's count. Reviewed
  runtime code is unchanged. No TS/JS product change or broad verifier rerun was
  needed. No full producer, library, Blender, codec, GPU, browser, service/server,
  DB, install, hydration or screenshot/cleanup operation occurred.
- All 2,354 source/data bindings, 12 software identities and 42 candidate rows
  verify. All 1,151 protected prior-manifest rows match; only readiness, candidate
  index and source audit are authorized existing-file changes. Node remains
  v26.12.1; Python remains the reviewed 3.12.14 executable. No binding retarget or
  executable allowlist expansion occurred.
- Before activation, all 29,654 entries in the R5 snapshot matched. After this
  unit, all **29,651 rows outside the three authorized metadata files match**,
  including current pnpm task state, exact helpers, assets and historical proof.
  The older full snapshot remains **FAILED/MISMATCH** on its three disclosed pnpm
  task-state deviations. This current preservation result does not repair or
  relabel that older failure. No marker was restored or removed.

DECISIONS:

- Must nativeFixtureAuthorization be enabled → yes → verify_sources requires true
  before it can read the parent's native grant. runtimeAuthorization remains false.
- Must source, plan or IDs change → no → R5 passed and the existing exact namespace
  is still absent; retain all reviewed protocols, paths, budgets and helpers.
- Does the missing VTEncoder binding require expansion → no → this CPU diagnostic
  selects libx264rgb and software decode, not browser/VideoToolbox. Later browser
  capture requires its exact owned Apple closure before separate activation.
- Can the parent's approximately 32 GB observation admit the run → no → require
  fresh capacity/ownership at execution; the unchanged reserve code measures anew.
- Must full suites or pnpm rerun → no → focused activation controls suffice for
  the metadata-only change; preserve the prior snapshot deviation and quiet window.

OUT OF SCOPE FOUND: Actual native inheritance, encoding/decoding, peak RSS and
owned release remain unqualified. Parent must observe the actual runner OS exit
zero; provisional disk status is insufficient. Whole-animation capture/visual
acceptance remains pending; gameplay belongs to E05.T04. No main, push, PR, merge,
or orchestration-document change occurred.

ARTIFACTS: LAUNCH.md gives the exact one-shot protocol and remaining prerequisites;
command.json gives absolute argv/cwd/environment; grant.schema.json defines all 12
required fields; grant.example.json is intentionally expired and HEAD-invalid.
next-launch.json gives current hashes, exact output/job/log paths, native identities
and limits. commands.json, evidence/, unit-provenance.json, preservation reports
and combined-hash-manifest.json retain verification and hashes. No visual artifact
or operational grant exists.

Current readiness SHA256:
`daa896c0281cfe5d3c539eb5627f352df68ad52e4b7ca2637183c5105b37a040`.
Candidate index SHA256:
`79eb11a88c72e815ea66b1c57eb582a6e9ed8e840a5515607cd182c65f0649d4`.
Unchanged plan SHA256:
`3854b1996c49640e77b65950c429f6e017730b90206fbf0c58ae46f3d1656f21`.

Only two cohorts are configured: encoder189, positive capture-cohort release,
then validator189 with bounded negative190. Limits remain 39,354,368 bytes/reel,
64 MiB native metadata, 8,589,934,592-byte sampled aggregate owned RSS,
600-second cohort / 60-second cleanup / 30-second final inspection,
384 MiB / 4,096-entry joint cache admission, 1 GiB/job archive acceptance and
**22,066,626,560 bytes combined reserve**. Four copy slots and eleven archive
allowances remain unchanged. No OS quota or unrelated XPC ownership is claimed.
Actual 378-motion/eight-still browser capture stays disabled.
