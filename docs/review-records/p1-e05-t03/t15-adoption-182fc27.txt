TASK: P1.E05.T03 — reviewed T15 adoption and combined disabled packet bindings (Appendix C.2).

STATUS: Adoption and combined SOURCE/CPU checkpoint complete; fresh independent VM R2 is pending. Capture remains disabled at caller, entry, inventory and readiness. No native qualification or visual acceptance is claimed.

SUMMARY: Preserved clean checkpoint `58ae819f2e9d2a8d221e90f0fe808fde2683b010` (tree `f91c5f5402f206a9254563e54bffd970894cec8e`). Cherry-picked exact reviewed T15 commit `38b6c4b58db43146df20cd760808d1461d7a667b` with `-x` into separate adoption commit `dea07963a32227cc3eaecad86d128026350b9082` (tree `5e5edd95140c2154adaf3db571d32d249c60f3c7`). The entire full-index binary patch matches byte-for-byte: SHA256 `febb2614fabfd09894a46fa927b98c9201e8b9b2cc24899a683625e22eac2345`, stable patch-id `8e90cd71186b236a00402a6bd9b985256e9b5ec7`. No integration conflict or source correction was needed.

FILES: The adoption commit changes exactly `packages/tools/src/capture/capture.ts` and adds `capture.lifecycle.test.ts`. Their SHA256s remain `42e34e0d310366b001fc6cd2951ff08ec7a52db7fbd33428757440a34b9a630d` and `ca2453418de6c36ca88904410cd81be099cc8101c1d9d4f470ec782b73bf2b18`. The subsequent metadata commit changes only packet `readiness.json` and adds this report plus `evidence/t15-adoption/`. All existing packet source/tests, seven R1 fixes, reports and evidence are unchanged. The prior readiness is retained in Git and the new evidence archive. Neither shared file was edited after adoption.

VERIFY:

| Fresh combined check | Result |
| --- | --- |
| Exact committed shared lifecycle suite | 100 tests PASS, exit 0 |
| Packet caller/helper/revision boundaries | 22 tests PASS, exit 0 |
| Packet CPU decoder | 24 tests PASS, exit 0 |
| Existing packet Node controls | 18 tests PASS, exit 0 |
| Existing client runtime suite | 110 tests / 8 files PASS, exit 0 |
| Combined production error/receipt probe | 72 cases PASS, exit 0 |
| Same probe with original shared source | Expected RED: 54 of 72 cases fail; exit 1 |
| Four package TypeScript checks | PASS, exit 0 |
| Scoped ESLint / Prettier | PASS, exit 0 |
| Python AST syntax / diff check | PASS |
| Combined source, protected assets and binding audit | PASS, exit 0 |
| Refreshed readiness check | CPU_BINDINGS_ONLY, exit 0 |

Every requested suite was freshly executed; no prior test result substitutes for the combined run. T15's independent 325-assertion SOURCE PASS and 68-test original-source RED remain separately attributed historical evidence, copied verbatim from `/tmp/p1-e14-t15-independent-gzn1kbbe/REPORT.txt` (SHA256 `944f849660b40540f253612159f49f02c31083a83b178cbabee5171326591af9`). Its source bytes are exactly the adopted ones. No new independent review was launched; the parent owns the single combined VM R2.

The supplementary probe invokes actual `execute → productionCapture → captureReview`, with inert Playwright/Vite/net/tsx import ports and all child-process APIs prohibited during cases. It covers six operations (newPage, on, addInitScript, goto, waitForFunction, evaluate), all four browser/Vite cleanup-failure combinations, and durable/fallback/all-sinks receipts. Original frozen errors carry distinct byte payloads and unknown ownership facts. For simultaneous navigation/browser/Vite faults, the thrown AggregateError retains exact `[primary, browser, Vite]` object identity/order and `cause === primary`; the packet keeps the original primary and all secondary facts through serialization and publication. Its existing serializer records the repeated `errors[0]` reference as `[cycle]`; complete primary fields remain in `cause` and `record.primaryFailure`, while cleanup facts remain in the ordered error entries. All-sinks failure keeps its in-memory evidence and `durable:false`.

