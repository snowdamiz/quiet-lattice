# REVISE — independent read-only playthrough lifecycle review

Reviewed commit `3f4b22cad3917a967b27e28e99442f1fbb18314b`, tree `5e061c6d954b1ec60de993c132eed3f325f53e02`, in `/Users/andreyyurlov/.t3/worktrees/space/t3-a8fe2570`. The checkout was clean before and after review. Its pinned source bytes did not change. This is a source/CPU verdict; runtime acceptance remains pending.

**One revision required: P2 — a symlinked CLI entry silently reports success without running.** At `packages/tools/src/capture/playthrough-run.ts:78`, the new main guard compares `import.meta.url` with `pathToFileURL(process.argv[1]).href`. Node normally resolves the module to its real filesystem path, while `argv[1]` retains the entry alias. Invoking a symlink to this script therefore skips `runPlaythrough` and exits 0 with no phase output. A wrapper or automation invoking such an alias receives a false successful playthrough result.

This is a measured regression from the parent source, not a hypothetical dependency behavior. With identical stubbed external ports and the `leave` phase:

| Invocation | Exit | stdout | Resource/phase trace |
| --- | --- | --- | --- |
| Parent source through a symlink | 0 | `[leave] (0s) leave ok\n` | start, launch, phase, close, stop |
| Candidate through its real path | 0 | `[leave] (0s) leave ok\n` | start, launch, phase, close, stop |
| Candidate through a symlink | 0 | empty | empty, despite module being loaded |

The documented pnpm/tsx runner reproduced it on Node 26.12.1 (`cli-43.json`, `cli-44.json`). An explicit Node 22.23.3 invocation independently reproduced the same baseline/control/candidate split (`node22-cli-confirmation.json`). The latter file includes executable paths, versions, loaded module URLs, argv, stdout/stderr, exit status, and traces.

Resolve the entry path consistently with the module path, or use a reliable ESM entry detection mechanism compatible with the supported Node/tsx versions. Keep imports inert. Add an executable CLI regression case for a symlink entry, alongside a normal direct entry and an import-only control. No patch was made during this review.

**Lifecycle source assessment:** no additional defect found in the requested ownership/failure contract.

- Lines 7–15 compute argument/default-phase selection before acquisition, allocate failure state, acquire Vite, and immediately enter the protected block. Both `glArgs()` and browser launch occur inside it.
- Lines 15–56 execute the real production runner body. A browser becomes owned only after launch resolves. Page creation, handler registration, navigation, readiness, initialization, phase evaluation, dock inspection, and output are all inside the work catch.
- Lines 57–72 retain the raw work rejection and independently attempt browser close followed by Vite stop. A close rejection cannot skip stop. Owned cleanup is attempted once.
- Lines 73–75 use failure count, not truthiness. A single rejection is rethrown unchanged; multiple rejections preserve order and identity in `AggregateError.errors`, with an own `cause` property equal to the first raw value, including `undefined`.
- For ordinary direct CLI invocation, line 79 sets `process.exitCode` only after the runner settles successfully. Raw rejected promises reach top-level failure after cleanup. Phase-result strings/page-console errors still produce status 1, while successful results produce 0. Direct library calls do not mutate `process.exitCode`.
- The original browser-side phase exception formatting remains unchanged. Raw-failure identity claims here concern rejections escaping setup/work/cleanup ports; they do not newly promise raw transport of errors already converted into phase-result strings by the existing page callback.

**Tests and seams:** author tests exercise the real exported `runPlaythrough`, substituting only `capture.ts` ports and Playwright. They do not test a newly introduced cleanup helper in isolation. They cover many failure paths but do not execute the CLI guard; their `page.evaluate` stub also does not execute the page callbacks. The independent harness imports the real pinned file, intercepts its two external imports, and exercises its exported flow and actual CLI entry. Phase and dock callbacks execute against a minimal fake window; browser initialization is intentionally stubbed so it never imports or executes the real client playthrough. Hook guards reject accidental real Vite/Playwright dependency loading.

