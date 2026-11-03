# P1.E08.T09 capture preparation

This candidate is disabled. CPU checks and a frozen readiness file do not authorize a browser, GPU, native capture, Docker, or service launch. The next gate is a fresh source/caller review followed by an explicit root grant for one screen.

The new fixture keeps the standard `captureUi` route, starts its own loopback Vite server with HMR and watchers off, and captures four declared screens in sequence: day 16:9, day 21:9, night 16:9, night 21:9. Each screen has eight stills, 72 manual frames, one contact sheet and one readout: 82 files per screen, 328 proposed files total. The existing 440-file `fauna-combat` / `fauna-combat-night` packet is bound byte for byte and preserved.

The turn consumes hits at frames 0/4/8, turns at 12–29, consumes three offscreen hits at 30, returns at 32–51, requires no old numbers at 52, and consumes a fresh hit at 54. The new kill still replays flyer 606's encoded authoritative death and consumes gold damage 26 through `CombatFeed`. Near 700 ms, it records the actual instance matrix, published fauna anchor, camera and live HUD number. The independent inspector projects the actual matrix; it does not reproduce the fall formula. Default legacy `HERD_KILLS` still kills walker 601.

`caller.py` is a thin one-screen adapter around the accepted, unchanged station `StationJob` and default `StageReceipts`. The helpers keep their handshake, kernel birth/UID/coalition ownership, finite capture/cleanup deadlines, ordinary Playwright launch receipt, raw exit/drain records, profile preservation and terminal audit. No ancestry-only replacement, custom browser server, codec, video or encoder route is added. Browser observations remain sampled; external native XPC ownership and real-time/live-server behavior are unqualified.

`freeze.py` binds the exact Python/Node binaries, Node + tsx ESM API route, esbuild service binary, dependency bytes and workspace symlink routes, task cwd, PATH, Chromium executable/libraries, software decoder, accepted helper bytes, client/shared/capture source and public assets. Python optimization is refused before other imports or allocation, including compiled optimization. The launchd worker's optimization setting is checked too. Mutable generated Vite caches are excluded from immutable dependency pins. Their exact task-local roots and lack of conflicting ownership are checked; the caller preserves a bounded pre-run copy and records the post-run inventory, including failed runs. It never deletes or relocates these cache trees.

Each cache copy read is limited by the inventoried file length and remaining aggregate snapshot capacity; actual writes consume that capacity. A one-byte EOF probe rejects growth without writing the extra byte. Final source/copy inventories must still equal the original inventory. A separate 30-second deadline covers snapshot inventory, copying and verification. A failure retains the partial copy and source, and publishes no successful `cache-before.json` receipt.

The readiness budget distinguishes enforced controlled-write caps from observed native stop thresholds. One unit reserves 81 image files × 16 MiB plus a 16 KiB readout, a future LFS copy, a future main hydration copy, 64 MiB controlled metadata (32 MiB each for Node/Python), 64 MiB pre-run cache snapshot capacity, profile/TMP/log working-and-archive reserves, generated cache growth, filesystem metadata and a 1 GiB safety reserve. Image staging and image archive copies are zero because none is requested. Native profile, TMP, cache and helper writers have no OS quota; observations may overshoot and cannot establish hard disk bounds. No all-four-fit claim is made. Every unit receives fresh disk admission and stops on its first failure.

Before runtime, root must review this complete candidate, record a PASS review path/hash, explicitly enable readiness, and grant a single declared screen against the exact enabled-readiness SHA and current clean HEAD. The grant must include `purpose: FAUNA_ONE_SCREEN_VISUAL_REPLAY_ONLY`, `oneUse: true`, `authorizationId` matching `FAUNA_CAPTURE_GRANT`, `readinessSha256`, `authorizedHead`, `unit`, `nativeReservesAccepted: true`, `callerReview: {verdict: PASS, path, sha256}`, `previousUnitsAccepted` in declared order, and a future timezone-aware `expiresUtc`. Exclusive consumption remains used after any failure. Later units require accepted prior-unit receipts and a clean worktree. Failure or interrupted ownership requires review/recovery; this candidate has no retry loop.

CPU verification:

```sh
pnpm typecheck
pnpm test
pnpm gate:removed
node --test packages/tools/src/capture/fauna_packet/controls.mjs
PYTHONPATH=/Users/andreyyurlov/.cache/uv/archive-v0/a88MR2jSm399x3XK/lib/python3.10/site-packages /Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10 -B packages/tools/src/capture/fauna_packet/controls.py
python3 -B packages/tools/src/capture/fauna_packet/caller.py --check
```

The Python controls use small synthetic oracle/decoder fixtures solely to prove rejection behavior. They are never capture evidence. Native smoke/e2e and the task's two-client online herd check remain deferred to separately admitted QA.