The probe separately records the unchanged packet fallback browser close after the shared browser-then-Vite cleanup. Shared ownership is independently exercised by the 100 real-export tests; no claim is made that inert traces prove native cohort release. The old-source replay supplies exact base capture bytes (SHA256 `3f95b7bf75c3c25819a9b7d7f94276afb9340f3a6fa9e41d4310817a585f7fdc`) at the original capture module identity without modifying a checkout file. Its 54 failed cases reproduce skipped Vite cleanup or replaced/lost work errors. Both complete case sets, original/secondary raw records and failure tail remain in the archive. This expected RED is the only nonzero product-control run. Staging the verbatim independent report also exposed its existing extra blank line at EOF (`git diff --cached --check`, exit 2); storing that copy as gzip preserves its exact decoded bytes and resolves the packaging whitespace failure. Its raw bytes remain in scratch and the archive.

Direct pinned Node 26.12.1, Vitest 5.0.5, Python 3.14.8, Python 3.10.22/Pillow 12.0.0, TypeScript 6.0.3, ESLint 10.13.0 and Prettier 3.9.10 were used. No package manager or installer ran. Vitest used at most two workers with no file parallelism; result and filesystem-module caches were disabled. Scratch config/cache/TMP paths and a write guard keep generated test files in scratch; dependency trees remain unchanged. The shared tests briefly bind and close the existing freePort loopback socket; browser and Vite application-server ports remain inert. Their image bytes are synthetic, and temporary fixture cleanup affects only their own directories.

Exact argv/cwd/environment/exits/durations/log SHA256s: `evidence/t15-adoption/commands.jsonl`; the RED source override is additionally explicit in `probe-source-overrides.json`. All CLI paths and scratch launchers are retained in `cpu-evidence.tar.gz`. Commands include direct shared/client Vitest runs, `python-controls.py`, pinned `unittest discover ... test_inspect.py`, Node `--test --test-concurrency=1`, all four direct `tsc -p` invocations, scoped static checks, `audit_combined.py`, and caller `--prepare` / `--check`. `failure-tails.json` preserves the RED tail. Python modules were parsed without bytecode writes.

DECISIONS: Generate fresh readiness once for the adopted source, then add provenance naming the original reviewed commit, exact adoption commit/tree, review/patch hashes and both shared files. Current readiness SHA256 is `4926852df1adfb8f1afe0a1e2592415eba9e2942771f1e69ff3edf8abcfa93de`. New source digest is `cfd22c5cf2d6736cce266f26f39b1c0bd76e04f1eb292915aed12791fa40d0d4`. Its 12,921 tracked source entries include the new lifecycle test; replacing only capture.ts with its old hash and omitting only that test reconstructs the prior digest exactly (`95303b16dc1256f91b8df979fdf4915a6d5bfae780a0f95bbdab952ea5ee7d8b`). The authenticated binding logic itself is unchanged. The legacy `bindings.reviewedSource` continues to identify the accepted runtime/art SOURCE R3 anchor; explicit `sourceProvenance` records T15 adoption and pending combined VM R2. The final metadata-commit HEAD/tree are recorded by the post-commit handoff rather than self-referential committed metadata. A future external grant must bind that exact final HEAD.

The dependency/browser/Pillow trees, launcher paths, actual self-observed Python kernel executable, process-binary hashes and ignored-file inventory remain equal to the prior pin. Node_modules tree SHA256 remains `c9ca9b99ea32b544e006174013458c83feb842f339634b4746d694f236e681dc`; ignored inventory SHA256 remains `2fde53955b2b8855c9cae24565e0ba0c300667c203f4001e2ae2d56b0d58f552`. Cache-owner probes are clear. All 31 prospective paths remain absent (29 distinct per-unit paths plus two containers); both gates are false. Existing grants, native allocations and capture outputs remain absent.

