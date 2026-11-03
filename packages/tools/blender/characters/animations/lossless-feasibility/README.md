# Lossless motion-evidence feasibility

The installed software `libx264rgb` encoder preserves every decoded pixel in this bounded proof. This does not implement a capture format or authorize another capture.

The proof uses existing 1920x1080 pilot PNGs. No browser, GPU, hardware encoder, package install, fresh rendering, or production runtime change was used. All original PNGs, candidates, caches, and prior evidence remain untouched. The observed joint-cap and joint-gap concern remains for art review. Its cause is not assigned here.

## What passed

| Unit | Source PNG bytes | Lossless MP4 bytes | Checks |
|---|---:|---:|---|
| Hand recipe, 8 frames | 34,645,897 | 3,782,265 | All RGB and reconstructed RGBA bytes equal |
| Script reproduction, 8 frames | 34,645,897 | 3,782,265 | Container bytes identical to hand recipe |
| Representative contiguous walk, 132 frames | 571,808,373 | 23,486,564 | All RGB/RGBA bytes, frame count, order, timestamps, and seek match |

The representative file is [sample-132-lossless-rgb.mp4](sample-132-lossless-rgb.mp4). Its SHA-256 is `a3fc5f21eabb4167428b7f886e7e9d65db24af17d54d304f9e1978193952f8b8`. Original-frame hashes and media timestamps are in [source-frame-hashes.jsonl](source-frame-hashes.jsonl).

The exact recipe is software `libx264rgb`, `-crf 0`, `-preset medium`, RGB24 input, one encoder thread, GOP 60, and no B-frames. The output decodes as full-range GBR planar RGB, H.264 High 4:4:4 Predictive. There is no chroma subsampling. Direct byte comparisons establish the pixel result; the codec name alone is not the proof.

All source frames are RGBA with alpha 255 everywhere. The script verifies this before encoding. Adding alpha 255 back to the decoded RGB reproduces every original RGBA pixel. Nonopaque RGBA is refused, and the refusal control passes. Transparent input requires a separate alpha-preserving proof. PNG file bytes and metadata are not recreated by this video format.

The MP4 timebase is `1/60000`. Its 132 packets have PTS 0 through 131000 in 1000-tick steps, at exactly 60 samples per second. The source sequence begins at original ordinal 15. The frame map retains each original work ID, sequence time, and looping clip time. Software seek to media frame 66 returns exactly the matching source pixels. These are sampled animation times, not real-time playback FPS.

The installed software decoder also emits a 15,003-byte [frame-hash file](decoded-framehash.txt). All 132 RGB SHA-256 values match the independently decoded original PNGs. This validates a bounded verification route without a persistent raw-RGB file. No streaming capture or streaming runtime verification was implemented.

## Reproduce without rendering

Use the existing bundled Python with Pillow. No package installation is needed. The output directory must be new; the script refuses to overwrite one.

```sh
proof_python=/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
"$proof_python" -B packages/tools/blender/characters/animations/lossless_evidence.py \
	--source-run /private/tmp/t02-pilot-run-2a7d0f8d9da8467bb108e3b3cd7e416f \
	--frames 132 --out /private/tmp/t02-lossless-proof-fresh
```

The script pins the unchanged accepted StationJob core, child helper, and short-TMP helper. It does not import `run_round4_remaining8.py`. Every native encoder, probe, decoder, and seek command has its own unchanged StationJob boundary. Decoder and encoder each use one compute thread. Native capture limits are 120 seconds, or 30 seconds for metadata probing, plus 20 seconds for cleanup. Output files also have explicit size limits. The 132-frame decoded RGB proof is bounded at 821,145,600 bytes. The encoder is bounded at 512 MiB. Those proof files remain preserved in the private evidence namespace.

Native command output is redirected from process startup into exact combined stdout/stderr files. The wrapper reports their paths. It does not fabricate browser log facts. The initial capability-help run exposed a browser-specific archive-parser limitation: `-profile <string>` was mistaken for a browser path. The initial failed archive receipt and raw bytes remain preserved. A separate, indexed recovery records the later unchanged archive invocation and direct release checks. The recovery index explicitly records that it was created after relocation; it does not rewrite the initial run as successful.

[native-release-audit.json](native-release-audit.json) verifies all 13 native cohorts absent, 39 exact process births and 39 groups absent, registrations and scratch/TMP absent, and owned ports and assertions absent. No original data was deleted.

## Observed cost and limits

One representative encode reported 7.821 seconds of user CPU, 0.547 seconds of system CPU, and 14.222 seconds of native wall time. Decode reported 1.728, 0.340, and 1.967 seconds respectively. The complete proof pipeline took 37.950 seconds, including source hashing, Pillow decoding, native job ownership, probing, full byte comparisons, and seek verification.

