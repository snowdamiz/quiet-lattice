# Appendix C.1 — P1.E10.T08 source-author brief

**Prepared only. No author capacity has been admitted. No capture or city-file transfer is authorized by this document.** The parent may dispatch this complete unit only after it explicitly serializes the two city source/export pairs below and supplies a fresh resource budget. Until then this is a ready brief, not an active author assignment.

You will implement one task of `docs/IMPLEMENTATION_PLAN.md` in a parent-assigned isolated worktree, on proposed branch `task/P1-E10-T08-anchors-monoliths`, based on parent `c3c82e0fdf6ec342645c9c30f0800bc5104ffcb9` plus the six exact anchor inputs in the accompanying `REPORT.md`. Verify cwd, branch, HEAD/tree and clean input hashes before editing. Do not work in the parent or any existing city/effects/props/den worktree.

TASK (verbatim):

> - [ ] **P1.E10.T08 (art) Anchor stones and monoliths** · deps: E14.T02 · done: three anchor stones as landmarks; the three monolith variants rebuilt; glyph alphabet applied. → `[R]`

SPEC: Read DESIGN 2 (Cartographers/network/creed), 5.1–5.4 (capital anchors and placement), 19.1–19.4 (authorship, quality, asset inventory, markers), and 20.3 (later removal). Read art bible 1, 2, 3, 4, 5 and 8. Rules are IMPLEMENTATION_PLAN 0.3, 0.4, 0.9.2, 0.9.5 and 0.10; reporting is C.2. Read DECISIONS 2026-11-07 entries “Art authorship and later gameplay adoption” and “Crystal decoration and the reserved glyph language.” These establish source-art versus gameplay ownership. User/parent holds override generic shipping instructions.

The formal E14.T02 dependency is `[x]`. E10.T01, T02 and E14.T07 are later consumer owners, not new dependencies of this source unit. Do not implement their runtime behavior.

## Exact source/export inventory

The complete inventory is six semantic assets, six source/export pairs and 24 LODs. Three are existing capital landmarks, not six new sculptures. Packaging one monolith per file is the simplest proposed file-layout choice, not an extra spec requirement.

| Source under assets/blend/ | Export under packages/client/public/models/ | Top-level asset = sole variant | Class | Required work |
|---|---|---|---|---|
| cities/thalune_anchor.blend | cities/thalune_anchor.glb | anchor_sarelun | hero | Reuse pinned 49 m Sarelun anchor and canonical inscription; audit, preserve by default |
| cities/ixari_anchor.blend | cities/ixari_anchor.glb | anchor_quavel | hero | Reuse pinned 52 m anchor; add canonical inscription in saved source after city-owner release |
| cities/ulgani_anchor.blend | cities/ulgani_anchor.glb | ulgani_root_island_landmark | hero | Reuse pinned root-island/48 m blade; apply canonical inscription after city-owner release |
| sites/monolith_0.blend | sites/monolith_0.glb | monolith_0 | building | Rebuild the obelisk silhouette as original saved art; suggested height 22 m |
| sites/monolith_1.blend | sites/monolith_1.glb | monolith_1 | building | Rebuild the pointed-arch silhouette as original saved art; suggested height 24 m |
| sites/monolith_2.blend | sites/monolith_2.glb | monolith_2 | building | Author the required third distinct cleft upright stone; suggested height 20 m |

The named monolith silhouettes/heights beyond the two legacy references are recommended author choices within DESIGN and the 18–26 m art-bible band. There is no supported three-people/three-branch assignment. Do not invent one. Do not ship regenerated demo primitives or recolored duplicate silhouettes.

Each source has metric units, +Z up, ground origin and applied transforms; exporter maps to +Y up. Top-level `REF` contains a hidden 1 m 20×20 grid and 1.85 m biped and is excluded from export. Each asset contains `<asset>_LOD0` through `_LOD3`; colliders/point markers sit beside LOD collections. The single-variant exported layout is `<asset>/<asset>_LOD<n>`. Do not create a needless duplicate variant container. Work collections begin `_`. Names obey stock rules.

