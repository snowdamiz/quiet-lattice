# T15 caller census

SOURCE/CPU read only. No tests, browser, Vite, GPU, native, Blender, export, or capture were run. No checkout was written. This is not a visual or runtime qualification.

## Pins read

| Role | Checkout | Branch | HEAD | Tree | Porcelain |
|---|---|---|---|---|---|
| Requested parent | `~/.t3/worktrees/space/t3-909360ab` | `t3/continue-implementation-plan-1` | `8026dc55308fc850da4730870fe5ccd59ef483e5` | `2a3f4a1c66fa8be61d9e09cda3d55bac2b7a053e` | clean when first read |
| Live parent | same checkout | same branch | `991ffe3c080d3e7b1224a1bff53168f8acfe3d7b` | `85f81e01ebe68b37cf7c4ee7638b508b8109b065` | two untracked 8-byte files, `3a1` and `prior`; not capture callers |
| Reviewed T15 | `~/.t3/worktrees/space/t3-a842e4cf` | `task/P1-E14-T15-capture-lifecycle` | `38b6c4b58db43146df20cd760808d1461d7a667b` | `b8ba53c6acdf6eb604b9c046a8165f1985634be8` | clean |

`8026dc553` is not an ancestor of itself only: live parent is three commits later (`78f61c16a`, `a7304884b`, `991ffe3c0`). Those commits do not touch `packages/tools/src/capture` or `packages/tools/src/smoke`. `capture.ts` blob `555c71d140a36004200ac04ff66609eeb4458136`, SHA256 `42e34e0d310366b001fc6cd2951ff08ec7a52db7fbd33428757440a34b9a630d`, is identical at `8026dc553`, live parent, and reviewed T15. Lifecycle test SHA256 `ca2453418de6c36ca88904410cd81be099cc8101c1d9d4f470ec782b73bf2b18` matches too. Staged commit `21eab1f74110c8f7120013ebc4e119f4cc45a824` is an ancestor of both parent HEADs. `capture.ts` was not re-reviewed.

Lark lane was not entered. Live `t3-7d211d96` is clean at `6445c7ec07aa2a08b722aeca22d56132154ea32c`, tree `a09d51b1b594a799a9489504d44d64447bb15450`. Its `capture.ts` blob is the reviewed one. No blend, export, or capture file was opened there.

## Contract used

Reviewed behavior, from the two-file patch already on parent: `startVite` closes the server it created when `listen` rejects; `captureReview` and `captureUi` own Vite before `glArgs` / launch, then `finishCapture` attempts browser close and Vite stop and retains every raw failure, including falsy values, in order. One failure is rethrown unchanged. Several become `AggregateError` with `cause` equal to the first. `finishCapture` stays private. Adoption means a caller either executes those reviewed exports, or owns the same two resources with that cleanup and raw-failure rule, and its bindings name the reviewed bytes.

## Adopted

**Effects.** `~/.t3/worktrees/space/P1-E07-T14-effects`, `task/P1-E07-T14-effects`, `64ba2ba38051ca545ea8d808098e28a7a3220ef8`, tree `823f852bf1d201656ec81a5f1eb4a151f41b20d0`, clean. `capture.ts` and the lifecycle test match the reviewed hashes. Adoption commit `18add9e19f65260d4201be1b23344ead827dd32e`. `effects_packet/shared_capture.json` and `readiness.json` `sharedCaptureLifecycle` name reviewed `38b6c4b58` and SHA256 `42e34e0d`. `entry.mjs` calls `captureReview`. `raw()` keeps own properties, so `AggregateError.errors` and `cause` survive, and falsy values are not dropped. Native pilots stay FAILED/SPENT. The status string `ADOPTED_REVIEWED_SOURCE_PENDING_COMBINED_R3` is stale relative to the later source PASS; the bytes are not.

**Viewmodel.** `~/.t3/worktrees/space/t3-8301ecc8`, `task/P1-E05-T03`, `98a68686cb9ff26804a45909d6ca018abdb3f1e6`, tree `4660e44f417ac484ece3943c6a90cc4f288f9ece`, clean. Same reviewed `capture.ts` hash. Adoption `dea07963a32227cc3eaecad86d128026350b9082`; readiness commit `182fc27d1a5459270e2a3c4673f8e70b86ef3a33`. `sourceDigest` is still `cfd22c5cf2d6736cce266f26f39b1c0bd76e04f1eb292915aed12791fa40d0d4`. Zero tracked files outside `viewmodel_packet/` changed after that readiness commit, and the digest excludes that directory, so the shared-source digest still names this tree. `productionCapture` calls `captureReview` for review units. Offline `fixture.mjs` `captureView` registers `vite.stop` before `chromium.launch`; `execute` runs cleanups in reverse and keeps the first raw failure plus later cleanup failures. `errorFacts` retains null, false, 0, and undefined. Capture remains held. No capture was run.

**Fauna, live checkout.** `~/.t3/worktrees/space/t3-06487465`, `task/P1-E08-T09-current-base`, `d0a914c94754a6ba0c3b1f364e2254c2815b5f54`, tree `86fd5f5e1360babc68d9448a8f52039badd54240`, clean. Same reviewed `capture.ts` hash. Adoption `c360967ab2bdba096bd2949c70fe679e8b7d68b3` is recorded in `readiness.json` `sharedCaptureSourceReview`. `entry.mjs` calls `captureUi`, splits `AggregateError.errors` into primary plus cleanup, and `describe()` keeps a raw graph including falsy values. Its `finally` attempts restore-fs, restore-browser, and unregister even after a capture rejection. Plan line 394 does not name fauna; this pin has the shared patch and the entry split. Not a missing caller.

