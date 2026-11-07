# Lark evidence preparation — incomplete proofs are explicit

Source-only correction of `6ecfd1fad8a1ca03554b8f0afb1960a1c87bbc4f`. No Blender, export, render, GPU, browser, or visual acceptance was performed for this correction. The Python behavior tests do not validate Blender integration or captured pixels.

The former `cockpit-closed-canopy.png` was a translated **standing** mesh, with no seated joint pose or verified canopy closure. It is removed from this tool. Subtracting 1.2 m from `PilotSeat` does not establish a cockpit floor, seated anatomy, or headroom. Unsigned point/vertex distance and a nonintersecting centre line cannot establish body clearance, containment, or continuous collision. Those measurements and the misleading clearance receipt are removed, not relabelled as proof.

The script cannot enable seated/closed-canopy or mounted-clearance proof through an argument, marker name, identity transform, or supplied boolean. Its schema is now `lark-evidence-prep/2`. These fields remain `not_verified` or `not_measured`, and `plan.skipped` lists the missing verification work.

## Current source and evidence read

The read-only author checkout is `/Users/andreyyurlov/.t3/worktrees/space/t3-7d211d96`, pinned at `6445c7ec07aa2a08b722aeca22d56132154ea32c`. The canonical `assets/blend/hulls/lark.blend` was hashed directly without loading Blender:

```
d48d83e9c6a76b0214028a80389a77d6dfd19f65704c73ffc9f47dca58b244ba
```

The capture refuses any other blend hash before creating output. A future candidate needs a reviewed pin update; do not use an older source or the review scratch blend as a substitute.

Read in full:

- `docs/review-records/p1-e12-t02/lark-blind-visual-8b6c360/VERDICT.md`: prior visual REVISE, including seated/boarding body, closed canopy, livery and mounted-axis evidence gaps. Its visual observations belong to that earlier packet, not this candidate.
- `/tmp/lark-6445-independent-geometry/REPORT.md`: latest independent source/CPU review, including incompatible local frame/glass tests, unresolved structural plate denominator, and marker representation without mounting/clearance qualification.
- Author `packages/tools/blender/hulls/lark-round5/capture-preparation-next.json`, SHA-256 `31c97e860914ad704e365ae20b44409b0bffb5d6c0c4b3715c11e2c33e073478`.
- Author `packages/tools/blender/hulls/lark-round5/prepare_capture.py`, SHA-256 `51f7fde453af8419de5361cbc03b04300f0e26069b94e976dabca8f8cd0d4377`.

The author setup uses an anthropometric segmented **proxy**, not a production actor. Its hip-to-crown and leg dimensions do not verify a rig pose. Its canopy angles are diagnostic world-X samples, not authored limits or proof of closure. The nearby-Body envelope is a **module proxy**, not mounted equipment. The three livery copies use saved material graphs and two `lark_livery_` images; this establishes a source preview mechanism, not runtime selection or perceptual distinction. This tool neither consumes that scratch setup as proof nor edits its owner’s files.

## Evidence this tool can prepare later

- `standing-reference-scale.png`: the evaluated saved `REF_Biped`, translated only to `BoardingFoot` XY and the measured horizontal `REF_Grid` plane. A flat contrasting display material makes the saved reference visible without changing its geometry. The receipt records its vertical extent and whether it is within 0.02 m of 1.85 m. This is a standing-reference comparison, not a production-actor stature or boarding/contact test. Grid edges are displayed as rods at their actual world coordinates. One-metre spacing is reported only from multiple line intervals in both directions; a single one-metre edge is insufficient. Missing/tilted/ambiguous references skip the image. The grid plane is not certified ground.
- `colliders-marker-axes.png`: edge displays of source colliders and RGB XYZ rods along evaluated marker matrix columns. Columns retain scale/shear in the receipt; display rods have equal length. The image makes no module-forward, intersection, containment or reachability claim. Direct mesh children are recorded as hierarchy only; `mounted_module` remains `not_verified` even when a child is named “Weapon”.
- `livery-lineup.png`: three cells at the same camera, lighting and geometry scale: **saved default, compact, working**. Damage and husk are not liveries. Only materials assigned to evaluated base-LOD0 faces count. The active material output is followed; unused materials/nodes cannot satisfy the gate. Required paint materials must resolve a base-color image, and every swapped base-color node must use the same default payload and colour/alpha interpretation. All active image dependencies must have clean packed bytes; a filepath alone is insufficient. Alternate packed payload hashes must differ. Different encoded files do not certify different decoded pixels or visual identity. Swaps use copied material graphs and are restored in memory.

Source geometry is baked from the evaluated dependency graph into a separate capture scene. Rendered snapshots and measurements share the same evaluated world matrices, with parent chains, frame/subframe, units and ownership recorded. No modifiers, parents, source lighting or compositor are carried into the capture scene. Linked libraries and unresolved material groups are refused because their dependencies are not established by this tool.

