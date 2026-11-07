Superseded by HANDOFF_IXARI_REVIEW5_CPU_STUDIO_COMPLETE.md at 38657e31f2a75f6c2c169a5d1e5c446203431f9c. All13 CPU studio stages are now complete; retain the below historical boundary notes.

# P1.E05.T01 CPU boundary hold

Worktree: /Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41
Branch: task/P1-E05-T01
HEAD: c1ee5f771f34560a04d0a87f621d79ca63005b5a
Tracked tree clean; no push. Parent requested stop after suit3. No further art runtime until parent resumes.

Completed standard CPU-only suit sheets at unchanged resolution,48samples,2threads:
- suit1 aaba467ed; Blender25139/PID6322 and idle assertion66468/PID6781 exited0.
- suit2 c8a1eebdd; Blender99847/PID14307 and idle assertion24322/PID14520 exited0.
- suit3 c1ee5f771; Blender35609/PID20454 and idle assertion91254/PID20559 exited0.
All render/assertion jobs and finite log watches drained. No owned jobs remain.
Six heads plus suits1–3 have fresh sheets/manifests and verified artifact hashes in
assets/renders/characters/validate/ixari-review5-cpu-studio.json (9 of13 stages complete).
Per-asset local records/logs: .claude/pause/characters-resume/ixari5-cpu-suit{1,2,3}-{job.json,resume.log}.
The successful turntable runner cleaned its temporary directory; completed sheets/manifests are committed.
Earlier interrupted source/recovery material remains intact.

Unchanged Ixari source SHA256: 9779f0a9dc8b3a69257124bb962b0e51c526f9b80501d35833c02674e3fa2f0c
Unchanged Ixari GLB SHA256: 1236d2bafed2d8a2c58eeb4ba6cf73501c669fbc7d7eda5d1fb3c260d34d243b
Unchanged Ulgani source SHA256: d0ab87a61e5b50ccb336c03b14a1553b7b2b063c7935af334ba12218bc013bc7
Unchanged Ulgani GLB SHA256: 14d386eefd291892f3b3f2f0072c640e37a6f267fe73e4a4cb757c49db1caece
No geometry, postprocess or export was rerun this CPU window.

Next keys after explicit parent resume: suit4,grid,heads,suits. Run one bounded asset at a time.
Next CPU command from this worktree, with OPENBLAS_NUM_THREADS=2 and OMP_NUM_THREADS=2:
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 -P packages/tools/blender/characters/cpu_turntables.py -- assets/blend/characters/ixari.blend assets/renders/characters --samples 48 --variant ixari_suit4 --manifest assets/renders/characters/validate/ixari-review5-cpu-suit4-turntable.json
Record each completed key/artifact hashes in ixari-review5-cpu-studio.json.
Grid uses --grid10 and manifest ixari-grid-turntables.json; family inputs are saved ixari_heads.blend /
ixari_suits.blend under this staging directory, --family, manifests ixari-heads-family.json / ixari-suits-family.json.
The stop-ixari5-cpu-studio marker records the parent hold; clear only after later CPU resume.

Both GPU review gates remain absent. The prepared ixari5_gpu_pack.py skips all nine verified completed individual
stages; a later exclusive GPU GO can finish suit4/grid/families and browser captures. It must not run under CPU-only GO.
Fresh lineups/performance context/inventory and independent fifth grade remain.
Ulgani fourth portraits/full studio/browser/grade remain untouched; HANDOFF_ULGANI_RECOVERY2_CPU.md lists commands.
Thalune is frozen after fifth REVISE, no sixth revision. Shared fresh lineups and final code review remain.
No helper was spawned this CPU window. Earlier recovery audit by gpt-6.1-sol(xhigh): no flags; current CPU sheet
hashes and job drain were verified directly by this worker. No visual grade assigned.
