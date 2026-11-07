# VERDICT: REVISE — source preparation only

Reviewed commit: `a6a0237a16180d9df2a593cde4d8f0d074faf3b3`.
Tree: `4f3ee1b8d6f472486b081f5a25c86383bffa4b7d`.
Read-only checkout: `/Users/andreyyurlov/.t3/worktrees/space/t3-66ebf63a`.

The correction successfully removes the old seated/closed-canopy and clearance overclaims. Its remaining proof fields cannot be enabled by CLI flags or input attestations. One transform-preservation defect needs a fix or an explicit refusal, and the remaining-work wording must distinguish a valid posed reference biped from production-actor/runtime qualification. This is not a visual grade, a claim that the pinned asset has shear, or permission to capture.

## Exact scope and identity

The direct parent is `3af36b2703bca0ddd6cb887cf547266b323bc951`, not `6ecfd1f`. All four direct-parent source blobs equal the corresponding blobs at historical `6ecfd1fad8a1ca03554b8f0afb1960a1c87bbc4f`; the correction's stated old-source basis is therefore reproducible. `parent.diff`, `parent-scope.txt`, and `parent-comparison.json` preserve this distinction. The direct-parent diff changes only README.md, capture.py, capture_plan.py, and capture_plan_selftest.py under `packages/tools/blender/hulls/lark-evidence-prep`; it changes no assets.

All four working source blobs matched HEAD. Git object IDs:

| File | Reviewed blob |
|---|---|
| README.md | `53bb078acfbfc659818412dcb67119f348e6f88f` |
| capture.py | `5f3586db9723eeb2907d9b9d8e71a81db1481d8d` |
| capture_plan.py | `36859ce66ac0bb77308db16c368a1bbc25d11103` |
| capture_plan_selftest.py | `f08b103b49829ff634a5d772a8161dbe419dff1a` |

Independently hashed the canonical assets without decoding/loading them. Author checkout HEAD is `6445c7ec07aa2a08b722aeca22d56132154ea32c`, tree `a09d51b1b594a799a9489504d44d64447bb15450`:

- `assets/blend/hulls/lark.blend`: SHA-256 `d48d83e9c6a76b0214028a80389a77d6dfd19f65704c73ffc9f47dca58b244ba`.
- `packages/client/public/models/hulls/lark.glb`: SHA-256 `7cd5fed2661f96dd67b50c0a5f6d7df995be43d4adc57d327d35479d894a5e78`.

`identity-before.json` and `identity-after.json` contain sizes, SHA-256, Git blobs, HEAD/tree, checkout status and selected dependency-entry metadata. Both checkouts remained clean and these records match. This is a selected-file/checkout integrity check, not a byte-for-byte inventory of every ignored dependency. No dependency installer or repository build script was executed. The supplied selftest ran directly, and the two capture modules executed under standard-library fake ports. Python used `-B`; test temporaries stayed in this exclusively created review directory.

Read the candidate README in full, the full prior visual VERDICT, IMPLEMENTATION_PLAN's review/visual rubric, DESIGN 19.2–19.4, the current capture implementation and tests, the parent diff, `artlib/scene.py`, and the identified prior geometry report and author preparation source/JSON. Prior reports are context, not independent proof of the current blend's object state. No historical review or author file was altered.

## Slice verdicts

| Source slice | Verdict | Basis / limit |
|---|---|---|
| Unsupported seated/closure/mounted-clearance claims | PASS | Fixed `not_verified`/`not_measured` fields and skipped shots; unknown CLI flags refused; no standing-to-seat translation path remains. |
| Evaluated mesh snapshots and world-frame preservation | REVISE | F1: local mesh plus unparented world-matrix assignment cannot preserve a sheared world transform through Blender updates. Ordinary translated/evaluated mesh and material-index port checks pass. |
| Base/shared collection ownership and multiple users | PASS, bounded | Actual recursive extraction refuses cross-LOD object and collection sharing, excludes tested other variants/WIP, and copies shared mesh data independently. REF caveat A1 below. |
| Active material dependencies and livery preparation | PASS, source only | Used evaluated faces control material inclusion; disconnected texture nodes do not qualify; ambiguous outputs/groups and dirty/unpacked dependencies refuse; identical payloads and conflicting default interpretation skip lineup. Decoded identity and pixels remain untested. |
| Equal livery camera/geometry/light setup | PASS, source only | One frame setup and scene are reused across the three image substitutions; three 320×320 calls use the same samples/settings. Port tests verify substitutions and restoration after the second cell fails. Stitch colour fidelity remains an admission check. |
| CPU gates and render-call structure | PASS, source/ports only | Actual render adapter gates before dispatch; CPU, GPU-denoising disable, fixed two threads, resolution/sample bounds and three-image limit exercised. Source control flow allows at most two ordinary stills plus three lineup cells. No device execution occurred. |
| Fresh output, source identity and failure receipts | PASS, tested boundaries | Existing directory/file/live or dangling symlink refusal; old contents retained; wrong pin never reaches capture; exception/interrupt/CPU-refusal receipts fail; persistent source mutation/deletion invalidates and raises SystemExit(3) in Python. A2 below. |
| Remaining-proof prerequisites / lane documentation | REVISE | F2 adds an unnecessary production-actor requirement to static reference evidence. F3 names the old lane owner. |
| Supplied Python suite / syntax / whitespace | PASS | 15 supplied tests; 18 independent port tests; all three Python files parse; parent `git diff --check` passes. These are not Blender integration tests. |

