# P1.E05.T01 — Ulgani fourth CPU complete; whole task incomplete

Worktree: /Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41
Branch: task/P1-E05-T01
Current immutable CPU artifact commit: d3b36e44e2958fdf6b2eecd7bc5658280e4c1391
Tracked tree clean. No push. No owned live render/controller/browser/sampler/watcher/caffeinate jobs.
Parent QA has the slot. CPU art and GPU/browser runtime are held pending a later explicit parent work window.
Both gpu-review-release-ulgani and gpu-review-release-ixari5 are absent.

## Completed

Ixari fifth REVISE is preserved as a parent-relayed Sol verdict in commit a98411cb1.
Reviewer ixari_fifth_grade_sol; gpt-6.1-sol; xhigh; fork_turns none; graded artifact HEAD0e625c1928a05ac90126320417f2d6efaacee926.
Mean3.2; all179 hashes/bindings verified by grader. Parent filed P1.E05.T08 at mainf2f7681b6; performance stays in E14.T13.
No sixth Ixari revision. Ixari and Thalune sources/exports and all179 artifacts each verified unchanged again.

Ulgani fourth source/export commit remains c8a90a0eb8a55529099e34bfd797c3e77533cd71.
Source assets/blend/characters/ulgani.blend
SHA256 d0ab87a61e5b50ccb336c03b14a1553b7b2b063c7935af334ba12218bc013bc7
Export packages/client/public/models/characters/ulgani.glb
SHA256 14d386eefd291892f3b3f2f0072c640e37a6f267fe73e4a4cb757c49db1caece
Both saved validators PASS5/5, fail0,warn0. No rebake, geometry authoring, postprocess, export or source save was run.
Original checkpoint/raw recovered source and ten original completed maps hash-verified; all recovery/failure evidence retained.
See HANDOFF_ULGANI_RECOVERY2_CPU.md for that recovery provenance, not current runtime commands.

All16 bounded CPU stages are now complete: portraits, ten individual turntable/material sets, grid, heads family, suits family, two bends.
Same standard resolution/cameras/light/samples: turntables48, portraits48, morphs32, bends24. CPU/denoiser, two threads.
Prior outputs were copied with verified hashes under ulgani4-prior-artifacts/ before replacement.
Every stage has exact start/end, controller/render/group/session/assertion IDs, command, source/input/output/script/log hashes and0 exit codes.
No CPU rendering failure occurred this window. All owned process groups drained at their recorded boundary.
Last render end ULGANI_CPU_ART_END2026-11-02T06:02:15.434103+00:00, session51954, controller/group32652, Blender32666, assertion32667; all0 and drained.
No GPU/browser capture was started this window. Durations are scheduling records only; no performance claim.

## Immutable reports

- assets/renders/characters/validate/ulgani-review4-cpu-ready.json (16 stages,61 artifact hashes)
- assets/renders/characters/validate/ulgani-review4-cpu-stages.json (all job evidence)
- assets/renders/characters/validate/ulgani-review4-cpu-studio.json (13 standard stages)
- assets/renders/characters/validate/ulgani-review4-cpu-details.json (portraits and two bends)
- assets/renders/characters/validate/ulgani-turntables.json (all ten current-source individual sheets)
- assets/renders/characters/validate/ulgani-review4-capture-only-preparation.json (helper/sampler hashes, commands and limits)
- assets/renders/characters/validate/characters__ulgani.blend.json and characters__ulgani.glb.json
- assets/renders/characters/validate/ixari-review5-parent-relayed-verdict.md
- Per-stage logs/jobs and persistent tool-session index: .claude/pause/characters-resume/ulgani4-cpu-*-job.json and ulgani4-cpu-session-index.json.

Hashes:
- ulgani-review4-cpu-ready.json: 5874b878a642efad27cd3c8bac28355a40f3b9d899885dc0d780aaabd68d1fe5
- ulgani-review4-cpu-stages.json: 01640743e5a7b0fb84ba7dac5d8dcd9ff5007f0e7925bc7abd1cd27e122cf836
- ulgani-review4-cpu-studio.json: b430c1d84fb798f8889fc28a67c071a5d4066e7205cce2d7b07e86237d5b8fa3
- ulgani-review4-cpu-details.json: f3faa36e385d9afc145f970be2e398e4782c30690fa83f1083037be9d2efd0cb
- ulgani-review4-capture-only-preparation.json: d1880e27788767a93b1b3c786b53a1978009f3edd093b575b31c78e2945dec86
- characters__ulgani.blend.json: cae00a9732eeda1505aca62ae3d28f0e527edd53dbaca68e6448bb3b500d5563
- characters__ulgani.glb.json: 1977aa5fc24d4441bf8c7118b6a7c00263fc808b2914609c8b17cc1db0bdf67b
- ixari-review5-parent-relayed-verdict.md: 660b0f70555c7e21ff4ad854a554bd91e9ee90e7e06dd6aa93f839e59018b8f8

## Next runtime — after separate parent GPU GO only

Do NOT run ulgani_gpu_pack.py: that old preserved controller rerenders the completed CPU stages.
Use the new bounded .claude/pause/characters-resume/ulgani4_capture_only.py.
Its read-only verification passes all16 cached CPU stages and61 artifact hashes, then exits without Blender/browser:
python3 .claude/pause/characters-resume/ulgani4_capture_only.py --verify-only

Actual future command (not started):
python3 -u .claude/pause/characters-resume/ulgani4_capture_only.py > .claude/pause/characters-resume/ulgani4-capture-only.log 2>&1
Sampler (not started; start after log exists and before parent releases gate):
python3 -u .claude/pause/characters-resume/sample_ulgani4_capture_load.py
It correctly labels Ulgani and retains top-host/test CPU context. ps pcpu is a process-lifetime average, never per-pair attribution.
Release ONLY gpu-review-release-ulgani after fresh identity/source/export/cache/harness review in the scheduled GPU window.
The new helper never invokes Blender or source/export tooling. It backs up old engine captures/run manifest, then runs exactly pnpm capture -- --review characters/ulgani.
Track actual controller/Node/browser detached groups, sampler and idle assertion. ULGANI_GPU_END is CLI completion; verify full descendant/group drain separately.
Preserve every raw error and unreliable timing result. T13 pass/query attribution remains unresolved; no scene-budget,60fps, regression or repaired-performance claim is supported by these raw captures.

After fresh engine capture: native/color and grayscale per-species100m lineups, shared three-species lineups, honest actual load/timing context,
python3 packages/tools/blender/characters/review_inventory.py ulgani 4, complete read-only grader manifest, then parent dispatches a fresh independent fourth Sol visual grade.
No self-grade. No fifth Ulgani revision before that fourth verdict and parent instruction.
Whole T01 remains incomplete; final code review remains. Parent alone edits orchestration documents.

## Attention

No new helper/reviewer was spawned, per parent no-helper instruction. Operational verification above is direct worker evidence, not a visual grade.
Known T13 performance attribution limitations and future browser/full179 inventory/grade gates remain open.
