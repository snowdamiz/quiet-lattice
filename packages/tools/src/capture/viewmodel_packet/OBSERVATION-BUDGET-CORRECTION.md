# Appendix C.2 — Helper observation budget / durable journal correction

## TASK

P1.E05.T03 task-local SOURCE/CPU assessment and correction of helper observation collection vs full-receipt encoding budgets after native attempt 2 failed at `a78c7e5f58e399fcecab0197b65ffe42500cb16a`. Branch `task/P1-E05-T03`. Exclusive evidence: `/private/tmp/vm-observation-budget-7o2wl_r3`. Final commit/tree and clean-worktree verification are recorded after commit in `POST-COMMIT.json` there; this report does not invent its own HEAD.

## STATUS

REPRODUCED / FIXED in CPU source controls; independent source review and native acceptance remain open. Enabled source status is `ENABLED_AWAITING_PARENT_GRANT`. Both flags remain true. Fresh readiness SHA256 `3b43d2db214cc0b99f273bbda0543dc1d990b7dbc87c26a73190c3294ae0acfa`; all 52 prospective paths absent. No real grant, consumption or output was created. Fresh path identity is `viewmodel-packet-observations-7o2wl_r3`.

Native attempt 1 (`84d7098432de296b1db916849804c912d1558cd3`) and attempt 2 (`a78c7e5f58e399fcecab0197b65ffe42500cb16a`) remain FAILED/SPENT and unchanged. Attempt 2: OS exit 1, 18.485242416 s, zero images; primary `Capture did not complete: observer_failed`; helper primary `ValueError: Raw helper observation ceiling exceeded`; both full caller sinks failed with `Raw observation node ceiling`. Only the bounded failure summary and helper/parent records survived. Missing in-memory helper history was not reconstructed.

## SUMMARY

Exact-base RED replayed actual `Native.capture` / `observed_helpers` / `StationJob.wait` growth with retained native callback cadence (inert CPU fixture, whole-process coalition snapshots, aliases/cycles/raw bytes). Collector hit the 12 MiB in-memory graph ceiling at **12,593,989 observedBytes / 127,423 events** (95 ticks; coalition×125,053) and stopped dispatch before serialization. Publication then re-encoded the same retained graph into the result sinks and hit `Raw observation node ceiling` twice; stderr also failed. Cleanup still drained.

GREEN admits the same callback stream into a task-local lossless journal under the already-admitted evidence directory (`helper-observations/`). Each helper event is a snapshot-local raw graph; the journal never re-graphs those encodings into one global node namespace. Repeated canonical bodies use define/use dictionary records; `callSequence` preserves nested invocation order without defeating content deduplication. Sealed GREEN measured **191,937 events**, **22,113,800 logicalBytes**, **8,057,563 expandedBytes**, **234,331 storedBytes** (validated), helper metadata traffic **5,024,005 B** with high-water reserve **28,758 B**, caller result **146,179 B**, and authenticated successor admission without dispatch.

Metadata arithmetic stays inside the existing 64 MiB reserve: helper destination+temporary high-water 16 MiB, Node receipts 8 MiB, journal 8 MiB (capture ≤6 MiB + cleanup/index), caller attempts ≤32 MiB (14 MiB single sink; 64 KiB withheld for failure summary). Image/readout inventory remains 101 files. Primary failure still stops dispatch; mandatory owned cleanup runs before serialization; successor refuses missing/tampered journals; strict post-release copy/hash unchanged.

## FILES

- `observations.py` (new): durable helper snapshot journal + authenticate/validate.
- `test_observations.py` (new): lossless transport, order, overwrite reserve, successor refusal, adverse limits.
- `native.py`: journal wiring; metadata reserve by destination high-water; collectionFailure before normalization; 12 MiB ceiling retained only for non-journal paths.
- `caller.py`: fresh prospective identity; helperEvidence validate after release and for predecessors; caller attempt ceiling 32 MiB / 14 MiB sink.
- `boundary.py`: `helperEvidence` is a required result protocol field.
- `bindings.py`: bind `observations.py` and zlib runtime into source digest.
- `test_boundary.py` / `test_publication.py`: inert fixtures emit complete empty journals.
- `readiness.json`, `README.md`, this report, `evidence/observation-budget-correction/`.

