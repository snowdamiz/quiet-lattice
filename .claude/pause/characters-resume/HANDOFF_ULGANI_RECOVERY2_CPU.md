# P1.E05.T01 recovery2 CPU/source handoff — whole task incomplete

Worktree: /Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41
Branch: task/P1-E05-T01
Current commit: c8a90a0eb8a55529099e34bfd797c3e77533cd71
Ixari completed head checkpoint: 90bcdf23a
Tracked tree clean. No push. No live art/controller/watcher/caffeinate jobs.
Do not start runtime work until the parent explicitly resumes this worker after diagnostic profiling/smoke.

## Completed and verified

Ulgani fourth saved-source recovery is complete. No original geometry authoring was restarted.
The prior stopped groups disappeared before any SIGCONT; their death cause remains unknown.
Recovery2 re-opened the exact preserved pre-bake checkpoint, matched all30 mesh geometry/UV/weight hashes,
rig/landmark/coverage/authoring-library records, fully decoded ten completed4096x4096 maps and reused them
byte-identically. Only missing SuitA/B maps were baked, followed by the original assembly/LOD/save suffix.
Actual process sampling proves Cycles Metal GPU execution (original mixed CPU+METAL configuration).
ULGANI_GPU_BEGIN: 2026-11-02T03:31:59.814428+00:00
ULGANI_BAKE_END: 2026-11-02T03:33:40.734468+00:00
AUTHORING_SAVED: 2026-11-02T03:33:53.123516+00:00
Recovery session17530 and idle-only caffeinate95334 both exited0.

Raw recovered source: .claude/pause/characters-resume/ulgani.blend
Raw SHA256: 9e3f5218c9ba897cb99fd662682aad1b4530759085d9c8b0d96579869a71a437
Final source: assets/blend/characters/ulgani.blend
Final SHA256: d0ab87a61e5b50ccb336c03b14a1553b7b2b063c7935af334ba12218bc013bc7
Final export: packages/client/public/models/characters/ulgani.glb
Final SHA256: 14d386eefd291892f3b3f2f0072c640e37a6f267fe73e4a4cb757c49db1caece
Source and compressed GLB validators each PASS5/5,fail0,warn0.
pnpm art:validate -- characters: PASS3/3 sources.
Objective source audit: matching69-bone hierarchy; ten variants per species; Ulgani LOD0 range87,666–146,000;
four LODs, packed4K PBR, facial morphs. This is not a visual grade.
Final-source postprocess completed on a working copy; raw source/maps were retained.
Previous final .blend/.glb are preserved under before-ulgani-recovery2/ with a hash manifest.

The first export attempt failed because my CPU-limit wrapper supplied a short argv0, so Blender could not find
its app resources. Corrected wrapper to full executable path, retained the failure log/crash, and retried export
only. No trimming, AO adjustment or other non-idempotent stage was repeated.
Postprocess session77689 exited1 at export; its idle assertion43404 exited0.
Export/validation retry session40589 and idle-only caffeinate72430 both exited0.
ULGANI_CPU_SOURCE_FINISH: 2026-11-02T03:44:34.840823+00:00
Blender2threads; one KTX job capped at2threads. No art/browser jobs remain.

Ixari fifth source/export remain unchanged:
source9779f0a9dc8b3a69257124bb962b0e51c526f9b80501d35833c02674e3fa2f0c
export1236d2bafed2d8a2c58eeb4ba6cf73501c669fbc7d7eda5d1fb3c260d34d243b
All six saved head studio sheets and provenance pass hashes; committed90bcdf23a.
Interrupted suit1 temporaries were retained at ixari5-interrupted-studio-tmp-20261102/.
No Ixari CPU studio job was restarted. Its fifth GPU controller skips verified completed head sheets.
Thalune is frozen after fifth REVISE. No sixth revision.

## Evidence and preserved recovery

