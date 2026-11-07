# Wire the Mule phase log into export_saved.py

The saved Mule export timed out while material `Mule_Accent.001` was baking. `resource-checkpoints.jsonl` names that material and does not name the channel. `packages/tools/blender/artlib/bake.py` bakes each channel inside `_bake_channels` (the loop at lines 160-186 of commit `54c969dff016ff576fe89f751d58b86b1057ab95`) and writes no channel receipt. This package records each of those calls. The isolated candidate adopts it in `packages/tools/blender/hulls/mule-round4/export_saved.py` on that caller pin, with logger commit `506bd292e73da91c935c5903e27be1b7721354a8` recovered by a provenance cherry-pick. This is source-only adoption for independent review. The real export remains HELD; no export retry is authorized.

The supervisor wall limit and RSS limit stay where `run.py` already enforces them. This package does not change those limits, skip a material, lower a bake resolution, retry an export, or cache a finished channel.

## Add the wrapper after the material admission hook

`export_saved.py` already replaces `bake.bake_material` with `bounded_material`. That hook calls `check('bake '+mat.name)` and then the stock bake. Leave that hook in place. Install this wrapper immediately after `out=Path(os.environ['MULE_ATTEMPT'])` (line 43 at the caller pin), after the material admission hook and before identity controls or any export work. `out` must already be bound. The concrete caller below owns the installation; the snippet is its exact installed source.

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
    # run.py publishes these limits before Popen. Missing/invalid input fails
    # immediately; no polling, fallback limits, or export retry.
    limits = json.loads((out / "launch-limits.json").read_text())
    # Same measurement checkpoint.check already uses. Do not call check() here.
    from run import resources
    state = resources()
    own = [row for row in state.pop("processes") if row[2] == os.getpgrp()]
    state["group_rss_kib"] = sum(row[3] for row in own)
    state["wall_limit_s"] = limits["wall_seconds"]
    state["rss_limit_kib"] = limits["rss_mib"] * 1024
    return state

phase_log = PhaseLog(out / "bake-phases.jsonl")
install(
    bake,
    phase_log,
    resources_of=resource_snapshot,
    counts_of=mesh_counts,
    variant_ids=("mule_husked", "mule_damaged", "mule"),
)
```

`variant_ids` are the variant ids already used by the Mule authoring scripts. The export labels a bake as `{variant id}_{material name}` in `artlib/export.py` (`f"{v.id}_{R.material_name(m)}"`). The longest matching id wins, so `mule_damaged_Hull` selects `mule_damaged`. The material field stored in the log is `mat.name`, such as `Mule_Accent.001`. The label suffix stays out of that field.

`install` replaces `bake.bake_material` and `bake._bake_channels` on the module object for this process. It does not edit `artlib/bake.py`. The replacement of `bake_material` records the variant, object count, and triangle count, then calls the function it replaced. That call is `bounded_material`, so the existing admission check still runs before stock `bake_material`. Stock `bake_material` then calls `bake._bake_channels`. The replacement walks the same channel list and calls the original `_bake_channels` once per channel, passing a one-item list. The original function still creates the image, selects the target, calls `bpy.ops.object.bake`, and runs `_finish`.

## What each line means

`bake-phases.jsonl` is append-only, next to `resource-checkpoints.jsonl` in the attempt directory. Each channel writes a `start` line and fsyncs it before the original `_bake_channels` call. After the call returns, it appends `success`. If the call raises `KeyboardInterrupt` or `SystemExit`, it appends `interrupt` and reraises. Any other exception appends `error` with `repr` of that exception and reraises the same exception.

A later reader pairs lines by `phase_id`. `load(path)` always reports `status="unfinished"` and `publication="unconfirmed"`. `observed_outcome` is the visible terminal event (`success`, `error`, or `interrupt`), or `None` if no complete terminal exists. A visible success means the channel returned, including `_finish`; it does **not** mean the logger returned successfully. A missing terminal cannot establish whether execution finished. The log has no exit hook that writes success.

This deliberately changes the old reader contract: disk-only terminals no longer qualify phase completion. A newline can become visible before fsync or close raises. Such bytes are retained, not rolled back or hidden with another fallible write. The original live `PhaseLog.phases()` additionally uses its in-memory acknowledgements: only after terminal append, fsync and close have all returned does that instance report `publication="acknowledged"` and `status` equal to `observed_outcome`. A new instance cannot recover those acknowledgements from disk. Interruptions between I/O return and acknowledgement remain conservative. No power-loss durability or persistent acknowledgement is promised.

An open/write/short-write/fsync/close failure prevents the next channel and propagates after a successful channel. A start publication failure prevents that channel from running at all. On a channel exception, a secondary logging or exception-formatting failure never replaces the original exception object. If write/fsync and cleanup close both fail, the first exception wins. A failed terminal publication may expose a complete terminal, but both disk-only loading and the failed writer's view still report unfinished/unconfirmed.

Whole-export qualification is separate. Channel success and even the live writer's acknowledgement are insufficient. The exact caller passes the result of `export.main` to `sys.exit`; that pinned function turns ordinary bake/logging exceptions into exit 1, while interrupts escape. That is Python source control flow, not verified Blender process-exit behavior; parent admission must also check the actual launch/error-exit configuration. The supervisor must independently publish a final `receipt.json` with PASS, exit 0, no failure reason and settled cleanup, and all existing source/export validation and identity gates must pass. Missing, failed, interrupted or mismatched run evidence leaves the export unqualified, regardless of terminal lines. `started.json` is never success evidence. This package does not grant export acceptance or infer it from phase logs.

Fields on both lines are `material`, `variant`, `channel`, `resolution`, `object_count`, `triangle_count`, `resources`, and `monotonic_s`. `resolution` is the `res` argument of that `_bake_channels` call. `resources` is the dict returned by `resources_of` immediately before that channel. The dict is stored as given. `monotonic_s` is `time.monotonic()` at the write. `resource-checkpoints.jsonl` stores `time.time()`.

## Startup ordering

`run.py` writes and closes `launch-limits.json` **before** calling `Popen`, inside the guarded launch block. This immutable file contains exactly `receipt["limits"]`; a write failure prevents launch, and no concurrent rewrite can truncate it under a child reader. The existing `started.json` remains a RUNNING receipt written after launch, with pid/pgid intact for controller-loss/recovery consumers. The new instrumentation never reads that later receipt. Its resource snapshot reads the limits file once per channel, without waiting, retry or invented limits; missing or malformed JSON fails before resource sampling, and missing required limit fields prevent channel work. The existing `resources()` probes retain their three-second subprocess timeouts. The supervisor's configured wall/RSS policy is unchanged (the held historical export used 5400 seconds / 8192 MiB).

## Limits of this integration

The historical Accent timeout is not labeled with a channel. This log can name the channel only on a later run that actually bakes.

Calling `_bake_channels` once per channel is the same loop body as the stock function, which already handles one channel at a time. The wrapper does not copy that body. A future edit to `_bake_channels` that depends on seeing the whole channel list in one call would not see that list. The pinned function does not do that.

`mesh_counts` uses the Blender mesh of the objects `bake_material` already received. This package does not import Blender. The tests call a fake bake.

The concrete source adoption and stricter reader contract require parent admission and independent rereview. Fake-port tests cannot close the historical 5400-second Accent bake timeout, whose exact channel remains unknown. Do not launch the export from this package.
