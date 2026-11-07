# P1.E05.T01 — Ixari fifth CPU studio complete; whole task incomplete

Worktree: /Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41
Branch: task/P1-E05-T01
Current HEAD: 38657e31f2a75f6c2c169a5d1e5c446203431f9c
Tracked tree clean, no push. No owned render/controller/watcher/caffeinate jobs remain.
Parent GPU timer probe is queued: do not start further art runtime until parent explicitly resumes.

All 13 standard studio stages are complete at unchanged resolution, 48 samples, CPU only, 2 threads:
six individual heads, four individual suits, 10-variant aggregate grid, six-head family, four-suit family.
Source and exported GLB were not changed or regenerated. Every recorded artifact SHA256 was rechecked after the
last stage. Final suits-family image was also inspected directly: four labelled rows/four views are present.
This is not a visual grade. CPU closeups/morph/hands and head1/suit3 bends remain verified from the earlier checkpoint.

Ixari source SHA256: 9779f0a9dc8b3a69257124bb962b0e51c526f9b80501d35833c02674e3fa2f0c
Ixari GLB SHA256: 1236d2bafed2d8a2c58eeb4ba6cf73501c669fbc7d7eda5d1fb3c260d34d243b
Main provenance: assets/renders/characters/validate/ixari-review5-cpu-studio.json
Combined individual catalog: assets/renders/characters/validate/ixari-turntables.json
Individual manifests: assets/renders/characters/validate/ixari-review5-cpu-<head1..6|suit1..4>-turntable.json
Grid/family manifests: ixari-grid-turntables.json, ixari-heads-family.json, ixari-suits-family.json in that same directory.

Commits in this window:
- 2e46737f9 suit4
- 9a8e42efa grid
- a314f0e68 heads family
- 38657e31f suits family/full studio completion
Earlier suite1–3 commits: aaba467ed, c8a1eebdd, c1ee5f771. All retained on this task branch.

Latest sessions — all exited0 and verified absent:
- suit4 Blender1451/PID91640, idle assertion96792/PID92333
- grid Blender77438/PID2386, idle assertion44732/PID3274
- heads Blender79419/PID19073, idle assertion98189/PID19147
- suits Blender42278/PID27679, idle assertion33597/PID27783
Local per-stage records/logs: ixari5-cpu-<suit4|grid|heads|suits>-<job.json|resume.log> under this staging directory.
No helpers were spawned. stop-ixari5-cpu-studio records the current hold.

## Next after explicit parent GPU GO

Both gpu-review-release-ixari5 and gpu-review-release-ulgani remain absent. No GPU controller is running.
The prepared .claude/pause/characters-resume/ixari5_gpu_pack.py verifies and skips all 13 completed CPU stages,
rebuilds the individual catalog, then runs only pnpm capture -- --review characters/ixari.
Use the parent-approved capture harness; T13 owns engine/review.js and this worker did not edit it.
Run the controller only after parent grants the exclusive GPU window and its specific release gate is created:
python3 -u .claude/pause/characters-resume/ixari5_gpu_pack.py > .claude/pause/characters-resume/ixari5-gpu-pack.log 2>&1
Once the log exists, run sample_ixari5_capture_load.py alongside; watch IXARI_GPU_END and drain both jobs.
The load sampler is review-session context only, not a comparative benchmark or60 fps proof.

After the browser pack, regenerate per-species native 100 m color/grayscale lineups from the ten fresh far_lod2.png
captures in head1..6, suit1..4 order, write fresh performance context, then:
python3 packages/tools/blender/characters/review_inventory.py ixari 5
Commit the complete fresh set and request independent fifth visual grading. Do not rerender these completed
studio artifacts unless source changes or verified corruption invalidates them.

Ulgani source/export checkpoint remains c8a90a0 (unchanged). Its fourth fresh portraits, studio, bends, browser,
lineups, inventory and independent grade remain; HANDOFF_ULGANI_RECOVERY2_CPU.md has exact next commands.
Thalune remains frozen after fifth REVISE; no sixth revision. Shared fresh lineups/final code review remain.
Parent alone edits IMPLEMENTATION_PLAN/PROGRESS/DECISIONS. Preserve all recovery files and old map/source checkpoints.

Attention: earlier recovery audit by gpt-6.1-sol(xhigh) found no flags. Current CPU studio completion, source/export
bindings, artifact hashes and full job drain were verified directly by this worker; independent visual grade remains.