Keep Sarelun shoals/wading/no permanent bridge; Quavel independent summit placement; Belost island/approach and root scale. Do not stretch an anchor to a planner tower band. Belost's complete island bounding height is not its 48 m blade height; retain both measurements. Existing placements, roots, colliders, route clearance and marker coordinates are frozen unless an actual necessary inscription intersection is reported to the parent.

## Files and ownership

Read the input source manifests, current correction reports and all files you will edit in full before edits. Restore inputs only from the exact pins/pointers in REPORT.md, after verifying local payload SHA256. No whole-branch import, LFS fetch or hydration is authorized by this preparedness package. Parent already has the stock pipeline, library and alphabet at matching blob identities.

**New files owned by this future unit:**

- `assets/blend/sites/monolith_0.blend`, `monolith_1.blend`, `monolith_2.blend` and their exact `packages/client/public/models/sites/` GLBs.
- Task-local evidence only under `assets/blend/sites/anchors_monoliths/`: `manifest.json`, `APPENDIX-C2.md`, `SHA256SUMS`, immutable per-attempt stock/source/export/CPU-consumer reports and a declarative native-output inventory. Do not write another task's receipts or reports.
- Task-local source/audit code: `packages/tools/blender/anchors_monoliths/author.py`, `audit.py`, `consumer.test.js`, `consumer.config.mjs`. Author code records sculpting/saved-source edits; stock export must never invoke it. Audit code checks actual saved and exported assets. Do not build a capture framework or generic lifecycle service.
- CPU sheets only under new revision directories in `assets/renders/anchors_monoliths/`, within the resource/image budget the parent actually admits.

**Conditional serialized writes, currently still city-owned:**

- `assets/blend/cities/ixari_anchor.blend` and `packages/client/public/models/cities/ixari_anchor.glb`, input `ec2857d0cf112d77c54b2b10ad871248b4c38340`.
- `assets/blend/cities/ulgani_anchor.blend` and `packages/client/public/models/cities/ulgani_anchor.glb`, input `7d738a0f6eb1b71275bed05da3bb31a2bbc52b0a`.

The parent must transfer these four paths before dispatching the full author unit. Their old reviews/artifacts retain original identities. Write new T08 input/output provenance; never overwrite old city manifests to make their SOURCE PASS refer to new glyph bytes.

**Read-only inputs:** Sarelun pair at `83eec91beca01e454794017ce95a0e744eb395ab`; all other city art/evidence; effects at `d16b7e41b1c662cc4005a9322f60a8d3522dd219`; shared glyph TS/SVG/library; exporters, `families.json`, validators and `artlib`; Review/capture classes and lifecycle; legacy builders for reference only. If actual saved/export glyph auditing finds a required Sarelun change, stop that component and report exact geometry/material evidence for a narrow ownership extension. Do not silently rewrite it or falsely count unmeasured properties as PASS.

Do not edit: `Structures.js`, `modelLibrary.js`, `universe/Planet.js`, `world/ground.ts` (den owner); props, `beacon_*`, `outpost_*` (props owner); `den_*`; `Game.js`, `Cities.js`, city planner/renderer, services, Recall/Count/gameplay, glyph definitions, shared pipeline, package manifests/locks, Review/capture code, screenshots/history, IMPLEMENTATION_PLAN, PROGRESS or DECISIONS. No loader hook is needed. Any file outside the list requires a concrete report to the parent, not incidental expansion.

## Glyph and material contract

Consume `packages/shared/src/art/glyphs.ts` (Git blob `35018f3099134ae1124faa7a051e4f930755f02b`, SHA256 `8f4ad4410689222515b56039555e775aad9869cb22f6fcaff35351a0f4ac0bac`). Canonical data: 23 letters plus divider; C and N0–N5; N0 up and clockwise; S/R strokes; no sign rotation; top orientation notch. Transliterations: c/q→k, x→ks, spaces→divider. Validate the extraction against all 24 records without maintaining a parallel hand-written alphabet.

