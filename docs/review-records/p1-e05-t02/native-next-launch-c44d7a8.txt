# Next bounded native unit — currently disabled

The runnable implementation is `../native189.py`, with `../native189_producer.py`
inside the two existing StationJob cohorts. `next-launch.json` lists the absolute
paths, executable identities, 14 successful packet files, proof/log paths, limits,
current retained inventory, and unchanged later capture jobs. This document is
not a grant. All prospective paths remain absent.

After fresh independent source review and the parent's one-unit native
authorization, the activation is **nativeFixtureAuthorization=true only**, keeping
runtimeAuthorization=false. Update the readiness entry's hash/size in
candidate-index.json and commit those activation metadata changes before making
the grant. The grant binds that new clean HEAD and those exact readiness, plan,
and index bytes. Do not run freeze.py to activate: its job is to reset both flags
false. Do not change playback, source identities, inventory, budgets, or poses.
No extra approval stage is introduced.

The parent supplies the following fields in the prospective grant file; this is
a schema description, not an instantiated grant:

- purpose: `THALUNE_NATIVE189_DIAGNOSTIC_ONLY`;
- nativeFixtureGo: true; captureGo: false;
- authorizationId: a fresh parent identifier;
- jobIds: `["native-189-encode", "native-189-validate"]`; frames: 189;
- head: the exact clean activation commit;
- readinessSha256, planSha256, candidateSha256: the exact current files;
- runRoot: `/private/tmp/t02-native189-r04-20261107-t3-11167406`;
- expiresUnix: current Unix time plus 1,800 seconds (admission permits at most
  3,600 seconds). Both dispatches recheck expiration, source, HEAD, cancellation,
  retained inventory, and current free space.

From the actual checkout, with the exact PATH recorded in next-launch.json:

```sh
/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B packages/tools/blender/characters/animations/thalune-run-candidate/native189.py --execute --grant /private/tmp/t02-native189-r04-20261107-t3-11167406-grant.json
```

**That command currently refuses before grant reads or output allocation.** No
encoder, decoder, browser, GPU job, service, or grant was launched in this unit.
The consumed record is the sibling `...-consumed.json`; cancellation is the
sibling `...-cancel.json`. Consumption and worker-entry claims are exclusive.
A failed/spent attempt cannot be retried into this namespace. The encoder must
exit with an exact integer zero and positively release its coalition, kernel
membership, registration, recorded births, scratch and TMP before the validator
is dispatched. The validator independently checks RGB/RGBA frame hashes, count,
order, PTS and file hashes, then decodes a bounded looped 190th frame and requires
count refusal. The ordinary capture flag remains false throughout.

The diagnostic is 1920×1080, opaque, 60 Hz, 189 frames: R=(x+3*i)%256,
G=(y+5*i)%256, B=((x//32)^(y//32)^i)&255. One PNG remains in memory until its ACK.
No PNG sequence or RGB spool is retained. One libx264rgb thread, one decode thread,
39,354,368 bytes per reel; 600 seconds per cohort and 60 seconds cleanup; probe
30 seconds and each of RGB, RGBA and surplus decode 120 seconds. The parent must
observe the runner's actual OS exit zero. Its disk status is deliberately
`NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT`, not independent evidence of that
exit or permission to capture. Authenticate bounded snapshots of the result and
consumption, preserving the original bytes and any delivery failure; never turn
a provisional successful snapshot into acceptance after a nonzero/unknown exit.

Owned RSS is sampled every 0.2 seconds, with a three-second sample deadline and
an 8,589,934,592-byte aggregate stop threshold. Kernel counts and all member
birth/UID identities must reconcile before and after reads. Excess, cancellation,
unknown membership, reuse, drift or unreadable RSS stops dispatch; the unchanged
StationJob drain owns cleanup. This is a sampled stop, not an OS memory quota,
and unrelated XPC processes are never claimed. Strict racing observations can
HOLD; native behavior remains to be qualified.

The combined reserve is 22,066,626,560 bytes: four named copy slots at
1,217,495,040 bytes, eleven named 1 GiB archive allowance slots, 16 MiB Git,
1 GiB staging and 4 GiB safety. The eleven slots retain four historical
allowances, five later capture jobs and two new native jobs. The runner creates
only one fixture packet; the other three copy slots are reserved, not allocated.
The current retained-input manifest has 157 files / 874,877 bytes, each hashed.
No existing archive/copy is invented: historical and future slots are budget
allowances. A fresh measurement is required before allocation and each dispatch.
The old free-space snapshot is not admission. Per-job archives remain a
post-release 1 GiB acceptance limit; Vite snapshots stop above 384 MiB or 4,096
entries each, with before/after copies charged to the job archive allowance.

For later capture, the existing Vite paths are checked against live open files
and exact process identities. Unknown checkout cwd owners conservatively refuse.
The fixed `/private/tmp/t02-vite-t3-11167406-exclusive` lease is exclusive to one
controller, shared across its three capture stages, and retained afterward.
Pre-existing and generated caches stay in place and are copied/verified before
and after each stage. No cache or lease is deleted, so a replacement cannot be
mistakenly removed. A different controller cannot reuse that spent lease. The
current resource report contains unresolved cwd observations, not cache admission.
Shared Playwright caches, old profiles, and unrelated namespaces remain unowned.

After this native unit, actual animation capture remains two separate 189-frame
Thalune run_forward reels at LOD0/LOD2, eight 0.4-second stills, then two
validators after all capture releases. Its exact 437-file inventory remains in
the unchanged revision-03 proposal. This source unit supplies no native, visual,
whole-animation, gameplay-integration, or merge acceptance.
