# Appendix C.2 — P1.E05.T03 combined VMR2 corrections

**TASK** P1.E05.T03, three SOURCE/CPU combined VMR2 findings. Branch `task/P1-E05-T03`, checkout `/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8`.

**STATUS** Owned corrections implemented and CPU controls PASS. Independent combined VMR3 is required. Native execution, GPU/Metal release, image meaning, blind visual grade and full T03 completion remain unqualified. Both source gates, inventory gates and readiness gates remain false. All 31 prospective paths remain absent; no grant is created.

**SUMMARY**

- R2-1: cyclic/shared Python facts use bounded encounter-ordered graph nodes and typed edges. Unknown fields and non-UTF8/NUL bytes survive JSON with stable back-references. The original callback exception remains separate from encoding faults; the capture handler selects the original without serializing it before mandatory owned drain. Helper receipt/encoder faults cannot bypass the drain attempt. Unencodable originals remain in memory, with explicit failure facts. Ordinary callback, helper-save and cleanup errors remain separate; actual SIGALRM stops later dispatch.
- R2-2: the task-local entry stores first-failure presence independently of its value. Undefined, null, false, zero and empty-string failures stay distinct. Cleanup is attempted before fallible serialization. Shared AggregateError primary/cause/ordered cleanup identities remain intact; reversible graph facts replace the old lossy `[cycle]` placeholder. Undefined and non-JSON numeric values are tagged. A serialization failure refuses durable publication and retains its original and encoding error in memory. The shared T15 implementation is unchanged.
- R2-3: switch-settled now reconciles with its immediately preceding same-aspect switch-gap: at least 24 updates and 0.4 elapsed, whole fixed-step elapsed increments, elapsed no greater than updates/60, final dt=1/60. Existing extra settling/cooling and zero-dt resets remain valid. The fixture and runtime remain byte-identical, including one render per pose and truthful half-pose fields.

**FILES** Only `packages/tools/src/capture/viewmodel_packet/` changes. Runtime paths changed: boundary.py, native.py, caller.py, entry.mjs, inspect_packet.py. Focused controls changed/added: test_revision.py, test_r2.py, entry.test.mjs, publication.test.mjs, test_inspect.py. Readiness refreshed once after final code. This report and exclusive `evidence/combined-r2-corrections/` preserve provenance and raw CPU evidence. No common capture/helper/runtime/asset/source-export validator change.

**VERIFY**

| Check | Result |
|---|---|
| Exact copied-base cyclic callback RED | exit 0 defect assertion: KeyError and no drain; acyclic control drains |
| Exact copied-base falsy production-export RED | 36 cases, 9 missing Vite failures, 2 omitted undefined durable primaries; exit 0 defect assertion |
| Exact copied-base decoder RED | 9 retained invalid packets accepted; all 30 new adverse counterexamples accepted; regression wrapper exit 1 |
| Candidate same callback replay | cyclic and acyclic both retain original facts and attempt inert drain; exit 0 |
| Python caller/helper/cache/revision | original 22 + new 4 = 26 PASS; actual callback, failed helper save, injected encoder failure, SIGALRM, actual authenticated temporary-Git caller and all publication outcomes |
| Decoder | original 24 + new 2 = 26 PASS; prior method ASTs unchanged; 9 retained adverse packets reject, 3 valid controls pass |
| Node packet | original 18 + new 4 = 22 PASS; new actual-export test contains 42 receipt scenarios |
| Actual entry/shared capture combined | 72 cases PASS; historical probe copied into fresh evidence and assertion decoding adapted from lossy cycle marker to reversible identities |
| Shared T15 lifecycle | 100 PASS, source/test unchanged |
| Client focused | 8 files / 110 PASS |
| Actual caller process chain | seven exits 0, inventories 12/12/12/19/21/21/4 = 101; same temporary Git HEAD |
| Publication/interruption neighbors | success / after-result-write / after-return / release-unproved / all-sinks exits 0/1/1/1/1; only success admits successor |
| Static | shared/client/server/tools typecheck exit 0; scoped ESLint and Prettier exit 0; all packet Python ASTs parse; diff check clean |
| Final readiness | actual caller --check exit 0, CPU_BINDINGS_ONLY; no prepare repeat |