Effects already owns `recall_glyph_a`…`recall_glyph_z` for the actual 23-letter inventory plus `recall_glyph_divider`; see its manifest, not an imagined full Latin a–z range. Those are effect-class one-LOD light meshes. Keep that bundle/readiness/capture work unchanged. Apply the existing canonical signs to stone; do not author a second font collection or replace Recall.

Recommended inscriptions: existing `sarelun` remains; Quavel transliterates to `kuavel`; Belost is `belost`. The three monoliths may use the existing creed `the stars belong to no one` in columns, with dividers, rather than invented story text. This wording is a logged choice, not a missing dependency or a demand to display every glyph on every asset.

On stone, glyphs are incised 0.02–0.04 m in a V-section, with stroke width 8% of sign diameter, round caps, no serifs, and top-to-bottom columns. Prefer mesh cuts and an interior light core. A separate floating effect surface does not establish a cut. A separately authored face object must be incorporated into the saved anchor/export; there is no existing Review composition of external anchor-plus-glyph assets.

Stone uses basalt `#2A2C30`, weathered basalt `#4A4D52` and `LIB_Basalt` or documented appended material variants. Canonical glyph emission uses `LIB_GlyphLight*`, core `#D8F6FF`, halo `#7FD8FF`; it is reserved for the network. Keep people's existing shell/crystal/root environment and its palette, including Quavel's corrected lilac crystal growth. Do not recolor all architecture into glyph cyan or restore old ribbons.

Full PBR maps for stone: baseColor, roughness, metallic, normal and occlusion; emissive map where used. `LIB_GlyphLight*` has the stock signal-profile exemption. Reuse/link/append the existing library; do not alter it. Packed images and material bindings must survive reopening the source; no transient procedural build is the only source of truth. Normal+height glyph cuts are permitted by the bible only if actual source height and exported normal/material evidence establish the cut, without assuming unsupported runtime displacement. Mesh cuts are the recommended default.

| Budget | Anchors | Site monoliths |
|---|---|---|
| LOD0 | 60,000–150,000 triangles | 8,000–60,000 triangles |
| Textures | 4096 px | 2048 px |
| GPU texture limit per variant | 512 MiB | 128 MiB |
| LODs | 4 | 4 |
| Height | anchor stone 40–60 m; preserve current dimensions | 18–26 m |
| Stock longest-axis limit | 0.5–400 m | 1–250 m |
| Recommended architectural density | 256 px/m with trims | 256 px/m with trims |

Every lower LOD is lighter; LOD3 is strictly below 5% of LOD0. Missing lower LODs may be stock-decimated at 0.30/0.10/0.035, but glyph/readability evidence must inspect the result. Do not pad triangle counts with invisible junk. Density follows the building/landmark interpretation recorded for Ulgani, not the hull's 512 px/m target; record that choice. Measure modified/new source surfaces and decoded export with world-space metric geometry, actual UVs, texture size and normalized accessors. Check weaker-direction sampling and anisotropy; report degenerate surfaces separately. Map dimensions alone do not prove density. Preserve inherited disclosures; do not relabel prior assets.

Export every map as KTX2 through unchanged stock settings: normals UASTC+Zstd, color/emissive and ORM ETC1S, correct sRGB versus linear and full mips, no PNG fallback. Meshopt plus required quantization extensions; preserve marker/LOD transforms. Check cuts survive quantization on the decoded final geometry. Do not loosen shared bit depth or budgets to force a pass; report a proven need.

Every site has simple `COL_*` mesh(es), each ≤512 tris, and at least one reachable `Interact*` empty. Preserve anchor `Interact_Anchor*`, Sarelun Recall marker and named light markers. Additional canonical glyph-light markers may be added only with accurate `color`, `intensity`, `distance` extras; existing architecture lights remain. `Light_*` markers are not by themselves rendered emissive glyph geometry. No new Spin/Blink behavior is required; retain such markers only for actual authored components. Approaches must reach the interact point without passing through solid collision. This is source/CPU collision proof, not new gameplay routing.

