# P1.E05.T01 independent whole-task code review

Verdict: REVISE — one P2 spec/rig contract finding. No visual regrade.

Candidate: d00d61ba5be3935f63feb7a91a8d0104d44e6cf7, whole diff from 00eed30402686fd717d8dd84d09e409dfd093ec9. Inspected the 29 implementation paths and all source/export contracts, with 982 full-diff paths enumerated. Read current main DESIGN 5/19.2, implementation rules 0.3/0.4/0.9.5 and art bible. Current-main decisions contain no species-specific rest-rig or translation-track exception.

## P2 — Resolve the unlogged species-specific rest-rig contract

Primary affected added files: assets/blend/characters/ixari.blend:1 and assets/blend/characters/ulgani.blend:1 (and their exports). Supporting code: packages/tools/blender/characters/audit.py:95-97 asserts hierarchy equality only and correctly cautions that hierarchy does not prove identical rest matrices.

art-bible.md:26 defines a shared 1.85 m skeleton scaled ±6% per people. The actual assets share 69 bone names, parent hierarchy and nearly identical rest orientations (max rotation-matrix drift below 4e-6), but they use independently proportioned rest translations/lengths, not a uniformly scaled rest skeleton. For example, Ixari/Thalune bone length ratios include ball_L 0.747 and neck_02 1.369; Ulgani/Thalune includes ball_L 0.657 and crest_01 2.121. No single per-people scale explains these.

This matters to the one-animation-set contract in DESIGN 5.1: a normal glTF animation containing neutral local bone-translation channels from Thalune does not preserve the peers' neutral pose. A CPU-only replay on the actual compressed exports leaves Thalune unchanged but moves 5,844 sampled Ixari vertices (max 0.0621105 m) and 3,795 Ulgani vertices (max 0.0644026 m). This is a conditional compatibility failure, not a claim that rotation-only animation cannot work. Rotation-track naming/orientation compatibility is supported; unrestricted absolute translation-track reuse is not.

Resolve before merging by either delivering the specified uniformly scaled rest rig or explicitly amending/recording the retained species rest-profile policy, with a real cross-species test for the intended animation/export channel or retarget policy. The latter can preserve all frozen appearance assets and does not require another visual grade. An unlogged spec interpretation is a mandatory REVISE under plan 0.9.5.

Reproduction: translation-replay.mjs / translation-replay.json / translation-replay.log in this directory. The replay strips material texture slots only in RAM to let GLTFLoader run without a browser; exact geometry, skin, morph, node and meshopt data are retained. It then applies Thalune's unchanged neutral local bone translations to each peer and measures the resulting world-space vertex changes.

## Passing independent checks

- Review unit tests: 21/21, one worker; client and tools typechecks pass; full diff whitespace check passes.
- Read-only Blender source validation: 3/3 files, 5/5 checks each, no failures/warnings. All 30 variants have LOD0 60–150k and four decreasing LODs, LOD3 below 5%.
- Source audit: one 69-bone armature per file, matching hierarchy/orientations, neutral pose and non-reference morph values; 27 facial keys on every LOD0 head. Packed source maps are all 4096² with expected colour/data spaces.
- Node meshopt decoding: all three GLBs, 96 skinned mesh nodes each; zero invalid/zero skin weights or out-of-range joints. All 120 variant/LOD triangle totals match saved sources exactly. KTX2 maps are 4k with 13 levels and required codec/geometry extensions present. This is structural inspection, not texture pixel/transcoder QA.
- Real Three geometry checks: all 120 variant/LOD bounds pass; 2,911 sampled posed+morphed wire-overlay points coincide with their source meshes.
- Real observer controls: 8/8 pass, including old self-observer reproduction, natural exit, live-child rejection, resistant descendant escalation and failed/timed-out observer cleanup.
- 786 hash bindings across 607 unique code/source/export/spec/artifact paths pass, including frozen peer inventories and Ulgani required/supporting packet artifacts.
- Current main's flora reviewHidden change is separate from the posed-bounds/wire path; read-only interaction inspection found no direct source conflict. No merged checkout behavior was tested.

Evidence: source-audit.json; source-weights.json; glb-audit.json; real-glb.json; translation-replay.json; bindings.json; validators/; review-tests.log; typecheck.log; observer-controls/report.json; cleanup.json.

## Limits and preservation

No GPU/browser/Metal bake/render/native trace, authoring mutation, export, fresh capture, source save, push, merge or subagent. No new performance qualification: T13 attribution/budget work remains open. No sixth visual grade and no reconsideration of the frozen component visual dispositions.

All nine long-running CPU commands completed with exit 0. Blender used at most two threads, with OPENBLAS/OMP limits of two. Observer fixture/controller/probe PIDs are independently absent; direct fixture children reaped. No owned jobs remain. Candidate remains clean at the frozen HEAD; all six canonical source/export hashes still match. Only fresh /tmp review evidence was written. Existing .claude recovery, raw Head1 failure, immutable packets, services and peer assets preserved.