Python total is 52 tests across parent and delegated decoder lanes. Decoder's 187 CLI invocations overlap its 26-test suite and RED/GREEN replays; they are not added to the unit-test total. Node's 42 and combined 72 are scenario counts, separate from its 22 test methods. Decoder validation is reused from this revision's completed child with exact unchanged inspector/test hashes and unchanged Pillow tree; no older decoder pass substitutes for this fix. The prior independent R1/R2/shared reviews remain historical.

All native browser/kernel/command/ownership ports are inert in these controls. Actual helper bodies, shared captureReview, caller admission/persistence, Git/process exits and PNG/Pillow decoding run where stated. Synthetic PNGs do not prove rendering or image quality. All test workers are serial in each lane, at most two lanes; Node is the frozen direct 26.12.1 executable. No implicit package manager/install or shared cache write.

**DECISIONS**

`rawGraph:1` facts have `root` and encounter-ordered `nodes`. Graph edges are `{ref:index}` or `{value:scalar}`; container node kinds and dictionary/property entries distinguish user keys from graph references. Byte nodes retain exact base64 and byte lengths. Normal acyclic receipts retain their prior shape. Python caps raw traversal at 20 MiB / 100,000 nodes / depth 128; JS at 2 MiB / 16,384 nodes / depth 128, with final encoded-size checks and existing publication ceilings unchanged. Over-budget/unencodable evidence fails closed without truncating originals in memory. Failure graph envelopes are evidence, never proof of successful completion or successor eligibility.

Retained shared T15 commit 38b6c4b58db43146df20cd760808d1461d7a667b and separate adoption dea07963a32227cc3eaecad86d128026350b9082 remain unchanged. Effects 587989a's independent undefined-tag lesson was inspected read-only; no effects source was copied or edited. No method-interposition expansion hides shared cleanup faults.

**OUT OF SCOPE** No GPU/native/browser/Blender/codec/server/DB launch, grants, screenshots, screenshot cleanup, T04 integration, orchestration edits, new animation clips, source regeneration, main/push/PR/merge or Trunk submission. There is no user permission question pending. Parent owns fresh R3 and any later native authorization.

**ARTIFACTS AND EXACT PROVENANCE**

Base `182fc27d1a5459270e2a3c4673f8e70b86ef3a33`, tree `546f57bc68c5a19f8144ae2ccd205a368bd9982f`. Final HEAD/tree are recorded after commit in the exclusive `/private/tmp/vm-r2-fix-pern8y1v/POST-COMMIT.json` and final C.2 handoff, avoiding a self-referential committed hash.

Readiness SHA256 `5fce0c71acefc438afc780d3862667a1777d73fb08d0d780093606b00de3e345`. Non-packet source digest remains `cfd22c5cf2d6736cce266f26f39b1c0bd76e04f1eb292915aed12791fa40d0d4`. Inventory SHA256 `98958acf95dfdd56eba3b9f86172498f4f60b8d38993046dd4d17d863f1263ae`. Protected manifest SHA256 `09d67b371caa811a47c621d0131870d9541dd2e288315e59a7c4d8416fb19b4e`. All 822 protected files match: 6 accepted bodies, 6 viewmodel source/exports, 6 previews, 745 accepted review files and 59 runtime/source-history files; the four helpers and historical reports match too. The independent R2 tracked-file inventory verifies every earlier tracked byte outside the eight intended source/test edits (then readiness alone), including all prior packet reports/archives.

Payload/reserves are unchanged: 101 files = 94 PNGs + 7 readouts, three copies, fixed reserve 4,848,615,424 B. Output/admission per unit:

- review-thalune: 12 files; 184565760 / 5402312704 B.
- review-ixari: 12 files; 184565760 / 5402312704 B.
- review-ulgani: 12 files; 184565760 / 5402312704 B.
- view-thalune: 19 files; 302022656 / 5754683392 B.
- view-ixari: 21 files; 335577088 / 5855346688 B.
- view-ulgani: 21 files; 335577088 / 5855346688 B.
- return-thalune: 4 files; 50348032 / 4999659520 B.

PNG cap 16 MiB, full-view readout 32 KiB, others 16 KiB; deadlines 600/60/45/30 seconds. These are observed native reserve ceilings, not OS quotas.

accepted_bodies SHA256:

- `assets/blend/characters/thalune.blend` — `d1fc6986ad5fc164279e12a299aa6bc62b499084a6e8afee1b87315832c8d74b`
- `packages/client/public/models/characters/thalune.glb` — `dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27`
- `assets/blend/characters/ixari.blend` — `9779f0a9dc8b3a69257124bb962b0e51c526f9b80501d35833c02674e3fa2f0c`
- `packages/client/public/models/characters/ixari.glb` — `1236d2bafed2d8a2c58eeb4ba6cf73501c669fbc7d7eda5d1fb3c260d34d243b`
- `assets/blend/characters/ulgani.blend` — `06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b`
- `packages/client/public/models/characters/ulgani.glb` — `9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682`
viewmodels SHA256:

- `assets/blend/characters/viewmodels/fp_thalune.blend` — `46d483c8cc0b10f555dc35f60008d64f7b883d392daa4bf4e87abb91da97b1db`
- `packages/client/public/models/characters/viewmodels/fp_thalune.glb` — `b4859735bd2f203bd30ca41705a156858cc362dd6de1000d308bd1e12b53e76f`
- `assets/blend/characters/viewmodels/fp_ixari.blend` — `44c408a64b59353810119640471b2faf9506da57250bdb47e7ce067445f2c4b5`
- `packages/client/public/models/characters/viewmodels/fp_ixari.glb` — `78f90acfc0087b63e97c3ae50cb7c1f5e045e447e12975b6ec21a0dd5f038abc`
- `assets/blend/characters/viewmodels/fp_ulgani.blend` — `aabb32cb139c544d7a57f2fe22c34931fe720d2215e02936876f2dd02dd1aa3b`
- `packages/client/public/models/characters/viewmodels/fp_ulgani.glb` — `8319097e97e3ccf2f9fdcbbe114742ea45f1f24eb8ba98420f12678d3511e954`

Shared capture.ts SHA256 `42e34e0d310366b001fc6cd2951ff08ec7a52db7fbd33428757440a34b9a630d`; lifecycle test `ca2453418de6c36ca88904410cd81be099cc8101c1d9d4f470ec782b73bf2b18`. Exact patch parity remains `febb2614fabfd09894a46fa927b98c9201e8b9b2cc24899a683625e22eac2345`.

Dependency tree `/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/node_modules` — `c9ca9b99ea32b544e006174013458c83feb842f339634b4746d694f236e681dc` (12848 files, 288634535 B).

Dependency tree `/Users/andreyyurlov/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64` — `5fb8dcd8d2606ed66b09d4e545ba7f264b0bb2bb129022db4369de534b2a9645` (16 files, 213060105 B).

Dependency tree `/Users/andreyyurlov/.cache/uv/archive-v0/a88MR2jSm399x3XK/lib/python3.10/site-packages/PIL` — `6addcbac6ae4bd93ca6cfe79295d32b2d30662040f466ca4f554057df33a8b1c` (132 files, 13076627 B).

Ignored inventory remains `2fde53955b2b8855c9cae24565e0ba0c300667c203f4001e2ae2d56b0d58f552`. The prior review's exactly one 8,213-byte ignored Vitest module-cache file was moved by that reviewer into its evidence; this history remains disclosed and unchanged. Fresh baseline/final complete binding checks match. No foreign restoration occurred.