## Verification commands and evidence

All commands below are **future**, run from the isolated author root only after fresh parent admission. The parent supplies the bounded CPU/toolchain invocation and resource limits; these raw stock commands are not an unbounded-process grant. The stock Node launcher does not itself add Blender -t 2 (targets.ts:174-175); the admitted invocation must enforce the assigned process/thread/codec limits through its existing supervisor or direct stock-script argv. Do not assume an environment variable alone proves a thread cap. Use already installed pinned tools; no first-use install/download is allowed. `art:export` and GLB validation may call the codec; require its admitted lane too. Validate immutable snapshots and use fresh report directories for each attempt; the stock exporter can remove stale output on failure.

Preflight (cheap):

```sh
pwd
git branch --show-current
git rev-parse HEAD HEAD^{tree}
git status --porcelain
```

Stock source validation (six exact inputs; also pass a fresh task-owned `--report-dir`):

```sh
pnpm art:validate -- assets/blend/cities/thalune_anchor.blend assets/blend/cities/ixari_anchor.blend assets/blend/cities/ulgani_anchor.blend assets/blend/sites/monolith_0.blend assets/blend/sites/monolith_1.blend assets/blend/sites/monolith_2.blend --report-dir assets/blend/sites/anchors_monoliths/verify/source-01
```

Export **only** this unit's three new site sources and two released amended anchors. Do not re-export the unchanged Sarelun by default, and never run a whole-family export that selects props/dens/other city kits:

```sh
pnpm art:export -- sites --only monolith_0,monolith_1,monolith_2 --report-dir assets/blend/sites/anchors_monoliths/verify/export-sites-01
pnpm art:export -- cities --only ixari_anchor,ulgani_anchor --report-dir assets/blend/sites/anchors_monoliths/verify/export-anchors-01
pnpm art:validate -- packages/client/public/models/cities/thalune_anchor.glb packages/client/public/models/cities/ixari_anchor.glb packages/client/public/models/cities/ulgani_anchor.glb packages/client/public/models/sites/monolith_0.glb packages/client/public/models/sites/monolith_1.glb packages/client/public/models/sites/monolith_2.glb --report-dir assets/blend/sites/anchors_monoliths/verify/exports-01
```

The real path is `package.json` → `packages/tools/src/art/cli.ts` → `export_sites.py`/`export_cities.py` → `artlib.export.main`; `--only` matches flat `.blend` stems. Do not put monolith sources in a nested folder the stock glob ignores. Never ship `--no-compress` output. Stock export never saves `.blend`; verify source hashes unchanged across export.

Task audit must inspect actual saved source and decoded exports for exact six-root/24-LOD inventory, classes/bounds, glyph sign construction/orientation/stroke/depth, maps/density, markers, collider/approach fit and preservation of unaffected city geometry/UVs/material routes. Use the real Review `collectLods`, `showLod`, `targets` contract on actual artifact hierarchy in the task-local consumer test. Use the existing Ixari NodeIO/Meshopt/Three CPU consumer as a read-only precedent. Do not mock the art payload or count metadata-only assertions as geometric proof. Future focused invocation after implementing its listed files:

```sh
pnpm exec vitest run --config packages/tools/blender/anchors_monoliths/consumer.config.mjs
```

Include actual glyph geometry/material negative controls for a changed stroke, flipped orientation, shallow/paint-only incision and missing emitted sign—not merely parser self-consistency. Bind each test/audit report to source/export hashes and report exactly what ran. Any audit-specific command line must be written into C.2 verbatim, with status and failures. All mandatory checks must pass before reporting source-complete.

CPU turntable/material-sheet stock interface (separately admitted render work, not this research):

```sh
pnpm turntable -- packages/client/public/models/sites/monolith_0.glb assets/renders/anchors_monoliths/source-01/monolith_0 --asset monolith_0 --variant monolith_0 --manifest assets/blend/sites/anchors_monoliths/verify/monolith_0-turntable-01.json
```