Protected byte audit: 6 accepted bodies, 6 viewmodel sources/exports, 6 prior previews, 745 accepted review files, 59 retained runtime/source-revision files, all four recovered helpers and historical reports match the previous manifest. `combined-freeze.json` contains exact hashes and all prior packet identities. The original broad R3 audit script is preserved unchanged; the new combined audit proves the sole approved shared-source delta instead of pretending that T15 was part of the old R3 tree.

Payload inventory and reserve ledger are byte-identical (inventory SHA256 `98958acf95dfdd56eba3b9f86172498f4f60b8d38993046dd4d17d863f1263ae`): seven units, 101 files = 94 PNGs + seven readouts. Three copies; 16 MiB per PNG; 32 KiB full-view readouts, 16 KiB other readouts. Admission remains `3 * outputCap + 4,848,615,424`; capture/cleanup/decode/cache-copy deadlines remain 600/60/45/30 seconds. These are observed reserve ceilings, not OS quotas. Standard viewmodel far100, truthful requestedLOD2/selectedLOD0, authored material/texture admission and Muzzle-only overlay contracts are unchanged.

| Unit | Files / PNGs | Output cap B | Admission B |
| --- | ---: | ---: | ---: |
| review-thalune | 12 / 11 | 184,565,760 | 5,402,312,704 |
| review-ixari | 12 / 11 | 184,565,760 | 5,402,312,704 |
| review-ulgani | 12 / 11 | 184,565,760 | 5,402,312,704 |
| view-thalune | 19 / 18 | 302,022,656 | 5,754,683,392 |
| view-ixari | 21 / 20 | 335,577,088 | 5,855,346,688 |
| view-ulgani | 21 / 20 | 335,577,088 | 5,855,346,688 |
| return-thalune | 4 / 3 | 50,348,032 | 4,999,659,520 |

OUT OF SCOPE: Fresh independent combined VM R2, native slot/grant execution, GPU/visual acceptance and T04 animation integration remain pending. No real browser/GPU/StationJob/codec executable/Blender/application server/DB, native screenshot, existing-capture cleanup, push, PR or merge occurred. No permission request or new native hold was introduced.

ARTIFACTS: Exclusive scratch `/private/tmp/vm-t15-adopt-9p6j5wtk` remains intact. Committed evidence archive: 2,249,908 B, SHA256 `04aff9bfe9eae249d4c9596c3e85d67b7c15d87ee17a205a3782011423ab11df`; all 187 regular-file bodies were read back and hash-verified, with three nonregular identities recorded without following/opening them. Source closure is retained as `source-closure.json.gz`; decoded SHA256 `a9830e21372767dd5e867c344aa3f4163a25752d2bba907bae9d36645f154dfd`. Existing reviewer/failure history was not overwritten. No new native screenshot or preview path exists. The next inventory remains the seven disabled units above.

| Unchanged viewmodel source/export | SHA256 |
| --- | --- |
| `assets/blend/characters/viewmodels/fp_thalune.blend` | `46d483c8cc0b10f555dc35f60008d64f7b883d392daa4bf4e87abb91da97b1db` |
| `packages/client/public/models/characters/viewmodels/fp_thalune.glb` | `b4859735bd2f203bd30ca41705a156858cc362dd6de1000d308bd1e12b53e76f` |
| `assets/blend/characters/viewmodels/fp_ixari.blend` | `44c408a64b59353810119640471b2faf9506da57250bdb47e7ce067445f2c4b5` |
| `packages/client/public/models/characters/viewmodels/fp_ixari.glb` | `78f90acfc0087b63e97c3ae50cb7c1f5e045e447e12975b6ec21a0dd5f038abc` |
| `assets/blend/characters/viewmodels/fp_ulgani.blend` | `aabb32cb139c544d7a57f2fe22c34931fe720d2215e02936876f2dd02dd1aa3b` |
| `packages/client/public/models/characters/viewmodels/fp_ulgani.glb` | `8319097e97e3ccf2f9fdcbbe114742ea45f1f24eb8ba98420f12678d3511e954` |