| Verification | Result | Exact retained evidence |
| --- | --- | --- |
| Author playthrough lifecycle suite | 85 passed | `node22-author-results.json`, `node22-author.log` |
| Existing shared capture lifecycle suite | 100 passed | same author artifacts; 185 total |
| Independent exported-flow probes | 131 passed | `independent.test.mjs`, `node22-independent.log` |
| CLI compatibility/failure matrix | 37 passed, 1 failed; 44 subprocess runs | `cli-probes.py`, `cli-results.json`, `cli-probes.log`, `cli-01.json` through `cli-44.json` |
| Explicit Node 22 CLI confirmation | two positive controls; candidate alias still silently succeeds | `node22-cli-confirmation.json` |
| Source/diff integrity | clean; original pins and four source hashes preserved | `initial-pins.json`, `final-pins.json`, `change.patch`; `git diff --check HEAD^ HEAD` exit 0 |

The 131 probes cover synchronous throws from launch, page creation, handler registration, URL/gl-argument getters, readiness, initialization, phase/dock work, close and stop; `undefined`, `null`, `false`, 0, empty string, -0, NaN, object and AbortError values; ordered falsy triples; repeated references; console output failure; phase failure plus cleanup failure; and delayed cleanup proving stop waits for close settlement. This tests cancellation represented by an AbortError rejection, not OS signals or hard process termination.

The CLI matrix covers inert imports; byte-for-byte parent/candidate output and exit compatibility for default/custom phases, argument separators, dock state, failed phases, and page/console errors; nonzero exit after startup/setup/launch/work/cleanup rejections with `undefined`, `null`, `false`, 0, and AbortError; and aggregate diagnostics. Its sole failed assertion is the symlink regression above.

The initial focused and exported-flow runs also passed (185 and 131), and are retained under `author-*` and `independent-*`. They were repeated with the checkout's verified Node 22.23.3 environment after discovering that the first probe processes inherited Node 26.12.1 from the reviewer's default working directory. `verified-runtime.json` records Node 22 and pnpm 12.15.0. Counts above describe test cases, not a sum inflated by repeated runs.

One preliminary baseline comparison failed closed in the review harness because macOS canonicalized `/tmp` to `/private/tmp`, so its dependency interception did not recognize the copied baseline. That attempt is retained as `symlink-baseline-comparison-harness-attempt1.json`. The harness target comparison was canonicalized, and the final baseline in `cli-43.json` ran successfully. No production source was altered to obtain either result. The initially misnamed Node 22 direct-node confirmation was actually Node 26; it is retained as `node26-cli-confirmation-initially-misnamed.json`. The final explicit Node 22 confirmation records its actual version.

**Pins and preservation:**

- Candidate runner blob: `ee4d9011fc5cec7a2899443ebbca8bc707044a40`.
- New lifecycle test blob: `563b3e108dc487a96c71a226499ebbb55cd5d365`.
- Parent runner blob: `4c58744381744451afa5f9617d9f5910128652b6`; retained exact parent source as `baseline.ts`.
- Reviewed `capture.ts` remains blob `555c71d140a36004200ac04ff66609eeb4458136`, SHA256 `42e34e0d310366b001fc6cd2951ff08ec7a52db7fbd33428757440a34b9a630d`.
- Shared capture lifecycle test remains blob `2e33cab7a3a3cdb8f929b51e45a7f894a09c6133`.
- Original supplied census is retained as `census-REPORT.md`. The TypeScript skill and its required type-system principle were read and applied. No repository AGENTS.md was present along the target path.

Exact commands and outputs are retained in the command JSONs, per-run JSONs, TAP/log files, source snapshots, and harness files in this directory. To reproduce the failing CLI safely, use the command/environment in `cli-44.json` with `REVIEW_TARGET` set to that record's `source`; the preload replaces the two resource boundaries. Baseline `cli-43.json` supplies the positive comparison. The artifact directory is sealed read-only; copy it to a writable temporary directory for reruns that generate new evidence.

No repository source edits, real Vite server, real browser, client playthrough, GPU/native/full-suite run, PR, push, main-branch action, merge, or Trunk operation occurred. The shared lifecycle suite used its existing mocked Vite/Playwright boundaries; its existing temporary port/output-file activity is part of that focused suite. Runtime acceptance remains pending regardless of the source lifecycle tests.

The verdict is **REVISE** for the CLI entry regression. The requested lifecycle ownership repair otherwise passes this bounded source/CPU review. `SHA256SUMS` and `SEAL.json` bind the report and retained evidence.