Repeat by exact source/export/selector for the six inventory rows, producing eight-angle turntable and material close-up sheets for each. A retained unchanged anchor sheet can be reused only if its hash/pin/required view contract actually matches. Add a close-up establishing glyph cuts and a sibling comparison within the admitted image budget; these do not replace native evidence. Capture framework changes are outside the file list.

## Real Review load path and queued native work

No gameplay loader change is required. Review loads one URL directly and reads the export's real asset/LOD hierarchy:

- `#review:cities/thalune_anchor:anchor_sarelun`
- `#review:cities/ixari_anchor:anchor_quavel`
- `#review:cities/ulgani_anchor:ulgani_root_island_landmark`
- `#review:sites/monolith_0:monolith_0`
- `#review:sites/monolith_1:monolith_1`
- `#review:sites/monolith_2:monolith_2`

`Review.load` → `gltfLoader().loadAsync('/models/<family>/<stem>.glb')` → `collectLods` → `select/showLod`. It removes old content when loading the next file; separate glyph files are not automatically composed with anchors. Review lighting/LOD visualization does not require city renderer T01.

**Do not execute native commands as the source author.** Capture is already queued and stays with its existing parent-assigned owner. Stock interface for that owner after exact candidate/source review and new native admission:

```sh
pnpm capture -- --review cities/thalune_anchor --asset anchor_sarelun --variant anchor_sarelun
pnpm capture -- --review cities/ixari_anchor --asset anchor_quavel --variant anchor_quavel
pnpm capture -- --review cities/ulgani_anchor --asset ulgani_root_island_landmark --variant ulgani_root_island_landmark
pnpm capture -- --review sites/monolith_0 --asset monolith_0 --variant monolith_0
pnpm capture -- --review sites/monolith_1 --asset monolith_1 --variant monolith_1
pnpm capture -- --review sites/monolith_2 --asset monolith_2 --variant monolith_2
```

For each exact target, retain 1920×1080 noon-lush/night-exotic/open-space at LOD0 and LOD2; wireframe at LOD0 and LOD2; collider/marker overlay; 100 m LOD2 silhouette (also 200 m for anchors); standard contact sheet and `perf.json`. Planned stock count is 69 PNGs + six perf JSONs, plus twelve CPU turntable/material sheets and any explicitly admitted supplements. Use new revision directories through the existing caller's `captureReview` `outDir` option if the stock default output already exists; the CLI does not expose `--out-dir`. No old evidence overwrites, cleanup or new capture framework.

The source manifest/native inventory must enumerate all six selectors, files, exact source/export SHA256, expected artifact paths and status `NOT_RUN/PENDING_CAPTURE_OWNER`. Bind real future native output to actual app/caller/device/camera/lighting/LOD identities. Do not claim a material/shader/60-fps/native PASS from CPU parsing. The blind grader receives only the task/spec/bible/rubric and actual artifacts (0.10.3), with PASS only if all criteria ≥4 and mean ≥4.5. Prior SOURCE PASS labels stay on their old pins; this task does not grade/relabel them.

## Report and stopping boundary

Report in Appendix C.2: TASK; STATUS; SUMMARY; FILES CHANGED; VERIFY with exact commands/results and last 20 failure lines; DECISIONS as question→choice→why; OUT OF SCOPE FOUND; ARTIFACTS with immutable paths/hashes. Explicitly distinguish `SOURCE COMPLETE / NATIVE AND VISUAL PENDING` from whole-task DONE; do not mark whole T08 DONE without its outstanding visual gates. State any ownership or capacity refusal as the specific real gate.

After source checks and permitted artifacts pass, commit only to the assigned branch with `P1.E10.T08: Anchor stones and monoliths`. Do not edit parent plan/progress/decisions. Do not push, create PRs, enqueue or merge. The parent owns any later integration and Trunk authorization. No nested workers or new capture work are part of this brief.
