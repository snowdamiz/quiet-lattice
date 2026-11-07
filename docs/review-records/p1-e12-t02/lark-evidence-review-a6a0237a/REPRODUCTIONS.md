# Reproductions — Python only

Source under test is pinned to a6a0237a16180d9df2a593cde4d8f0d074faf3b3. `adversarial.py` checks the two executable source SHA-256 values before importing them. It uses only the standard library and injects fake `bpy`/`mathutils` modules; it never imports real Blender modules or runs Blender. All file writes are to the directory containing the copied reproduction script.

The original run produced 15 passing supplied tests (`supplied-selftest.log`) and 18 passing independent tests (`adversarial.log`). “Passing” means each test observed the specified behavior, including documented defects/boundaries; it does not mean the reviewed source is approved. The shear example deliberately records the unhandled input and uses an illustrative TRS projection. It does not simulate Blender's exact numerical decomposition or establish that this asset has shear.

Run the independent suite in a **new** directory each time. Existing fixture directories intentionally cause failure instead of being deleted/reused:

```sh
lark_repro_dir=$(mktemp -d /private/tmp/lark-review-repro-XXXXXX)
cp /private/tmp/lark-evidence-a6a0237-review-vVaHIq/adversarial.py "$lark_repro_dir/adversarial.py"
python3 -B "$lark_repro_dir/adversarial.py"
```

Run the supplied suite with its temporary files confined to that fresh directory:

```sh
TMPDIR="$lark_repro_dir" python3 -B /Users/andreyyurlov/.t3/worktrees/space/t3-66ebf63a/packages/tools/blender/hulls/lark-evidence-prep/capture_plan_selftest.py -v
```

Important cases in the independent suite:

- Actual `snapshot_mesh` and `extract`: evaluated versus original vertices; translated parent observations; material-face preservation; shared mesh data and copied material ownership; multi-LOD object/collection users; variant/WIP exclusion and exact reference names.
- Active output traversal: disconnected dirty images ignored; active group/ambiguous outputs refused; dirty, unpacked, movie and zero-size dependencies refused; required material must occur on evaluated faces; same packed payload or conflicting default colour interpretation cannot qualify the lineup.
- Actual `require_cpu`/`render_pixels`: the fake dispatch observes CPU/two-thread/no-GPU-denoising settings; bounds and missing GPU-control field refuse before dispatch. The render operator is a recorder, not a renderer.
- Actual `render_lineup`: identical cell dimensions/count/settings and three image substitutions; restore copied nodes on success and injected second-cell failure; source nodes retain original images. `stitch` is stubbed; no pixel or colour behavior is tested.
- Actual `main`: success, exception, KeyboardInterrupt, CPU gate SystemExit, persistent test-source mutation and deletion; receipt status/hashes/exception result recorded. The `capture` callback is replaced with a filesystem-only fixture.
- Existing output directory/file/live and dangling symlink refusal; old receipt/custom cell/file bytes preserved; wrong source cannot create output or call capture; exclusive receipt creation refuses replacement.
- Adversarial boundary observations: general affine shear has no vertex bake/refusal; REF/_draft exact-name selection; fresh output below source parent; unqualified single-edge grid still displayable with a negative lattice fact. These observations are not claims about the current blend's contents.

`identity-before.json`/`identity-after.json` and `integrity-check.log` establish selected-file and clean-checkout preservation. `parent-comparison.json` establishes the direct-parent/historical-parent source equivalence. `local-api-evidence.txt` contains installed metadata and bundled Python property definitions; `upstream-api-sources.json` pins fetched official C++ source to Blender v5.2.3's commit. No application was executed to collect either.

`HASHMANIFEST.json` lists every retained regular file's size/SHA-256 and every test symlink's target, excluding itself and SEAL.json to avoid recursion. `SEAL.json` hashes REPORT.md and HASHMANIFEST.json and identifies the reviewed commit. The seal demonstrates bundle integrity, not a cryptographic reviewer signature. The bundle is read-only after sealing.