These are one-run observations, not a throughput benchmark. No limiter, repeatability range, full-library compression guarantee, or production performance conclusion is established. Raw FFmpeg memory telemetry remains in the logs, but its platform units were not normalized and are not used as a memory claim. Browser, QuickTime, and hardware-decoder playback compatibility are untested. A separate labeled lossy viewing copy may be useful; it must never replace the lossless primary evidence.

The marker precedent used the same installed FFmpeg binaries but encoded a lossy `libx264` CRF18/yuv420p viewing copy from JPEGs. Its quality claim is not reused here. [evidence.json](evidence.json) records the actual binary hashes, codec observations, commands, helper pins, private proof paths, timings, and limits.

## Corrected storage accounting

The earlier 32,004,636,672-byte fit claim is withdrawn. It counted future artifacts once and did not include working-tree/LFS duplication or later hydration into main. The bounded pixel proof remains unchanged.

[storage-accounting.json](storage-accounting.json) is the authoritative corrected ledger. It preserves the accepted 256 KiB allowance for each complete observation and 12 MiB for each PNG still. No metadata fields, poses, frame order, or sample rate are dropped. The old 128 KiB observation and 8 MiB still assumptions are not used for admission.

The remaining scope is 40 clips, 240 reels, 46,656 motion frames, and 960 stills. Its proposed encoded-motion quota plus the accepted still and raw-observation allowances already total 34.219 GB for one copy, before indexes or archives. The complete conservative packet allowance is 63.680 GB per retained copy after explicit index/ancillary, validator-manifest, freeze, and contact-sheet bounds. Whole-scope retention does not fit current disk.

Current repository attributes make every file under the proposed `assets/renders` packet path an LFS artifact. The task working tree and shared LFS store retain two packet copies. Main hydration adds a third working-tree copy while sharing the same LFS store. Keeping a separate private primary output adds another copy. An independent clone adds both its own working tree and LFS store. No deduplication, compression, or APFS clone credit is assumed. Git pointer/tree/commit data and bounded temporary packing have separate reserves.

The strict full ledger also retains 600 proposed owned-job archives at the existing 1 GiB per-job allowance. Those private cache/profile/raw-log archives are indexed and preserved but are not copied into the Git packet in the ledger. Copying them into a portable packet requires multiplying their bytes too. The full private-original/task-worktree/LFS/main case is 904.468 GB. This is a conservative quota ceiling, not an observed size prediction. It is not an admission request.

The existing 10.632 GB pilot, prior failed attempt, current feasibility files, raw RGB proof files, and current working-tree/LFS objects are already included in used disk. Their incremental charge is zero. They are preserved and are not subtracted from free space again.

## One bounded partial unit

A proposed next source-integration unit is `run_forward` for Thalune at LOD0 and LOD2. It contains 378 motion frames, 8 stills, and 386 complete observations. Three capture jobs and two post-release validation jobs retain their full archive allowances. One new bounded integration fixture uses at most 132 existing pilot frames, with a 512 MiB encoded-output ceiling, 32 MiB of complete test hashes/metadata, and four owned native jobs. Existing test PNG/observation inputs are read in place. Future framehash validation has zero persistent full-reel RGB spooling.

Including retained private primary output, task working-tree copy, shared LFS copy, later main hydration, all nine job archives, Git/source metadata, separate native/LFS staging, and 4 GiB of free-space safety, that unit requires at most 19,493,289,984 incremental bytes under the declared ceilings. This permits only a separately reviewed partial unit if a fresh per-unit disk check passes. It does not promise retention or completion of the whole remaining library.

Capturing new future primary output directly into a new task-worktree namespace could avoid the separate private-primary copy. That topology requires review and is not implemented. It does not move or delete any existing packet. A separate storage decision is needed before full-library accumulation.

The timestamped free-byte snapshot, same-volume identities, all copy cases, index/cache/staging categories, and unresolved limits are in the ledger. There is no assumed alternate mounted data volume. Current free disk changes during other tasks, so it is a snapshot rather than a reservation. Unscoped Git GC/repack is excluded from the bounded reserve and must be separately budgeted if needed.

## Lossless observation compression proposal

A per-reel tar+gzip archive could retain every original observation JSON byte, with an index of original work IDs, paths, byte lengths, and SHA-256 values. This is proposed only. It has not been implemented or measured. Before any storage credit, a bounded CPU proof must recover every member byte-for-byte, preserve count/order and unknown fields, reject unsafe/duplicate paths, and bound decompression. Keeping the raw JSON and an additional compressed copy does not save storage. A future compressed-primary contract would need explicit review. Current observation files remain untouched.

No video ratio is applied to observation metadata, stills, indexes, caches, Git objects, or the entire packet. No compression credit appears in this corrected budget. The new primary image representation, alpha handling, backpressure, memory limits, native ownership, validation and new output scope still require implementation and independent review before any separately authorized capture.