Per-file: `capture.py` REVISE for F1; `capture_plan.py` REVISE for F2's emitted prerequisite text, with decision logic otherwise passing the tested scope; README.md REVISE for F2/F3 and the overbroad world-preservation statement; capture_plan_selftest.py PASS within its disclosed Python-only scope. No newly claimed visual, performance or runtime qualification.

## Findings and reproductions

### F1 — Medium / P2: snapshots do not preserve general evaluated world transforms

Location: `capture.py:113–134`, especially the matrix assignment at line 132; world measurements at lines 200–218; scene update at line 538. README line 34 promises that rendered snapshots and measurements share the evaluated world matrices.

`new_from_object(evaluated, ...)` supplies the evaluated mesh in object coordinates. The code leaves those coordinates unchanged, makes a new unparented object, and assigns the evaluated world matrix. A world transform with shear can arise from a rotated child of a nonuniformly scaled parent. Its basis columns are not orthogonal, so it cannot be represented by a single unparented object's translation/rotation/scale. No code bakes that affine transform into mesh vertices, preserves an equivalent parent factorization, or rejects a matrix that cannot round-trip.

This is supported by version-matched upstream API implementation, not an assumed Blender behavior: the installed app metadata reports 5.2.3. In [Blender v5.2.3 RNA object source](https://github.com/blender/blender/blob/e13b728c6880d3084d9d57c30031ed5df8b39dee/source/blender/makesrna/intern/rna_object.cc#L360), the world-matrix update calls `BKE_object_apply_mat4`. [Its implementation](https://github.com/blender/blender/blob/e13b728c6880d3084d9d57c30031ed5df8b39dee/source/blender/blenkernel/intern/object.cc#L3587) decomposes into location, rotation and scale; reconstruction at lines 3108–3129 multiplies rotation by scale. Source copies and provenance are sealed here. Version metadata does not establish the local binary's exact build hash.

Reproduction: `adversarial.py` test `test_snapshot_requires_more_than_matrix_assignment_to_preserve_shear` runs the real extraction/snapshot code on a mesh with matrix `[[1,1,0,4],[0,1,0,5],[0,0,1,6],[0,0,0,1]]`. The mesh remains local and the first two matrix columns have dot product 1. The port demonstrates that a TRS-only update can move vertices after the reported world points were obtained. Its illustrative projection is deliberately **not** an implementation of Blender's exact numerical decomposition. The algebra and version-matched implementation establish the unsupported case; native numerical reproduction was not run.

Impact: a supported input shape can produce source observations and initial reference measurements that differ from later rendered geometry. This can affect the reference, hull or collider display. **Whether the pinned blend actually contains shear is UNKNOWN.** No current Lark collision, visible distortion or captured-pixel failure is asserted.

Minimal correction: bake the evaluated world transform into an independent mesh and keep its display object at identity, handling normals/reflections correctly; alternatively refuse unsupported transforms and explicitly verify source-versus-snapshot world vertices after dependency-graph update before using any measurements or images. A same-matrix assignment assertion alone is insufficient. Add a rotated-child/nonuniform-parent port/integration case. The geometry owner can inspect whether the current pin triggers the refusal later; that inspection is not granted here.

### F2 — Medium / P2 documentation/schema semantics: static evidence is over-constrained

Location: README lines 42–44; `capture_plan.py:21–30` (`PROOF_GAPS`, emitted in receipts). The README first requires an actual production actor/rig for seated evidence; the emitted gaps require a production actor/rig and a posed production body. The prose also groups static boarding/reference evidence with continuous reachability requirements.

The actual rubric requires the **1.85 m reference biped and 1 m grid**. A visibly and dimensionally valid reference biped with actual seated/boarding joint poses can establish the requested static comparison. Production-actor fit, dynamic traversal and collision qualification are separate claims. Labelling a reference as such and keeping those separate claims unverified is sufficient; lack of a production rig is not a universal static-evidence blocker.

Reproduction is direct: README lines 42–44 versus IMPLEMENTATION_PLAN lines 111–117 and DESIGN 19.2's Consistency row; `plan.assemble_report(...)['remaining_proofs']` emits the production-only wording. This is a task-scope/documentation defect, **not** evidence that the current translated standing reference establishes seated fit. Leave unsupported capture paths and proof fields skipped until a real pose and closure method exist. A segmented proxy with only nominal segment lengths also needs actual overall dimensions, anatomy/pose and contact verification; it is not automatically accepted.

Minimal correction: split the prerequisite list into static posed-reference evidence and separate production/runtime qualification. Use the concrete static follow-up below. Preserve explicit limitations and do not re-enable old proof paths with a caller boolean.

### F3 — Low / P3: stale lane-owner sentence

README line 40 says the density reviewer owns CPU Blender work. Per this task's current routing, density is complete and the **geometry decoder-survey** owns Blender. Correct the owner sentence. No resource transfer or capture authorization occurred in this review.

## Nonblocking boundaries worth retaining explicitly

- **A1 — REF ownership is narrower than the README's general wording.** The base asset walk checks collection paths, but `reference.all_objects.get` at `capture.py:163–165` accepts an exact-name reference nested inside `REF/_draft`; it does not apply base-scope WIP filtering or audit every REF user's ownership. The actual extraction port records this in `adversarial-observations.json`. No such current-source misassignment was established. Admission must inspect REF ownership as README step 2 already requires; either narrow the blanket exclusion wording or apply an explicit REF ownership policy. Cross-LOD conflicts within the lark asset do fail closed as tested.
- **A2 — Outside-source output is an operator requirement, not an enforced descendant guard.** `output_allowed` prevents an output directory from containing the source file, but allows a fresh child of the blend's parent directory. Existing paths and symlink targets are preserved as promised. Select an external run path as README directs; do not claim the helper itself prevents every write under the author tree. Persistent before/after source changes are caught; restored concurrent edits are not, as already disclosed.
- **A3 — An unqualified grid can still be displayed.** A single horizontal edge produces `matches_1m_lattice: false` yet a standing shot is planned. No false one-metre qualification is emitted. If “ambiguous references skip the image” is intended to include this case, tighten that wording/decision; otherwise retain the negative measurement and label. Visible anatomy, stature and dimension labels remain capture review items.
- Receipt I/O failure cannot promise a complete receipt (exclusive create can fail, serialization can stop). Existing receipts are preserved and the script does not report success on such an exception. Only a valid completed receipt with matching hashes is admissible. Native process termination and Blender CLI exit-code behavior were not tested; Python SystemExit codes were.

## Exact minimal follow-up for the missing static evidence

1. After the geometry owner releases the lane and the parent authorizes it, identify a reference biped by source/hash. Verify its standing world-space extent is 1.85 m, proportions are suitable, and the visible grid intervals are 1 m. A production rig is optional for this static evidence.
2. Actually pose its joints/segments into the seat: record pelvis/seat, feet/floor or supports, back, and relevant hand/control relationships. For boarding, pose representative tread/handhold contacts along the identified route. Translating an unposed standing mesh below PilotSeat cannot satisfy either seated anatomy or closed headroom.
3. Establish an authored or geometrically justified closed canopy state against the sill/frame with documented tolerances. Record evaluated pivot, frame and pane world transforms; check the full perimeter in a common world frame for each depicted variant/LOD. Zero rotation or a diagnostic angle alone is not proof.
4. Show dimensioned side/front or otherwise adequate views with the reference and grid visible, the canopy genuinely closed, and body/head versus canopy/collider relationships readable. Document any measured clearance method and tolerances, including intersection and containment if asserting clearance. Static screenshots must be labelled as reference/static evidence. Do not assert continuous collision-free traversal from a few poses.
5. Keep production-actor fit, continuous boarding, runtime collision and gameplay-speed articulation separately unverified. Mounted articulation requires identified mounted geometry, binding, axes and authored limits; marker rods and nearby hull envelopes remain insufficient. This tool currently has no verified path for those missing proofs.

## Admission checks that remain unexecuted

- Actual Blender version/build, startup/script-disable behavior, source scene/view layer/frame/subframe, library and external dependency state, collection ownership and exact reference anatomy.
- Evaluated mesh/modifier/instance completeness; source-versus-snapshot world geometry after scene updates; shear/reflection cases; material slots/normals and copied node animation semantics.
- Real CPU/device use, thread/resource consumption, successful background scene/window switching, Cycles dispatch, image saving and interruption behavior. Local bundled Cycles properties confirm that the named GPU-denoising fields exist; that does not qualify execution.
- Image framing and reference visibility; readable dimension/grid evidence; collider/axis visibility; mounted alignment or mechanical limits. The standing camera currently frames reference corners, so inspect its usefulness for the intended boarding comparison.
- Assigned packed livery data, decoded/perceptual distinction, equal visible scale/light, and load/stitch/save colour handling under AgX. Same encoded-byte checks are not a decoded-pixel comparison.
- Any seated/closed-canopy proof, mounted motion, collision/reachability, full-scene performance, visual rubric score, whole-shell plate denominator, glyph flicker, topology/LOD continuity or other parent asset gates.

No Blender, renderer, browser UI/automation, native application, GPU workload, heavy-model decoder, child reviewer, full suite, PR, push, merge, Trunk action or lane transfer was run. Official Blender source was retrieved as text only. File extensions `.blend` and `.png` inside test fixture directories contain plainly marked synthetic text, not assets or captures. See REPRODUCTIONS.md for the exact bounded rerun instructions and seal format.
