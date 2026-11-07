# Appendix C.2 — P1.E14.T13 category-return retention correction

TASK: P1.E14.T13, bounded SOURCE/CPU correction after independent native3 REVISE.
STATUS: DONE for this implementation unit. Whole T13 timing/budget remains INCONCLUSIVE. Fresh freeze intentionally DISABLED/NOT EXECUTED. No native grant, timing PASS, push, PR, or merge.

SUMMARY: Independent review F1 showed that `receipt.categories = await owned(...)` dropped a real Tracing.getCategories reply when cancellation or the category deadline won the owned-operation wrapper. The owned callback now retains a structuredClone of the raw reply while `acceptingEvidence` is still true, before owned performs its cancellation check. Admission/schema validation and Tracing.start remain gated on a successful uncancelled owned return. Original cancellation/deadline failures, failed packets, and `summary:null` are preserved. Exact-base RED and current GREEN cover the three reviewer reproductions plus late-after-cutoff nonmutation. Empty-list admission and page-drain-before-browser-close remain intact.

## Exact provenance and scope

- Worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8`; branch `codex/task/P1-E14-T13-trace-observer`.
- Exact REVISE base: `54a36dc47e0429f6aeb057fa9aba4ff421f8b9c9`, tree `3b3bf250cf9a1ea4091e1cd1520f994a27ea28b7`.
- Clean committed head: `8a881e369de35c4fb62cc9ae5d68e48d54716cbf`, tree `3ca9cef5984e6b996b89ffbca5d96d7ef9751cec`.
- Commit: `P1.E14.T13: retain category replies before cancellation checks`.
- Independent REVISE: `/private/tmp/p1-e14-t13-review-native3-vj5fl6fu/APPENDIX-C2.md` SHA256 `79b15910e89b2eca9f7140737538bbe7ef2295dd14969d3b6c1f8ce6899463b1`; seal SHA256 `5a7b268f3cf206291550faa6869b3e1830c78559869e427c6c3e21aded7d90ce`.
- Exactly four files, 140 insertions / 11 deletions. No recovery needed. `correction.patch` and `source-hashes.json` retain base/current identities.

FILES CHANGED / final SHA256:
- `packages/tools/src/capture/browser-work-trace.ts`: `3462692a384be7d4a4a7e58b651e2751058e7b59e896ef8f01ef1fb81f5be61b` (base `86339ea514767fd824b7efa83887f00bff1ad593121127ad12dc225689a2613f`)
- `packages/tools/src/capture/trace-observer.test.ts`: `5dd96ff31dfe7822823219df3ffc4cd331705135a22d3b356c1e472294709467` (base `82f1e6e530cb46c7f32209e98c5ac7cae62dc9df1671064502e02a258970b73c`)
- `packages/tools/src/capture/trace_observer_packet/worker.drain.test.ts`: `e5dc6118a247a087929abb2ef05dccecb000a9547bf74954285fb7780ad9a33f` (base `abad68374f2227d1f02b70c86f5955718ef4abbd800e21a3b1ce2aeb636305a9`)
- `packages/tools/src/capture/trace_observer_packet/local-binding.json`: `dddf5f64bdd171f7154b10c843c56467b7612f287e3e5d8de5e5053406ccfaf5` (base `6c63cf528a7cf1553a1a4563b24e19e9a35d1c28a8b9b8bf8c2897d04fc46f4d`)

Production change is the category owned-callback retention only. Old protocol prefix before `export interface ObserverClock` remains byte-identical SHA256 `aaaef3705f0da62b15b72187f30c5cc1f6e8350f281727322906951200554f52` across dd070 / 54a36 / 8a881e. Binding JSON changes exactly prefix/output/fallback/consumption/grant to `bwt-0b3adcd9c21c44e581bbda869f8fc205`; all 548 binary bindings and `runtimeAuthorized:false` remain. Plan SHA256 unchanged `73522bd42bd66eb35e9f94fcaa6f8813c2b5738be8ee9d34553ca14c50c7abed`.

## Review finding F1 — fixed

Location was `browser-work-trace.ts` category assignment outside the owned callback. Remedy applied: inside the owned callback, `const raw = await options.trace.send(...); if (acceptingEvidence) receipt.categories = structuredClone(raw)`. No trace/preparation admission after cancellation. Unknown producer fields survive on the retained clone. Failed packet keeps original error and `summary:null`; `categoryDiscovery.status` stays `unrequested` when owned rejects.

## Exact-base RED / current GREEN

Node `/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node` / maxWorkers2 / scratch TMP under `/private/tmp/p1-e14-t13-category-retention-sczivq8g` (≤256 MiB NEW evidence ceiling; frozen-bundle ceiling remains separate ≈768 MiB and was not raised).

| Proof | Exit | Result |
|---|---|---|
| reviewer-exact-base-red (3 F1 reproductions + 15 neighbors) | 1 | 3 failed / 15 passed |
| own-exact-base-red (cancelled-return, deadline-draining-return, late-after-cutoff, category-cancel) | 1 | 4 failed / 0 passed |
| own-exact-base-red-2 (same filter after format) | 1 | 3 failed / 1 passed; late-after-cutoff already green on base production |
| reviewer-current-green | 0 | 18 / 18 |
| own-current-green | 0 | 4 / 4 |
| focused-current (`trace-observer.test.ts` + `worker.drain.test.ts`) | 0 | 297 / 297 |
| tools typecheck / scoped lint / scoped format / git diff --check | 0 | clean |

Retained green packets under `tmp/` show returned raw replies with `unknown.bytes=RETURNED_RAW`, `summary:null`, zero preparations/segments, and original cancel/deadline failures. Late-after-cutoff still leaves categories null and does not mutate published packet/sinks after evidence cutoff.

## Original attempt3 and priors — unchanged

- Parent `/private/tmp/space-t13-parent-native-r3-tfaxf5oh` remains FAILED/SPENT; result SHA256 `f1d8cd7ce85143b49f5c52d202d39559cb734320986ab123c1cfba12b1742c6b`; packet SHA256 `62754edcdb44872b48478c4f097f770ff8c1544224f08c9866c43670ad736271`.
- Cloud03 remains FAILED / `accepted:false`.
- Preservation audit: 517 protected records; 1074 review regular files verified; current dependencies exactly equal the 54a36 freeze inventory (13322); prior declared Vitest-cache drift preserved; 24 original metadata files verified; attempt3 full ledgers unchanged; all prospective 0b3adcd9 paths absent.
- Prior dispositions: empty-list admission and drain-before-close PRESERVED; R1/R2/R3 fixes PRESERVED; F1 FIXED_THIS_UNIT. See `prior-dispositions.json`.

## Fresh freeze DISABLED

`freeze-plan.json` records the exact disabled freeze argv for head `8a881e369de35c4fb62cc9ae5d68e48d54716cbf` / binding `dddf5f64bdd171f7154b10c843c56467b7612f287e3e5d8de5e5053406ccfaf5` / destination `/private/tmp/t13-observer-frozen-8a881e369-0b3adcd9`, with `runtimeAuthorized:false` and `executed:false`. SIZE CLARIFICATION RESOLVED (user-confirmed): the single disabled frozen bundle keeps its existing **768 MiB** ceiling (`805306368`); NEW test/evidence scratch stays **≤256 MiB** (`268435456`) and is not raised. Source+deps+readiness ≈303123520 bytes (~303 MiB) charge the freeze ceiling only, so they do not conflict with the scratch limit. Planned payload before readiness ≈295 MiB sources+deps; scratch at seal stays under 268435456 bytes. No freeze build, grant, enablement, native, browser, CDP, GPU, Blender, install, or screenshot cleanup occurred.

## NEXT_LAUNCH (proposal only — not authority)

```sh
/private/tmp/p1-e14-t13-category-retention-sczivq8g/NEXT_LAUNCH.sh <parent-enabled-readiness-sha256> <fresh-grant-sha256>
```

Wrapper refuses with exit 78 until parent-authorized freeze materializes `/private/tmp/t13-observer-frozen-8a881e369-0b3adcd9/source/.../launch.py`. Prospective paths remain absent: enabled readiness/grant/consumption/output/fallback under `*-0b3adcd9`. Parent owns independent review, freeze, one-use grant (purpose/head/tree/readiness/plan/output/consumption, expiry≤3600s), GPU reservation, and heavy-CPU quiesce. Capacity at seal: 47395315712 available bytes; recheck at admission; not an OS quota.

Protocol bounds unchanged: 1920×1080 Thalune suit2/noon-lush; 12 preparations ≤7200 warmups; 10 measured frames; 48 dependent passes; 36 preflight fences; 24 control fences; 6 on segments; 64MiB/250000 events/1024 reads; 0 PNG/timer queries; five alternating on/off pairs plus fence controls; capture/drain/terminal 1009100/306100/1315200 ms. No 16.67 ms qualification.

DECISIONS: Retain raw category facts before cancellation without admitting cancelled work. Scratch ≤256 MiB stays separate from frozen ≈768 MiB ceiling. Freeze stays disabled in this unit. Parent owns orchestration docs and any later native authorization.

OUT OF SCOPE: No native/browser/GPU/CDP/service/Blender/codec/DB/network/install/pnpm/hydration/cleanup/grant/enablement. No push/PR/merge. Physical detach/browser lifecycle and budget proof remain unproved.

ARTIFACTS: this report; delivery.json; verification.json; source-hashes.json; correction.patch; freeze-plan.json; NEXT_LAUNCH.json/sh; commands.jsonl/md; failure-tails.md; prior-dispositions.json; RED/GREEN/focused JSON+stdout/stderr; audit-final.json; protected-final.json; artifact-hashes.json; seal.json.