- assets/renders/characters/validate/ulgani-checkpoint-recovery2.json
- assets/renders/characters/validate/ulgani-recovery2-device-evidence.json
- assets/renders/characters/validate/ulgani-recovery2-cpu-finish.json
- assets/renders/characters/validate/ulgani-authoring.json
- assets/renders/characters/validate/characters__ulgani.{blend,glb}.json
- assets/renders/characters/validate/source-audit.json
- .claude/pause/characters-resume/ulgani-recovery2.log
- .claude/pause/characters-resume/ulgani-postprocess2.log (retained failed export)
- .claude/pause/characters-resume/ulgani-postprocess2-export-retry.log
- .claude/pause/characters-resume/ulgani-export-wrapper-crash.txt
- .claude/pause/characters-resume/ulgani-recovery1-preserved.json
- .claude/pause/characters-resume/ulgani_before_bake.blend (unchanged)
- .claude/pause/characters-resume/textures/ulgani/ (original completed maps, unchanged)
- .claude/pause/characters-resume/textures/ulgani-recovery2/ (complete raw bake maps, retained)
- .claude/pause/characters-resume/textures/ulgani-postprocess2/ (separate processed maps)
- .claude/pause/characters-resume/ACTIVE_SOL_RESUME.json and characters-sol-decisions.tsv

The prepared finish_ulgani_source.py now requires recovery2 report/hash and refuses to repeat source postprocess.
Do not rerun it or the completed export retry blindly. Current source/export are already final CPU checkpoints.

## Next artifact commands — after parent runtime GO only

Run all commands with this exact worktree as cwd; verify branch and hashes before any runtime.
Both review gates gpu-review-release-ixari5 and gpu-review-release-ulgani are currently absent.
No controller is running. Release only the parent-scheduled gate and run only one GPU pack at a time.

Ixari fifth remaining studio/browser pack (four suits, grid, families, capture; reuses six CPU heads/details):
python3 -u .claude/pause/characters-resume/ixari5_gpu_pack.py > .claude/pause/characters-resume/ixari5-gpu-pack.log 2>&1
Run sample_ixari5_capture_load.py alongside it after its log exists. Observe IXARI_GPU_END; drain both jobs.
Use the parent-approved capture sampler/harness; T13 owns engine/review.js, which this worker did not edit.

Ulgani fourth requires fresh portraits before inventory (the prepared GPU pack does not produce these):
/Applications/Blender.app/Contents/MacOS/Blender -b assets/blend/characters/ulgani.blend -t 2 --python-exit-code 1 -P packages/tools/blender/characters/render_details.py -- portraits GPU ulgani assets/renders/characters
Then standard studio, bendtests and browser pack:
python3 -u .claude/pause/characters-resume/ulgani_gpu_pack.py > .claude/pause/characters-resume/ulgani-gpu-pack.log 2>&1
Run sample_ulgani_capture_load.py alongside after its log exists. Observe ULGANI_GPU_END and drain both jobs.
Fresh filtered ulgani_heads.blend / ulgani_suits.blend and their source/hash sidecars are ready and verified.

After each pack, make per-species100m native/color and grayscale lineups with
packages/tools/blender/characters/lineup.py from all ten fresh far_lod2.png captures in head1..6,suit1..4 order.
Write fresh performance context scoped to the actual review session; no performance repair is claimed here.
python3 packages/tools/blender/characters/review_inventory.py ixari 5
python3 packages/tools/blender/characters/review_inventory.py ulgani 4
Then commit and request independent visual grades. No self-grading.
Regenerate the shared three-species lineups only after all current captures are fresh.
Final code review remains. Ulgani may receive its authorized fifth revision only after its fourth fresh grade.
Parent alone edits IMPLEMENTATION_PLAN, PROGRESS and DECISIONS.

## Attention
reviewed by gpt-6.1-sol (xhigh)
Read-only recovery audit snapshot03:34:39UTC: No flags on trail, exact map reuse/source invariants or original suffix.
Later export/postprocess completion was directly verified by the worker; the audit is not a visual grade.
