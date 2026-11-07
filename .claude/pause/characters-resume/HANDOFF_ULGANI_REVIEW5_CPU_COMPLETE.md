# P1.E05.T01: Ulgani fifth CPU complete, variant capture held ready

Worktree: /Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41
Branch: task/P1-E05-T01
Exact HEAD: 16e0d6e20331d33b8436f4c065134a57b8055958
Tracked tree clean. No push/merge/helpers/orchestration-doc edits.
CPU artifact commit: 6f7c74886a7801b3f73c5712c84b2733df9bdc3a
Source/export commit: ef78fa7fae8634912a210adc20b48139fd8e0de7

## Exact immutable inputs

Source assets/blend/characters/ulgani.blend
SHA256 06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b
GLB packages/client/public/models/characters/ulgani.glb
SHA256 9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682
GLB bytes 47796920
Source/export validators PASS5/5,fail0,warn0; official family sources3/3PASS.
Fourth source/export and all failure/recovery/raw-map/checkpoint evidence retained;frozen Thalune/Ixari179/179artifact hashes verified. No peer source/export/render changes.

## CPU cache complete

All16stages: portraits;heads1–6;suits1–4;grid;heads family;suits family;head1/suit3 bends.
All61primary artifact hashes verified. Fresh fifth-only CPU root assets/renders/characters/ulgani-review5/.
Standard helper/cameras/lights/resolution unchanged;turntables/heads/hands48,morphs32,bends24samples;CPUdevice explicit,two threads. Every sheet fully decoded,viewed andhash-bound.
Four additional dialogue PNGs in that root/dialogue/ include lossless420x460nativeFV/MBP cells,nativepair andoffline160x160-per-portrait pair. Offline sizing is not integrated dialogue playback proof.
CPU readiness assets/renders/characters/validate/ulgani-review5-cpu-ready.json
SHA256 5591147d82e5d9b855133ade5cc103693f6e2f33d71ef90adef029c01bc48ef9
Allownrender/controller/assertiongroups directly drained at each boundary. Last runtime end 2026-11-02T10:23:22.079458+00:00;last direct3group drain 2026-11-02T10:24:08.282102+00:00. Rechecked 2026-11-02T10:40:16.750220+00:00.
No owned live Blender,render,browser,server,sampler,controller,caffeinate job.

## Bounded capture plan: prepared and checked,NOT RUN

Preparation assets/renders/characters/validate/ulgani-review5-capture-only-preparation.json
SHA256 30d257264db4e29d502700f7b022c11a3f7e19924677da794fa191901a76d289
Canonical reviewable helpers:
- packages/tools/blender/characters/capture_ulgani5.py SHA8ad21d3e8df837960413079b988d22dcf6d72611211821d800674e07f3f09358
- packages/tools/blender/characters/sample_ulgani5_capture.py SHAc1a96c9f69a0d3c4521f233b4023314cf005868d5e65a3ccd7ae8fc30e95b61a
- packages/tools/src/capture/ulgani5-review.ts SHA5b63b1bb3b668005d313b08ecbf7c2566f0bfb328181a5419d28914fe8b21d00
Shared capture.ts/review.js/harness not edited. Harness digest 3a934c2a963bcfae471561ffcf9384fe0d8ebe708abfc9ed36ccddbe0934dbcc.

Read-only verify: python3 packages/tools/blender/characters/capture_ulgani5.py --verify-only
Passed16/61 plus dialogue/harness/helper bindings;no runtime. Tools tsc --noEmit passed. TS API --plan passed;badvariant,outside-fifth-root andclosedGPUgate all refused as expected. Fullcheckreport ulgani-review5-capture-preparation-checks.json. GPU/browser behavior remains untested until authorized.

Parent native window is active. hold-ulgani5-cpu andhold-ulgani5-gpu are present. AllGPUrelease gates ABSENT. Do not remove holds or start runtime before next explicit parentGPUsubsetGO/resource release.
AfterGO authorizes a defined subset,remove only ownGPUhold. For each allowed variant,check messages/hold and previous drain,create its per-invocation gate JSON with parent_gpu_go:true,authorization_id,exact allowed_variants,identity from preparation,plus preparation_sha256 above. Gate path forhead1 is .claude/pause/characters-resume/gpu-review-release-ulgani5-ulgani_head1.json. Controller consumes/archives it atstart. Noalivewaitingcontroller. Passing allowed variants may continue without reasking approval,with complete drain and hold/message checks betweeninvocations.

Example exact first invocation afterGO:
python3 -u packages/tools/blender/characters/capture_ulgani5.py --variant ulgani_head1 --attempt attempt-01
After controllerexit/directdrain:
python3 packages/tools/blender/characters/capture_ulgani5.py --finalize --variant ulgani_head1 --attempt attempt-01

Task-owned TS entry uses existing captureReview API(asset ulgani,onevariant,outDir assets/renders/review/characters/ulgani-review5/attempt-01). Head1 writes13standardfiles under thatroot/ulgani/ulgani_head1/. Allten exact args/output/job/gatepaths are frozen in preparation. Standard1920x1080,3lights,LOD0/2,wireframes,overlay,100m/200m andrawperf cases unchanged.
Actual controller logs Node/browser/sampler/assertion identities/groups/profiles;bounded480seconds;cleanup only verified owned groups,archive leftover owned profiles;separate --finalize verifiescontrollerexit beforecache reuse. Nooverwrite ofold,failed orcurrent-sourcecompletedoutputs. Failedretry needs separatelyauthorized freshattemptid. Finalized current-source/export/CPUready/harness13-file captures are hash-verified andreused. Prefix is a parent-defined allowedsubset executed as separate completed/drained invocations,neveronewaitingbrowser.
Do NOT run obsolete ulgani_gpu_pack.py,ulgani4_capture_only.py or preserved ulgani5_capture_only_full_unrun.py. They are history,not this plan.

## Remaining gates and grader separation

SeparateGPUwindow after native/stationfullrelease;onevariantatime. Retain allerrors andunreliable timing flags;T13 attribution unresolved,no60fps/budget/regression/repaired-performanceclaim. Then freshUlgani/sharedpeercontextlineups,current fifthrenderinventory andartifact/spec/rubric-only fifthgraderpacket. Exactsource/export/validation/renderinventory andactualtiming/provenance only;exclude worker rationale/reports andpriorverdict text. Peerlineups are frozencontext,notnewpeergrades.
Worker-only observations remain in ulgani5-portrait-inspection-worker.md outside grader manifest. No self-grade. No fifthUlgani verdict exists. WholeT01/finalwhole-taskcodeReview remains incomplete.