Unchecked-out `task/P1-E08-T09` at `bb5a7096a9c4` still has the pre-review `capture.ts` SHA256 `3f95b7bf75c3c25819a9b7d7f94276afb9340f3a6fa9e41d4310817a585f7fdc`. It is not a worktree. The live fauna caller is `d0a914c`.

## Actionable missing caller

One. `packages/tools/src/capture/playthrough-run.ts`.

Blob `4c58744381744451afa5f9617d9f5910128652b6`. SHA256 `0a851b2a810fe1104d9591e710b120791283e0f4d29c1ae89473fb876cc8b090`. Identical at reviewed T15, `8026dc553`, and live parent. The reviewed patch did not change it. It is the only production caller of `startVite` on the parent besides `capture.ts` itself. `captureReview` / `captureUi` have no other parent caller.

Present checkout for the brief: live parent above. The file bytes match the requested parent pin.

Gaps, from the current file:

- Line 8 acquires Vite. Line 9 calls `glArgs` and `chromium.launch` outside `try`. A launch or `glArgs` rejection does not stop Vite.
- Lines 53–56 `await browser.close()` then `await vite.stop()`. A close rejection skips Vite stop and replaces any work rejection.
- Failure is a boolean. A falsy rejection is not retained. Cleanup does not build `AggregateError`.

`startVite` listen-failure close is inherited, because this parent already has the reviewed `capture.ts`. The browser pairing is not.

### Brief

Change only `playthrough-run.ts` on a checkout whose `capture.ts` blob is `555c71d140a36004200ac04ff66609eeb4458136`. Do not edit `capture.ts`, do not export `finishCapture`, and do not run the script.

After `startVite` resolves, that server stays owned until `stop` is attempted. Call `glArgs` and `chromium.launch` only after that ownership exists. Keep the first raw rejection, including `undefined`, `null`, `false`, `0`, and `''`. If launch resolved, attempt `browser.close`, then always attempt `vite.stop`. One failure is rethrown unchanged. More than one becomes `AggregateError` ordered work, then browser close, then Vite stop, with `cause` the first value. Success output and the existing phase list stay. A failure must reject the process rather than `exit 0`. A unit test may mock Vite and Playwright the way `capture.lifecycle.test.ts` does. No browser, Vite server, capture, GPU, native suite, push, PR, or Trunk.

`packages/tools/src/smoke/title-shot.ts` launches its own Vite child and Chromium and has a similar `finally`. It does not call `startVite`, `captureReview`, or `captureUi`. It is outside this adoption.

## Held, not actionable

Do not dispatch these. Their checkouts are on the lane hold list.

**Animation.** `~/.t3/worktrees/space/t3-11167406`, `codex/task/P1-E05-T02-thalune-reel-candidate`, `bc9dbad83c772e6202075404362490eef4f46d2b`, tree `3b25f1b6ff405127f0f011890719f0795e9b341a`, clean. `capture.ts` is the pre-review SHA256 `3f95b7bf75c3c25819a9b7d7f94276afb9340f3a6fa9e41d4310817a585f7fdc`. No lifecycle test. Sole entry: `packages/tools/blender/characters/animations/thalune-run-candidate/entry.mjs`. `browserRuntime.start` calls `glArgs` before `startVite` (about line 249) and launch after it (line 252). `runEntryStage` `finally` does attempt `disposePage`, `closeBrowser`, then `stopServer`, and continues after a cleanup throw (lines 179–188). That local loop does not fix the old `startVite`: a listen rejection never assigns `vite`, and the old function does not close the server it created. Later brief, only after the native hold is released: cherry-pick the reviewed two-file patch, rebind, do not rewrite the entry loop, do not capture.

Unchecked-out `codex/task/P1-E05-T02` at `49ae87cbdb86` has older `lossless-primary-candidate` and `lossless-primary-observer-corrected` entries and the same old `capture.ts`. The live animation checkout does not contain those entries.

**T13 / performance.** `~/.t3/worktrees/space/t3-e8c6f9e8`, `codex/task/P1-E14-T13-trace-observer`, `8a881e369de35c4fb62cc9ae5d68e48d54716cbf`, tree `3ca9cef5984e6b996b89ffbca5d96d7ef9751cec`, clean. `capture.ts` blob `1084be6458d11df3047dd6dd42567de3cffea4c0`, SHA256 `ac16923e3ffabbe1b2f7f4238a0e0c14d3c3aad111893cc602378373ed098581`. Diff against reviewed is the optional `startVite(root = ROOT)`, an exported `openReview` asset route, and review-api fields. `startVite` listen cleanup, `finishCapture`, `captureReview`, and `captureUi` bodies match. Lifecycle test hash matches. Shared exports are adopted. Two extra owners are not:

- `packages/tools/src/capture/native-vite.ts` `startOwnedVite`: on startup failure it stops the child, then appends `String(cleanup)` onto the failure string and throws `OwnedHelperError`. Original and cleanup values are not retained by identity.
- `packages/tools/src/capture/timer-boundaries.ts`: browser launch precedes `startVite`. The `finally` attempts close and stop separately, but rejections are `String(error)` and the function returns `{ errors }` instead of rejecting.

`trace_observer_packet/worker.ts` `stopOwned` attempts browser, browser server, and Vite, and throws `AggregateError` with `cause` the first. `failureSnapshot` keeps null, booleans, and undefined. That worker path is not a missing shared-lifecycle caller. Native timing stays unqualified. No later brief until the hold lifts.

## Next step

Source-only edit of `playthrough-run.ts` on the parent lineage that already has reviewed `capture.ts`. Do not start that edit from a held checkout. Do not run playthrough. Do not re-review `capture.ts`. Effects, viewmodel, and live fauna need no adoption patch.