Selection follows the source collection convention in `artlib/scene.py`: meshes from `lark/lark_LOD0`, plus shared collider/marker objects under `lark`. Other LODs, damaged/husked collections and `_` work-in-progress collections are excluded; contradictory ownership is refused. References must be exact names in `REF`; there is no `.001` fallback. The initial tool supports the base variant only. It cannot qualify every variant/LOD.

## Exact remaining inspection and capture prerequisites

1. The parent must release the resource lane and authorize Blender inspection/capture. The density reviewer currently owns CPU Blender work. None of the command below has been run for this correction.
2. Inspect the pinned source in Blender: confirm the base/shared/REF collection assignments, scene units, saved frame, evaluated geometry and material dependencies. Confirm the reference is visibly standing and its measured height/grid display are correct. Check the new scene, camera framing, visible scale reference, edge displays and stitched colour handling. CPU-only Python tests cannot establish these Blender API or visual facts.
3. For seated evidence, identify and load the actual production actor/rig; record asset identity/hash and standing 1.85 m stature. Establish an actual seated joint pose with seat/pelvis/feet/hand contacts and evaluated actor world transform. If only a posed proxy is available, label every image/receipt **PROXY — production actor fit unverified**. Keep the production seated proof skipped.
4. For closed canopy evidence, obtain the authored closed target/state and tolerance, evaluate the canopy pivot, frame and pane world transforms at that state, and verify closure against the actual sill/frame in a common world frame. Zero rotation, a saved pose, or one diagnostic angle does not suffice. Recheck pane perimeter fit for every required variant/LOD; the earlier local-coordinate test is insufficient.
5. Only after pose and closure are established, inspect full body/head geometry against canopy and colliders, including intersection **and containment**, and document the clearance method and tolerances. Verify boarding body poses, tread/rail/handhold semantics, ground contact, reachability and continuous motion. Positive nearest distances, sparse angle samples and isolated island spacing cannot close this gate. A new verified capture path is needed; this script intentionally has none.
6. Identify each real mounted module, its dimensions, socket binding and authored forward/local axes. Record evaluated world transforms and validate the full mounted geometry against hull/colliders through authored limits, including containment. Child meshes, socket origins and nearby hull envelopes do not satisfy this requirement. Canopy/gear motion also needs authored limits and continuous/runtime inspection.
7. Confirm all three livery payloads are assigned to the intended faces and remain distinguishable in equal lighting/scale; inspect runtime selection separately. Per-variant/LOD topology, material finish, whole-shell structural exposure/plate denominator, glyph flicker, runtime performance and overall visual acceptance remain parent-owned gates.

## Future invocation and receipts

After the parent authorizes that work, use a **new, nonexistent** output directory outside the source directory tree:

```
blender -b --factory-startup --disable-autoexec --python-exit-code 1 -P packages/tools/blender/hulls/lark-evidence-prep/capture.py -- --blend /absolute/path/to/pinned/lark.blend --out /absolute/path/to/new-evidence-run
```

No output directory is reused, even if empty or containing an older receipt. Existing files, directories and symlinks cause refusal. No file deletion is performed. Intermediate livery cells remain under the new `.cells` directory. Repeated runs require different output directories; they cannot delete or overwrite unknown user outputs.

Cycles CPU, disabled GPU denoising, two threads and bounded samples/resolution are checked before every render. Defaults are 640×480 and eight samples; caps are 960×540 and sixteen samples. At most three final images and five render calls (including three livery cells) are planned. The lineup is 960×320. These are limits for future execution, not an authorization or a claimed render result.

Exit 0 / `EVIDENCE_PREP_DONE_WITH_GAPS` means only preparation finished. Use images only alongside a schema-v2 receipt with `status: complete_with_gaps`, matching image hashes and `blend.bytes_unchanged: true`. Check every skipped proof and image label. The receipt records source/tool hashes and world/material observations. `review_qualification` remains `not_claimed`.

A source mutation or disappearance writes `invalid_source_changed` and exits 3. Exceptions, CPU-gate exits and interruptions write a failed receipt with no accepted images. Partial outputs may remain in that owned run directory; they are not accepted evidence. Hashing before/after detects persistent source change, not a concurrent edit restored between hashes: the source must be quiescent throughout future capture.

## CPU-only checks

```
python3 -B packages/tools/blender/hulls/lark-evidence-prep/capture_plan_selftest.py
```

These test unsupported pose/closure claims, hierarchy without module proof, world-space scaling and grid decisions, variant ownership, livery identity, render limits, source mismatch/failure receipts, and preservation of existing files and symlink targets. Filesystem orchestration tests replace the render callback; they do not load Blender. Source-string/implementation-mirroring assertions from the original commit have been removed.
