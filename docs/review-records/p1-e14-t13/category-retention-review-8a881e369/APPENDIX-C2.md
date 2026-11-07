# Appendix C.2 — Independent SOURCE/CPU review of P1.E14.T13 category-return retention

TASK: P1.E14.T13 category-return retention correction after prior native3 REVISE (F1).
STATUS: **PASS** for this SOURCE/CPU review unit only. Fresh freeze remains DISABLED. No native/timing/budget/merge authorization.

SUMMARY: Re-verified author candidate at clean head `8a881e369de35c4fb62cc9ae5d68e48d54716cbf` / tree `3ca9cef5984e6b996b89ffbca5d96d7ef9751cec` against exact REVISE base `54a36dc47e0429f6aeb057fa9aba4ff421f8b9c9` / tree `3b3bf250cf9a1ea4091e1cd1520f994a27ea28b7`. Exactly four scoped files differ. Independent exact-base RED reproduces the three F1 cases (cancelled-return, deadline-draining-return, worker category-cancel); neighbors stay green. Current GREEN and focused suites pass. Production retains structuredClone of the raw Tracing.getCategories reply inside the owned callback while acceptingEvidence is true, before owned cancellation checks. Admission/schema/Tracing.start still require a successful uncancelled owned return. Cancel/deadline failures, summary:null, empty-list admission, drain-before-close, and late-after-cutoff nonmutation are preserved. No remaining P2+ race found in scoped code for this unit.

## Pins

- Reviewer scratch: `/private/tmp/p1-e14-t13-category-retention-review-2QoxTeDI` (exclusive; author scratch and parent retention untouched).
- Author worktree (read-only): `/Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8`; branch `codex/task/P1-E14-T13-trace-observer`; porcelain clean.
- Author seal scratch (read-only): `/private/tmp/p1-e14-t13-category-retention-sczivq8g`; APPENDIX-C2 SHA256 `c2c2d2469cbe5bc89db1f552486bc82ff74e51bb2b500af67e508305ac4301dc`; seal SHA256 `c2142a05a618c24c6f18580a3feb62580d05869a71848fee40448f32d5609b34` (matches claimed).
- Prior REVISE F1: `/private/tmp/p1-e14-t13-review-native3-vj5fl6fu/APPENDIX-C2.md` SHA256 `79b15910e89b2eca9f7140737538bbe7ef2295dd14969d3b6c1f8ce6899463b1`; seal SHA256 `5a7b268f3cf206291550faa6869b3e1830c78559869e427c6c3e21aded7d90ce` (matches claimed).
- Parent retained copy (read-only): `/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab/docs/review-records/p1-e14-t13/category-retention-8a881e369/`.

## Scope and source identities

Exactly four files vs base (140 insertions / 11 deletions). Independent SHA256 matches author source-hashes.json:

| Path | base | current |
|---|---|---|
| `packages/tools/src/capture/browser-work-trace.ts` | `86339ea514767fd824b7efa83887f00bff1ad593121127ad12dc225689a2613f` | `3462692a384be7d4a4a7e58b651e2751058e7b59e896ef8f01ef1fb81f5be61b` |
| `packages/tools/src/capture/trace-observer.test.ts` | `82f1e6e530cb46c7f32209e98c5ac7cae62dc9df1671064502e02a258970b73c` | `5dd96ff31dfe7822823219df3ffc4cd331705135a22d3b356c1e472294709467` |
| `packages/tools/src/capture/trace_observer_packet/worker.drain.test.ts` | `abad68374f2227d1f02b70c86f5955718ef4abbd800e21a3b1ce2aeb636305a9` | `e5dc6118a247a087929abb2ef05dccecb000a9547bf74954285fb7780ad9a33f` |
| `packages/tools/src/capture/trace_observer_packet/local-binding.json` | `6c63cf528a7cf1553a1a4563b24e19e9a35d1c28a8b9b8bf8c2897d04fc46f4d` | `dddf5f64bdd171f7154b10c843c56467b7612f287e3e5d8de5e5053406ccfaf5` |

Production change: inside owned category callback, retain structuredClone(raw) while acceptingEvidence before owned cancellation check.

## Independent RED / GREEN

Node `/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node`; maxWorkers=2; TMP under reviewer scratch; NEW evidence ≈143 MiB (≤256 MiB; no symlink-follow accounting).

| Proof | Exit | Result |
|---|---|---|
| reviewer-exact-base-red | 1 | 3 failed / 15 passed |
| own-exact-base-red | 1 | 3 failed / 1 passed (late-after-cutoff already green on base production) |
| reviewer-current-green | 0 | 18 / 18 |
| own-current-green | 0 | 4 / 4 |
| focused-current (trace-observer.test.ts + worker.drain.test.ts) | 0 | 297 / 297 |
| tools typecheck / scoped lint / scoped format / git diff --check | 0 | clean |

F1 RED assertions: retained categories expected but null on base for cancelled-return, deadline-draining-return, and worker category-cancel. GREEN retains raw reply including unknown producer fields while keeping original cancel/deadline failures and summary:null.

## Preservation

- Old protocol prefix before `export interface ObserverClock` SHA256 `aaaef3705f0da62b15b72187f30c5cc1f6e8350f281727322906951200554f52` at base and head.
- runtimeAuthorized remains false (4 occurrences in binding; no true).
- Attempt3 packet SHA256 `62754edcdb44872b48478c4f097f770ff8c1544224f08c9866c43670ad736271` unchanged (read-only). Decompressed packet/result.json.gz SHA256 `f1d8cd7ce85143b49f5c52d202d39559cb734320986ab123c1cfba12b1742c6b` unchanged (read-only). Parent native r3 scratch not mutated.
- Empty-list admission and page-drain-before-browser-close preserved (neighbors + focused).
- Late-after-cutoff nonmutation preserved (own green).

## Race hunt (scoped)

No additional P2+ findings in scoped production/test paths. Retention is gated by acceptingEvidence; schema validation and Tracing.start remain after successful owned return; post-cutoff replies cannot assign. Ownership/cleanup ordering in worker drain tests still requires page cancel before browser.close.

## Authorization boundary

Verdict **PASS** for SOURCE/CPU only. Does **not** authorize freeze, native/GPU/browser/CDP grant, timing/budget PASS, push, PR, Trunk, or merge. Fresh freeze remains DISABLED unless parent later authorizes.

ARTIFACTS: this report; verification.json; source-hashes.json; preservation.json; commands.jsonl/md; RED/GREEN/focused JSON+stdout/stderr; seal.json; SHA256SUMS.