| Source                 | SHA256                                                             | Bytes |
| ---------------------- | ------------------------------------------------------------------ | ----: |
| `observations.py`      | `eb537942584bb58410c438cd9c01ff21695d262a006cfad1f59756ca345298e3` | 13523 |
| `test_observations.py` | `b6d9fe91929700538c2a9a537042e65969693cc1eda3440e898269000c1808b3` | 11219 |
| `native.py`            | `27df9cdb3e5e82951fc34f108670cc21f0e325d3b2996e70b6bedf04a35421d6` | 21537 |
| `caller.py`            | `01bb1d037a0f036b21e95b2120ef75710d410b4ff8837ef58c845a3a57cb2224` | 22644 |
| `bindings.py`          | `09f0b6a6ce301a23b77bfc6785ec1f1d44817e91fdde139401bf1cef64ffde6a` | 13809 |
| `boundary.py`          | `510c6fa4ef2311aed0a181dac9e87bb3ceaf16c5318362c36d802618c58e18fc` | 17484 |
| `test_boundary.py`     | `56e8674f08c8e2ae7eecf5a82a0533b7694cb91109af8cb99a6bdce94130ba28` | 19309 |
| `test_publication.py`  | `a7f9fc07019cc2ed61fb4d3fc5bdac423a1bdcc371560d396350def9090e2433` | 13348 |
| `readiness.json`       | `3b43d2db214cc0b99f273bbda0543dc1d990b7dbc87c26a73190c3294ae0acfa` | 37137 |
| `README.md`            | `d294a86875a7ed02ca44f065325d92bfee164f4b1daf851c12461d6b786fe33c` | 21977 |

## VERIFY

- Exact-base RED (`exact-base-red-v2` / `RED-CONFIRMED.json`): exit 1; primary `observer_failed`; helper `Raw helper observation ceiling exceeded`; publication `Raw observation node ceiling`×2 + stderr sink failure; 12,593,989 observedBytes / 127,423 events; nativeSnapshotReconstructed false.
- Sealed GREEN (`sealed-green` + `authenticate-sealed`): exit 0; journal valid 191,937 events / 22,113,800 logical / 234,331 stored; actual caller exit 0; result `5da4cd1191922e9b3cef849986fee64650b4cf7810aef61cb412e5f39db8ac4a`; consumption `0c5f2b87c5ca3b23c6aaa2c7cbc0f5544a66d6615b997619c56feb3a1db381ee`; successor admitted without dispatch. CPU fixture only — not a native grant.
- `focused-continue`: exit 0, **31 methods** (`test_observations` 11 + `test_boundary` 13 + `test_publication` 7).
- `order-red`/`order-green`/`order-nearby`: nested stdlib call order retained via `callSequence`.
- `static-final`: exit 0; 19 Python sources compile; protected unchanged entry/fixture/inspector/protocol/native-test hashes.
- `auth-check-final`: wrapper exit 0; caller missing grant →1; entry missing consumption →1; `--check` →0 enabled/awaiting-grant; 52 paths absent.
- `preservation`: exit 0; **822 protected**, **12,921 tracked outside packet**, **26,237 historical**, trees + ignored digest match baseline.

Every argv/exit/log digest is in `commands.jsonl` / `COMMANDS.md`. Direct Python `/opt/homebrew/opt/python@3.14/bin/python3.14 -B`; Node 26.12.1 frozen. At most two light CPU workers; no native/GPU/browser/codec/Blender/probe/grant/original cleanup. Screenshot cleanup remains STOPPED.

## DECISIONS

Collection and receipt encoding must cover the same admitted observations. In-memory global graph re-encoding cannot scale to whole-process snapshot cadence; per-event durable segments with content dictionary + ordered callSequence can, within the existing 8 MiB journal reserve for this measured growth. If a future native workload exceeds the journal expansion/disk ceilings, refuse with concrete arithmetic rather than dropping facts. No authority/allowlist expansion; shared helpers/T15/assets/product/past protected files untouched.

## OUT OF SCOPE

No product/asset/helper/T15/shared-capture change; no gameplay/T04; no native/GPU/browser relaunch; no push/PR/merge; no orchestration doc edit. Full T03/native/visual acceptance remains open pending independent review and a fresh parent one-use grant.

## ARTIFACTS

- Exclusive evidence root `/private/tmp/vm-observation-budget-7o2wl_r3`; sealed in `evidence/observation-budget-correction/cpu-evidence.tar.gz` with readback manifest.
- Original native attempt 2 evidence retained under `/private/tmp/p1-e05-t03-viewmodel-packet-live-qsu7czb1*` and parent `/private/tmp/space-vm-parent-unit1-r2-q6kzldbb` (immutable).
- Outside-packet source digest `cfd22c5cf2d6736cce266f26f39b1c0bd76e04f1eb292915aed12791fa40d0d4`; ignored `2fde53955b2b8855c9cae24565e0ba0c300667c203f4001e2ae2d56b0d58f552`.
- Base `a78c7e5f58e399fcecab0197b65ffe42500cb16a`. Post-commit HEAD/tree recorded externally after the clean commit.
