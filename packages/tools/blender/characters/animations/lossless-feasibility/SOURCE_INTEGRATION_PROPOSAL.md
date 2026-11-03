# Smallest lossless primary integration

This is a source proposal, not implementation or runtime authorization. The format proof is accepted. The corrected ledger is `storage-accounting.json`, SHA-256 `2c5665c31c3189d1822560534c0220f2ab7a33010854068ce08964ad5b85519b`. It includes the one upfront integration fixture in the full-scope ledger as well as the first small unit. Reuse that ledger, including all retained copies, integration-test outputs, archives, staging, and main hydration. Do not revive the withdrawn single-copy fit claim.

## Files and scope

Create a fresh private candidate from `/private/tmp/t02-pilot-import-corrected-26i4s64t`. Do not edit that historical candidate or its consumed grant.

| File in the fresh candidate | Narrow change |
|---|---|
| `entry.mjs`, based on SHA `889af0c563ae6476fe65357c0bad45158eea2f4356cd6b971471f457cec495ed` | Extend `persistReturned` and `runEntryStage` for motion primary video, one-frame backpressure, complete observation persistence, and encoder finalization. Keep still PNG handling. |
| `caller.py`, based on SHA `fe16610264290341ac32460a5349c2c963c00e388e335db32e6c363fbf786653` | Add the exact new unit scope to `verify_structure`, admission, and `StationAdapter`. Start one owned CPU validation job per completed reel after browser release. |
| `caller.py:inspect_capture` | This is the existing independent inspector, not a separate module. Require the new video/frame maps and complete observations for motion; retain current PNG inspection for stills. |
| `freeze.py` and the new candidate's CPU freeze audit | Bind the worker, installed software encoder/decoder and Python/Pillow routes, current explicitly accepted helper review, new artifact schema, exact counts, and corrected disk ledger. Never reuse an old grant or silently refresh a changed helper. |
| New private `rgb-primary.py` | One synchronous worker with `encode-png-stdio` and `validate-primary` modes. It is a data worker, not a supervisor. It creates no launchd job or alternative ownership boundary. |

Keep `page-api.mjs`, `playback.mjs`, the Review scene, ordinary `chromium.launch`, authored bodies, and animation source unchanged. Keep the existing proof script as the reference test tool. No production animation integration is part of this unit.

## Versioned primary contract

For new motion output, use `t02-lossless-rgb-primary/v1`: one lossless RGB MP4 per reel, exact frame ordinal and PTS mapping, complete per-frame non-image observations, and source/decoded pixel hashes. Preserve exact decoded RGB/RGBA pixels, frame order, and the 60 Hz sample timebase.

Each frame-map row contains the work ID, source frame/sequence/clip times, reel ordinal, primary video path, media frame ordinal, PTS, `1/60000` timebase, RGB SHA-256, RGBA SHA-256, and explicit alpha policy. If the source was a PNG data URL, also retain its byte length and SHA-256. Mark `sourcePngRetained: false` for normal motion frames. Do not emit the old claim that a canonical PNG file remains recoverable.

The parent clarified that new motion evidence requires exact decoded pixels, not bit-for-bit reconstruction of newly generated PNG containers or data-URL strings. Historical PNGs remain preserved. Required stills retain the existing exact PNG representation and 12 MiB allowance.

Keep every non-image field returned by the page, including all intended/at-render/after-capture poses, transforms, identities, backend/error observations, and unknown metadata. Serialize complete non-image observations under the existing 256 KiB allowance. Store image provenance, encoder acknowledgments, and primary frame references in separate budgeted manifests rather than squeezing them into that allowance. No pose or observation summarization is permitted.

## Frame flow without a second render

