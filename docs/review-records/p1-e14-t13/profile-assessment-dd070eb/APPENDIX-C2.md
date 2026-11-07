# Appendix C.2 — T13 profile-subtree removal reachability assessment

The reported effects writer failure was **not reproduced in current T13** within the actual CPU boundaries tested. No source correction, commit, rebind or new freeze was made. This is a bounded source/CPU assessment, not native qualification or an independent review grade.

## Exact preserved pin

- Worktree /Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8; branch codex/task/P1-E14-T13-trace-observer.
- Initial and final HEAD dd070eb0233e242eed6ec4e62d5d7f8857d6dc21; tree 55425ed6c5d0fed5d0b04cbec30dca2c3bd0692c; clean before and after; no changed files.
- Current disabled readiness /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/frozen-dd070eb02/readiness.json; SHA256 ef0311ecabde0d5ec187fdb2f938933bcb80b44ad199abe055d73516c48bd359.
- Binding SHA2563172f65d4b58dc4e67a525156f76a7af3212d4435152ded107601d9cfdf48fcb, equal to the frozen binding. Both runtime flags remainfalse. All161689e0 prospective enabled-readiness/grant/consumption/output/fallback paths remain absent.
- preservation-and-pins.json records exact unchanged SHA256 for metadata/launch/current controls/binding, all four retained helpers, T15 capture/openReview, browser-work probe/trace/report and Review. No product, renderer, assets, history, authoring or orchestration documents were edited. Existing dd070eb02 frozen closure and previous reports were not rebuilt or modified.

## Cross-lane evidence read, without reclassifying it

Read /private/tmp/egp-164a9dca1cd5400c8f734587e449adeb/result.json through the actual **effects_packet.evidence.capture_snapshot** body from source4795d01fa0098d0b29310124fdeee06fd5fa4e24. Only exact evidence.py and contract.py were copied into this exclusive evidence directory for the read-only reader; their Git source/SHA256 are in effects-reader-provenance.json. This imports no native helper or service. Four bounded authenticated parts decode1654565 bytes; outer result SHA256291b242d830b1de6e883b51d57abe4de3b4ae442d0b4973ce57620a835c02f6e, decoded record SHA256e9beb46528d1f3111eac8bb79c4d704d16375c83a526e5b4eba83d96709add6f.

The decoded result retains the writers/capture-observer FileNotFoundError for /private/tmp/sbr-_lymht1r/playwright_chromiumdev_profile-NQNsQB/Default/Shared Dictionary, plus HelperWorkFailure because clean:false. Parent terminal audit records exit1 after47.95025125000393 seconds despite11 images and entryChecksPassed:true, with kernel absent/live0, namespace/scratch/registration absent and fresh parent release at11:23:47.204225Z. That native attempt remains FAIL/SPENT; physical release does not change work acceptance. The decoded copy is effects-result-decoded.json; all original segmented receipts and parent data remain unchanged.

Effects at4795d01 uses native_ports.tree_bytes for live profile/private-TMP/helper roots: it collects Path.rglob paths then lstats them. Its special live-cache handling applies only to cacheBytes, so subtree removal after path enumeration can raise at p.lstat. This source distinction was inspected from exact Git bytes; no effects source was edited or repaired here.

T13 atdd070eb02 instead calls ledger(hash_files=False,live=True) for every active root (frozen runtime, scratch, output and private TMP), which dispatches to sample_inventory. It uses held no-follow directory descriptors, records vanished enumerated children and always returns complete:false for a successful live interval. Its outer private-TMP/ancestor boundary and settled inventory/hash/copy remain strict. The assessment tests that actual path rather than assuming cross-lane equivalence.

## Premise and deterministic actual filesystem tests

premise.txt was written before tests. No product edits followed because the purported strict-live traversal is not the current T13 path.

The fixture reproduces the profile shape private-tmp/playwright_chromiumdev_profile-fixture/Default/Shared Dictionary with two tiny cache files. One bounded writer thread performs actual shutil.rmtree or rename, synchronized by events at real stat/open/scandir/fstat boundaries. No sleeps, browser, codec, native service, renderer or fabricated successful ledger replaces those operations. Each case has an8-second deadline and64-entry/4096-byte limits. Descriptor stamps/nlink observations and exact returned samples/errors are retained in sampler-windows/results.json.

Nine legitimate transitions complete the live sample without failing work:

1. Deletion after enumeration, before child stat.
2. Deletion after the child stat, before opening it.
3. Deletion immediately after opening the subtree directory.
4. Deletion before scandir on its held descriptor.
5. Deletion during scandir iteration.
6. Deletion after scandir closes, before child path lookups.
7. Deletion before the final held-descriptor fstat.
8. Rename of the held subtree.
9. Removal of the entire browser profile while the subtree descriptor is held.

