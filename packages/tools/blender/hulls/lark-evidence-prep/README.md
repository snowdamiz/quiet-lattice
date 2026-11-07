# Run the Lark CPU evidence capture

This directory builds stills and a measurement receipt for the Lark proportion, canopy, livery, and collider questions in the round-5 REVISE. It does not edit the blend, the glb, `lark-round5`, or the shared exporters.

The pictures and the receipt exist only after Blender runs the script. This commit did not run Blender. `review_qualification` stays `not_claimed`. `dynamic_clearance` stays `not_measured`.

## Render the stills

Use an output directory that does not contain the blend. The script deletes and rewrites only these names in that directory: `boarding-standing.png`, `cockpit-closed-canopy.png`, `colliders-axes.png`, `livery-lineup.png`, and `receipt.json`.

```
blender -b --factory-startup --python-exit-code 1 -P packages/tools/blender/hulls/lark-evidence-prep/capture.py -- --blend /absolute/path/to/lark.blend --out /absolute/path/to/evidence-out
```

`--factory-startup` keeps the run off the machine's saved GPU preferences. The script then sets Cycles to CPU, sets `denoising_use_gpu` to false, and checks those values again in `render_pixels` before the only `bpy.ops.render.render` call. If the denoiser is `OPTIX` and it cannot be switched to `OPENIMAGEDENOISE`, denoising is turned off. If `denoising_use_gpu` is missing, the script exits before a render.

Optional bounds, rejected when they exceed the cap:

- `--variant lark` selects the `<variant>_LOD0` collection. The default is `lark`.
- `--width` and `--height` default to 640 and 480. The cap is 960 by 540.
- `--samples` defaults to 8. The cap is 16.
- Threads stay at 2.

At most four final images are written. A rerun overwrites those files and converges on the same receipt for the same blend.

## Read the receipt

Exit 0 and the line `EVIDENCE_PREP_DONE` mean the script finished and the blend's SHA-256 is unchanged. They do not mean the hull passes review. Exit 3 means the blend bytes changed. Treat that run as invalid.

`receipt.json` has `status` `complete` or `failed`. Use the PNGs only when `status` is `complete` and `blend.bytes_unchanged` is true. Each image entry has its byte size and SHA-256. Shots listed under `plan.skipped` were not rendered. Do not substitute another image for a skipped shot.

The seated picture is `cockpit-closed-canopy.png`. The reference mesh stays a standing mesh. Its feet are moved to the plane 1.2 m below `PilotSeat`, which is the cockpit floor implied by art bible section 1. The canopy rotation in the file is not changed. Clearance numbers are static distances from the crown, and from the 1.70 m eye when the mesh measures 1.85 m within 0.02 m, to `CanopyGlass` and `CanopyFrame` triangles in `<variant>_LOD0`. A mesh past the vertex, triangle, or product cap produces `vertex_cap_exceeded`, `triangle_cap_exceeded`, or `product_cap_exceeded` and no distance. A height outside 1.85 m plus or minus 0.02 m sets `matches_1_85` to false and sets the eye probe to `skipped_height_mismatch`.

`boarding-standing.png` puts the same standing mesh's feet on the `REF_Grid` origin height, at the xy of `BoardingFoot`. The camera frames the biped. `marker_z_minus_grid_m` records a boarding marker that does not sit on that plane. The script does not move the marker.

`colliders-axes.png` shows display copies of unsuffixed `COL_*` meshes and rods along the stored matrix columns of `HP_S_*`, `HP_M_*`, and `HP_L_*` empties. Damage and husk names are ignored. A hardpoint with no direct mesh child has `mounted_module` `absent` and `axis_clearance` `not_measured`. One to eight direct mesh children add an unsigned origin-to-collider distance. That distance is not a penetration test. `Canopy` and `Gear*` empty transforms are recorded as pivots with `motion` `not_measured`.

`livery-lineup.png` is written only when `liveries.lineup` is true. That requires `Lark_Hull`, `Lark_Accent`, and `Lark_Trim` to share one backed base-color image, plus distinct backed images named `lark_livery_compact` and `lark_livery_working`. Left to right is thalune, compact, working, with one camera. Any other source state skips the sheet and names the gap in `liveries.missing` or `liveries.reason`.

## Check the plan without Blender

```
python3 packages/tools/blender/hulls/lark-evidence-prep/capture_plan_selftest.py
python3 -m py_compile packages/tools/blender/hulls/lark-evidence-prep/capture_plan.py packages/tools/blender/hulls/lark-evidence-prep/capture.py
```

The selftest locks the livery decision, the 1.85 m gate, the static distances, the image cap, and the source rules that forbid saving the blend. `py_compile` checks syntax only. Neither command is a Blender render.

## Hand the result back

Run the command against the blend the asset lane has finished writing. Do not point `--out` at that blend's directory, and do not run it while that lane has the file open. Keep the receipt beside the PNGs. A complete receipt is source evidence for the parent review. It is not the in-engine noon, night, and space capture, and it is not a dynamic clearance test.