Raw evidence root `/private/tmp/vm-r2-fix-pern8y1v`. Archive `cpu-evidence.tar.gz`: 7789157 B, SHA256 `1995fb9a5d4a2799903048d42129d8f6d391f543a9d4168fcf876bf543c9b49c`. Readback verified all 5974 regular bodies (873731391 logical B); 10 symlink/FIFO identities recorded without opening/following, directories recorded separately. Original scratch retained. The active archive log is excluded from its own snapshot; its final command/exit/hash is in commands.jsonl. `freeze.json.gz` includes all earlier tracked and protected hashes; archive preserves exact reproducers, copied originals, failures, raw partials and synthetic full packets. No screenshots/previews were generated; next GPU inventory remains the same seven disabled units.

**Retained failed attempts and failure tails**

- `baseline` exit 1, log SHA256 `5448b59995a1e29f0780faa74d479d2c1e8ac606eb9c2a9263a2e5b380c88b21`.

```text
Traceback (most recent call last):
  File "/private/tmp/vm-r2-fix-pern8y1v/baseline.py", line 6, in <module>
    r=json.loads((P/'readiness.json').read_text()); bindings.check(r['bindings']); print('BASELINE_BINDINGS_PASS')
                                                    ^^^^^^^^^^^^^^
AttributeError: module 'bindings' has no attribute 'check'
```

- `red-falsy` exit 1, log SHA256 `0824094dda788e920540ae73d5289c641293bdce0db5e7d37ce6610721e46f2c`.

```text
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

- `r2-python-first` exit 1, log SHA256 `304b4de607f783a6a327a040701e15a7b03c66bbe15c3d5c64f4b14597ea44c8`.

```text
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/test_revision.py", line 109, in adapter
    self.assertFalse(record['native']['released'])
                     ~~~~~~^^^^^^^^^^
KeyError: 'native'

----------------------------------------------------------------------
Ran 8 tests in 0.109s

FAILED (errors=3)
```

- `r2-node-first` exit 1, log SHA256 `7c59fc4d98a5f2c2d344ac8f91e10b926b4019df8dd58bf9f898987084736e8b`.

```text
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: { type: 'undefined' },
    expected: { type: 'undefined' },
    operator: 'strictEqual',
    diff: 'simple'
  }
```

- `lint` exit 1, log SHA256 `9f6d781e1d732de82a6ffad9a0041864853af321547f14861fdf935f8e5911dc`.

```text

/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/publication.test.mjs
  222:5  error  'console' is not defined  no-undef

✖ 1 problem (1 error, 0 warnings)

```

Baseline initially called a nonexistent check method; corrected to the actual caller --check. First copied JS replay lacked two retained TS import files and stopped before navigation; exact files were copied and its 36-case RED succeeded. New Python caller harness initially denied its own scratch Git commands; explicit Git-only ports corrected that harness. New JS graph test initially compared two undefined scalar tags by object identity; corrected to value equality. Scoped lint initially lacked the test console global declaration; corrected. All failures remain in the archive. The decoder report separately preserves its reporting-classifier attempt and the intentional 30-case old-source RED.

**Exact verification commands and exits**

`baseline` exit **1**, 0.090s; log SHA256 `5448b59995a1e29f0780faa74d479d2c1e8ac606eb9c2a9263a2e5b380c88b21`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/baseline.py
```

`red-native` exit **0**, 0.417s; log SHA256 `92d9f88c8526cb35d2f61d26ae5ebc9f1fc38632bee7420da9de8225cc24d28e`.

```sh
/usr/bin/sandbox-exec -f /private/tmp/vm-r2-fix-pern8y1v/readonly.sb /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/red/native-unknown.py
```

`red-falsy` exit **1**, 0.216s; log SHA256 `0824094dda788e920540ae73d5289c641293bdce0db5e7d37ce6610721e46f2c`.

```sh
/usr/bin/sandbox-exec -f /private/tmp/vm-r2-fix-pern8y1v/readonly.sb /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --import /private/tmp/vm-r2-fix-pern8y1v/fs-guard.mjs --test --test-concurrency=1 /private/tmp/vm-r2-fix-pern8y1v/red/falsy-probe.mjs
```