On this macOS host, the held directory descriptor remains usable after subtree removal; no ordinary removal-induced scandir error was observed. Disappeared child path lookups are recorded as transitions. All successful samples remain complete:false/sampleComplete:true, with no content-read or quota/completeness claim. This establishes these actual windows, not a universal absence of every possible filesystem race.

Two negative neighbors remain fatal: deletion of the caller-owned private-TMP root itself (ancestor verification), and an injected EIO enumeration failure carrying unknown raw bytes. No arbitrary IOError was ignored and no unknown observation became complete.

The same11 mutations/errors were then replayed through strict settled traversal, ledger(hash_files=False,live=False). **All11 were refused**, including the formerly tolerated live transitions. strict-windows/results.json retains the exact failures. No strict algorithm or acceptance rule changed.

## Actual whole-observer/controller reachability

Nine additional replays execute the current launch.run_owned/observe_body, sampler, retained StageReceipts and StationJob wait/drain/archive/audit bodies. Native/kernel/process ports are inert; subprocess creation and os.kill are explicitly trapped. The tests use real owned fixture directories and writer operations at the real private-TMP ledger call. No native or harmless subprocess is dispatched by these controller fixtures.

Eight cases cover the subtree windows above (stat/open/scandir/iteration/exit/final-fstat and rename). The ninth removes the complete profile on the second observation, after actual StageReceipts previously admitted the inert browser member. Its ports then report that browser member ended before close; the existing retained profile/identity logic handles the transition. This is a lifecycle fixture, not proof of a real browser exit.

All nine driver exits0 and all actual fixture controller results reach candidate:true/DRAINED_ARCHIVED_AUDITED with complete settled frozen/output ledgers. Every live resource sample remains complete:false. The profile-close fixture records two private samples and browserClosedInPort:true. Raw results, before-drain facts, sample summaries and deletion observations are preserved beneath controller2-*/. These inert candidates are not native acceptance or timing results.

The first external controller harness exceeded Python's static nested-with limit after adding two native traps to the existing context list; it failed at parse time, before running product code. Its script is preserved as controller-replay-v1.py and its original stdout/stderr remain. The corrected isolated harness places the traps outside that context list, then all nine cases pass. No product edit or bug fix was made to obtain those results.

## Relevant existing safety controls

The existing11 live_controls tests and7 boundary_controls tests also exit0. They cover count/byte/link-growth ceilings, zero-size sampling versus subsequent growth refusal, strict hashing/copy mismatch, symlink/FIFO metadata-only behavior, root/ancestor substitution, unknown EIO facts, held rename, actual deadline interruption, descriptor closure, secondary close failure, exact admitted stamps and aggregate read/copy limits. The broad58/632/64/T15 results are not rerun or counted as new evidence. No build, full suite, TypeScript typecheck or format change is needed for this no-edit assessment.

New runs:11 sampler cases (9 ordinary transitions plus2 negative neighbors),9 whole-controller replays,11 strict refusal counterparts,11 existing live tests and7 existing boundary tests. All intended assertions exit0. At most2 small CPU execution contexts (reader/writer) are active, with bounded waits and no background work left running.

## Preservation and handoff

Original effects packet:144 records/13260472 bytes; parent evidence:12 records/272670 bytes. Exact ledger bytes/hashes/stamps before and after are equal; effects-preservation-before.json and preservation-and-pins.json hold the proof. Screenshots were not viewed, changed, regenerated or deleted. All original spent reports, namespaces and previous T13 artifacts remain untouched; only new fixture-owned paths are created/settled by these tests.

commands.jsonl and commands.md contain exact argv/cwd/times/exits; named stdout/stderr, scripts, source reader provenance, returned ledgers/controller packets and artifact hashes are retained here. No source or binding change was justified by the reproduced evidence, so HEAD is preserved exactly as requested. No new freeze or grant was issued. Existing final launch proposal remains /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/NEXT_LAUNCH.json; this assessment does not authorize running it.

Fresh parent-owned independent review remains required before a native attempt. Existing one-use grant, exact source/readiness pins, capacity/load/GPU reservation, observed device/host/work, physical settlement and parent-observed OS exit0 plus hashes remain required. No native retry, browser/GPU/Blender/codec/service/DB, install, hydration, heavy-work release, screenshot cleanup, push/PR/merge or orchestration-doc write occurred. Whole T13 timing remains inconclusive and cloud03 remains FAILED/accepted:false.