1. Call the existing page-frame API once. Retain and validate its returned metadata before semantic acceptance, as today. Use the PNG bytes already returned by that same capture; do not call `Review.capture` or render again.
2. Send one length-bounded PNG plus its work ID/ordinal to the worker. Pillow decodes the existing 8-bit 1920x1080 image. Hash the original PNG bytes, RGB pixel bytes, and RGBA pixel bytes. Verify every alpha value is 255 for RGBA motion. Nonopaque input stops the unit before its RGB frame is forwarded.
3. Feed the exact RGB24 bytes to software FFmpeg using the proved lossless recipe. Adapt only the input transport to raw RGB stdin; CPU-test that adaptation. Keep CRF0, RGB, GOP60, no B-frames, one encoder thread, and the exact timebase. No YUV conversion, lossy fallback, resampling, or dropped frames.
4. Await a worker acknowledgment after alpha/hash checks and a blocking encoder-pipe write. Persist that acknowledgment and frame map before advancing. The producer permits only one in-flight source frame; Node and worker writes must honor pipe backpressure. On any observed encoder exit/EPIPE or persistence failure, refuse the next dispatch and retain the partial unit.
5. Close encoder stdin, require successful encoder exit and mux finalization, then release the browser job through the unchanged StationJob lifecycle. A write acknowledgment alone never accepts a reel.

The bounded queue is one source frame, not a claim about total process RSS. Account for the PNG/data-URL copies, one decoded RGBA/RGB frame, pipe buffers, and codec state. Measure and qualify the total memory bound before runtime admission. The unit's file ceilings and archive/cache growth enforcement must also be reviewed; an after-the-fact size check is not a substitute for a storage limit.

## Ownership and independent acceptance

The entry's worker and its FFmpeg child inherit the existing browser capture StationJob cohort. Bind their actual executables and software routes; observe current birth/UID/cohort facts. Keep native encoder output in explicit raw evidence files. Use no hardware encoder, `launchServer`, daemon, new supervisor, or implicit retry. Existing capture/cleanup deadlines remain unchanged and include encoder backpressure/finalization.

After the browser cohort is released, run `validate-primary` in a separate unchanged StationJob CPU boundary. Its ffprobe and software decoder children stay inside that boundary. Verify exact stream format, full frame count, ordered PTS/durations, and every source RGB hash. Use bounded framehash output, not a persistent full raw-RGB reel. Also verify reconstructed opaque RGBA hashes; the implementation CPU check must cover the selected streamed RGBA route. Do not accept on sampled frames alone.

`inspect_capture` independently requires all expected observations and frame-map rows, their original work/time/profile identities, pose agreement, error absence, source/pixel hashes, sealed file hashes, and the successful released validator receipt. Missing, extra, reordered, malformed, mismatched, or oversized evidence holds the unit. Still-image validation remains unchanged. Keep the primary error distinct from later encoder, persistence, and cleanup failures.

## First implementation verification unit

Use one new-output CPU unit over at most 132 existing pilot frames. This exercises the new entry-to-worker framing/acknowledgment path, complete observation writes, alpha checks, actual software encoder, streaming decoder hashes, inspector, and release receipts without rendering. Use the existing source PNGs and observations in place. Do not repeat a broad body/export suite or introduce another exploratory codec comparison.

Meaningful controls are nonopaque-alpha refusal before forwarding, encoder failure/EPIPE and backpressure, persistence failure before next dispatch, byte-limit overflow, unknown observation-field preservation, and rejection of a missing/reordered frame, bad PTS, or altered pixel hash. Preserve each failure and prove cleanup with the unchanged boundary. Then obtain independent review before any new capture.

Only after separate authorization, a small real unit could capture `run_forward` for Thalune at LOD0 and LOD2: two 189-frame motion stages and one 8-image still stage, at the declared still time 0.4 seconds. Two post-release reel validators complete that unit. Do not repeat the existing walk/cast coverage. This adds two of the 240 remaining reels, not complete coverage of all 40 clips across every people.

The corrected ledger already includes this unit, one bounded new integration fixture, all nine job archives, full observations, all four retained packet copies through main hydration, Git/staging costs, and 4 GiB free-space safety: **19,493,289,984 incremental bytes under its declared ceilings**. Recheck actual free bytes before admission and each stage. Partial-unit admission is useful but does not promise whole-library retention. There are no extra motion keyframe PNGs in this unit; use the eight required stills and budgeted contact sheets. Any additional retained media needs new accounting.

Lossless observation compression remains a separate proposal in the ledger, with zero storage credit until a byte-roundtrip proof and a reviewed compressed-primary contract exist. Do not compress or delete current observations. Keep the joint-cap/gap art concern visible and its cause unassigned.