`red-falsy-v2` exit **0**, 0.131s; log SHA256 `282376089928b4c1b83cb70f52722312cb76a778697d748a0ee1d201d9d8657e`.

```sh
/usr/bin/sandbox-exec -f /private/tmp/vm-r2-fix-pern8y1v/readonly.sb /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --import /private/tmp/vm-r2-fix-pern8y1v/fs-guard.mjs --test --test-concurrency=1 /private/tmp/vm-r2-fix-pern8y1v/red/falsy-probe-v2.mjs
```

`baseline-v2` exit **0**, 10.614s; log SHA256 `40e6284baaa5aef7a43fbf53c6870e038ee0e7304b457c2e9a72adfa71f4babb`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/baseline-v2.py
```

`python-first` exit **0**, 6.109s; log SHA256 `724beece8b33ac7fc817b0d01ac821a951ad9d04eb666a2a367347b27e95f0eb`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/python-controls.py
```

`node-first` exit **0**, 0.413s; log SHA256 `89b0cffb5013feb3483b53e7cd9cbecdfd7fe4e497cd676f63b4f0d8b8a53fad`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --import /private/tmp/vm-r2-fix-pern8y1v/fs-guard.mjs --test --test-concurrency=1 packages/tools/src/capture/viewmodel_packet/entry.test.mjs packages/tools/src/capture/viewmodel_packet/fixture.test.mjs packages/tools/src/capture/viewmodel_packet/production.test.mjs
```

`r2-python-first` exit **1**, 0.246s; log SHA256 `304b4de607f783a6a327a040701e15a7b03c66bbe15c3d5c64f4b14597ea44c8`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B -m unittest discover -s packages/tools/src/capture/viewmodel_packet -p test_r2.py -v
```

`r2-python-second` exit **0**, 0.493s; log SHA256 `19863c123d1eacafbe9958912dacaf5f7916208dcca6160cc8568cc2477206f2`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B -m unittest discover -s packages/tools/src/capture/viewmodel_packet -p test_r2.py -v
```

`r2-node-first` exit **1**, 0.430s; log SHA256 `7c59fc4d98a5f2c2d344ac8f91e10b926b4019df8dd58bf9f898987084736e8b`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --import /private/tmp/vm-r2-fix-pern8y1v/fs-guard.mjs --test --test-concurrency=1 packages/tools/src/capture/viewmodel_packet/entry.test.mjs packages/tools/src/capture/viewmodel_packet/publication.test.mjs
```

`r2-node-second` exit **0**, 0.462s; log SHA256 `56b789df96a24dec374f3e4ce8276f1f3f25a188e67749458940e344709427c4`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --import /private/tmp/vm-r2-fix-pern8y1v/fs-guard.mjs --test --test-concurrency=1 packages/tools/src/capture/viewmodel_packet/entry.test.mjs packages/tools/src/capture/viewmodel_packet/publication.test.mjs
```

`r2-python-final` exit **0**, 0.480s; log SHA256 `c26668109f05dbdd623673252ad4782a68328defea7ed1ea12fd9107fda27427`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B -m unittest discover -s packages/tools/src/capture/viewmodel_packet -p test_r2.py -v
```

`green-native-replay` exit **0**, 0.134s; log SHA256 `559341e3e98d4dc2d0208dca190300723bc0a0b8701ba990f00080dd83cd454c`.

```sh
/usr/bin/sandbox-exec -f /private/tmp/vm-r2-fix-pern8y1v/readonly.sb /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/green/native-unknown.py
```

`combined-green` exit **0**, 0.137s; log SHA256 `17c27db4ea2d4d48dcaf5ec7773e3207be28faa8914684f10439bc0d65206d2b`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --import /private/tmp/vm-r2-fix-pern8y1v/fs-guard.mjs --test --test-concurrency=1 /private/tmp/vm-r2-fix-pern8y1v/combined-graph-probe.mjs
```

`python-stock-final` exit **0**, 5.458s; log SHA256 `bcb686d870dd08bd5f64af131581f2ffa8803f595f605d516a3739b0fdb0ce34`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/python-controls.py
```

