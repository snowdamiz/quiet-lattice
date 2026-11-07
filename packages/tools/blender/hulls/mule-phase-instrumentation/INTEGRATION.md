# Wire the Mule phase log into export_saved.py

The saved Mule export timed out while material `Mule_Accent.001` was baking. `resource-checkpoints.jsonl` names that material and does not name the channel. `packages/tools/blender/artlib/bake.py` bakes each channel inside `_bake_channels` (the loop at lines 160-186 of commit `54c969dff016ff576fe89f751d58b86b1057ab95`) and writes no channel receipt. This package records each of those calls. It is not installed. Adopting it is a later edit to `packages/tools/blender/hulls/mule-round4/export_saved.py` on that commit. Do not treat this file as that edit.

The supervisor wall limit and RSS limit stay where `run.py` already enforces them. This package does not change those limits, skip a material, lower a bake resolution, retry an export, or cache a finished channel.

## Add the wrapper after the material admission hook

`export_saved.py` already replaces `bake.bake_material` with `bounded_material`. That hook calls `check('bake '+mat.name)` and then the stock bake. Leave that hook in place. After the assignment `bake.bake_material = bounded_material` (line 36 at the pinned commit), install this wrapper so it sits outside `bounded_material`.

```python
sys.path.insert(0, str(ROOT / "packages/tools/blender/hulls/mule-phase-instrumentation"))
from phase_log import PhaseLog, install

def mesh_counts(objects):
    triangles = 0
    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
    return (len(objects), triangles)

def resource_snapshot():
    # Same measurement checkpoint.check already uses. Do not call check() here.
    from run import resources
    state = resources()
    own = [row for row in state.pop("processes") if row[2] == os.getpgrp()]
    state["group_rss_kib"] = sum(row[3] for row in own)
    # started.json is written by run.py before the export process starts.
    # Read those limits. Do not pass a new --wall or --rss-mib.
    limits = json.loads((out / "started.json").read_text())["limits"]
    state["wall_limit_s"] = limits["wall_seconds"]
    state["rss_limit_kib"] = limits["rss_mib"] * 1024
    return state

install(
    bake,
    PhaseLog(out / "bake-phases.jsonl"),
    resources_of=resource_snapshot,
    counts_of=mesh_counts,
    variant_ids=("mule_husked", "mule_damaged", "mule"),
)
```

`variant_ids` are the variant ids already used by the Mule authoring scripts. The export labels a bake as `{variant id}_{material name}` in `artlib/export.py` (`f"{v.id}_{R.material_name(m)}"`). The longest matching id wins, so `mule_damaged_Hull` selects `mule_damaged`. The material field stored in the log is `mat.name`, such as `Mule_Accent.001`. The label suffix stays out of that field.

`install` replaces `bake.bake_material` and `bake._bake_channels` on the module object for this process. It does not edit `artlib/bake.py`. The replacement of `bake_material` records the variant, object count, and triangle count, then calls the function it replaced. That call is `bounded_material`, so the existing admission check still runs before stock `bake_material`. Stock `bake_material` then calls `bake._bake_channels`. The replacement walks the same channel list and calls the original `_bake_channels` once per channel, passing a one-item list. The original function still creates the image, selects the target, calls `bpy.ops.object.bake`, and runs `_finish`.

## What each line means

`bake-phases.jsonl` is append-only, next to `resource-checkpoints.jsonl` in the attempt directory. Each channel writes a `start` line and fsyncs it before the original `_bake_channels` call. After the call returns, it appends `success`. If the call raises `KeyboardInterrupt` or `SystemExit`, it appends `interrupt` and reraises. Any other exception appends `error` with `repr` of that exception and reraises the same exception.

A later reader pairs lines by `phase_id`. A `start` line with no terminal line is `unfinished`. Killing the process after the start fsync leaves that line. The log has no exit hook that writes `success`.

A failed write of the terminal line after a successful channel bake leaves the phase `unfinished` and raises the write error. It does not write `success`. A failed write of the terminal line after a failed bake reraises the bake exception. The bake exception is the one the caller sees.

Fields on both lines are `material`, `variant`, `channel`, `resolution`, `object_count`, `triangle_count`, `resources`, and `monotonic_s`. `resolution` is the `res` argument of that `_bake_channels` call. `resources` is the dict returned by `resources_of` immediately before that channel. The dict is stored as given. `monotonic_s` is `time.monotonic()` at the write. `resource-checkpoints.jsonl` stores `time.time()`.

## Limits of this integration

The historical Accent timeout is not labeled with a channel. This log can name the channel only on a later run that actually bakes.

Calling `_bake_channels` once per channel is the same loop body as the stock function, which already handles one channel at a time. The wrapper does not copy that body. A future edit to `_bake_channels` that depends on seeing the whole channel list in one call would not see that list. The pinned function does not do that.

`mesh_counts` uses the Blender mesh of the objects `bake_material` already received. This package does not import Blender. The tests call a fake bake.

Until the lines above are added to `export_saved.py` and reviewed, the export behavior is unchanged. Do not launch that export from this package.