`node-final` exit **0**, 0.573s; log SHA256 `5c296817cc56607aa6ef44d65f6ee0a931169938638fbb1da84593cab09f8889`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --test --test-concurrency=1 /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/entry.test.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/fixture.test.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/production.test.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/publication.test.mjs
```

`process-boundaries` exit **0**, 1.817s; log SHA256 `d40235f1bfea5303da9983fabce4c5bacc0b0c153fd48a041bebed7f5d107733`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/process-boundaries.py
```

`shared-lifecycle` exit **0**, 0.753s; log SHA256 `5fc52e155e558adc2149b65472be86e5e53c5828c3fd41f3933d8509340a9495`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/vitest/vitest.mjs run --config /private/tmp/vm-r2-fix-pern8y1v/tools.config.mjs --configLoader native --maxWorkers 1 --no-fileParallelism --no-cache --no-fsModuleCache --fsModuleCachePath /private/tmp/vm-r2-fix-pern8y1v/shared-module-cache src/capture/capture.lifecycle.test.ts
```

`client-runtime` exit **0**, 12.541s; log SHA256 `23cb62847d0c013a486781f9bb88b5c3d3811808582c9fa3798fa74b94917031`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/vitest/vitest.mjs run --config /private/tmp/vm-r2-fix-pern8y1v/client.config.mjs --configLoader native --maxWorkers 1 --no-fileParallelism --no-cache --no-fsModuleCache --fsModuleCachePath /private/tmp/vm-r2-fix-pern8y1v/client-module-cache src/entities src/exosuit.test.js src/Game.test.js
```

`typecheck` exit **0**, 10.019s; log SHA256 `f696d7af280bcbd35defaa68f4556cd9a378ae536476a727dec7bdfec4985575`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/typechecks.py
```

`lint` exit **1**, 0.734s; log SHA256 `9f6d781e1d732de82a6ffad9a0041864853af321547f14861fdf935f8e5911dc`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/.pnpm/eslint@10.13.0/node_modules/eslint/bin/eslint.js /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/entry.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/entry.test.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/fixture.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/resolve.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/publication.test.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/fixture.test.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet/production.test.mjs
```

`lint-final` exit **0**, 0.476s; log SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/.pnpm/eslint@10.13.0/node_modules/eslint/bin/eslint.js packages/tools/src/capture/viewmodel_packet/entry.mjs packages/tools/src/capture/viewmodel_packet/entry.test.mjs packages/tools/src/capture/viewmodel_packet/publication.test.mjs
```

`format-final` exit **0**, 0.186s; log SHA256 `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20`.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/.pnpm/prettier@3.9.10/node_modules/prettier/bin/prettier.cjs --check packages/tools/src/capture/viewmodel_packet/entry.mjs packages/tools/src/capture/viewmodel_packet/entry.test.mjs packages/tools/src/capture/viewmodel_packet/publication.test.mjs
```

`freeze` exit **0**, 16.982s; log SHA256 `d4ed2b85668708f8baa540e5d840c9ae1499286fab9f04486700fd00515d5674`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/freeze.py
```

`final-check` exit **0**, 11.174s; log SHA256 `40e6284baaa5aef7a43fbf53c6870e038ee0e7304b457c2e9a72adfa71f4babb`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/final-check.py
```

`archive` exit **0**, 2.907s; log SHA256 `c193eb21a71001df2c2feab846ee07bd8d3922f7e7b2c46988d9e30458edb19a`.

```sh
/opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/vm-r2-fix-pern8y1v/package_evidence.py
```

All commands ran from the named checkout. commands.jsonl records exact per-command environment (private TMPDIR, no bytecode/Node compile cache, scratch write guard where applicable). The decoder report records its full seven serial harness commands, 187 CLI argv/exit logs and exact pinned Python/Pillow paths. The raw archive includes complete stdout/stderr, not just the tails above.
