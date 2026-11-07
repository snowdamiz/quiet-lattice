# Lark density: second T13 resource hold

**Incomplete / source REVISE remains open.** The parent released exclusive heavy CPU work at 11:29 UTC, then requested a new hold at 11:45 UTC pending the T13 controlled timing attempt. No new heavy work may start until another explicit release. This does not authorize asset promotion or imply task acceptance. Original evidence and screenshot cleanup remain stopped.

## Fresh quiescence

`resource-controls/20261107T114515651346Z-quiescence.json` records the fresh process and lock check at 2026-11-07T11:45:15.738489Z:

- Supervisor **25459** and Blender/process group **25494** are absent.
- The bound guardian's terminal receipt has `remaining_members: []`; no matching guardian is live. The old runner did not record the guardian's own PID. That missing identity is not reconstructed or invented. Future runner receipts now record its PID, process group, return code and completed wait.
- No Blender or codec process was found anywhere in that process inventory.
- The task lane lock was acquired exclusively/nonblocking and released. Lock inode: **479124639**.
- The new hold directive is `resource-controls/20261107T114515651346Z-hold.json`.
- A real runner invocation after the hold returned **125**, `admitted: false`, `child_started: false`; see `*t13-second-hold-negative-control.admission-denied.json`.

The last heavy stage had already ended before the parent's hold. No process was interrupted for scheduling.

## Work and failures since the preceding hold

All stages used one factory Blender, `-t 2`, the six math thread limits set to 2, fresh disk/process admission, and no GPU/render/codec. Parent limits are now maximum 2700 seconds/stage, 8 GiB sampled aggregate RSS, 6 GiB new disk growth/stage and a 12 GiB free-space floor. Codec transport code is prepared for one codec with **one encoding thread**; it has not run in this interval.

Commands used the common prefix:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 packages/tools/blender/hulls/lark-round3/density_run.py --seconds SECONDS --rss-mib RSS --growth-mib 256 LABEL -- -P SCRIPT
```

| Label / script | Seconds bound | RSS MiB bound | Actual result |
|---|---:|---:|---|
| `registered-surface-input` / `density_surface_data.py` | 300 | 4096 | Exit 1, 4.486s. Detected wrong prior UV-only paint correspondence; no save. |
| `registered-surface-input-v2-exact` / `density_surface_data.py` | 300 | 4096 | Exit 0, 7.883s; peak sampled 617,008 KiB. Exact original loop/UV correspondence extracted into evidence. |
| `registered-paint-budget` / `density_registered_budget.py` | 900 | 8192 | Supervisor exit 124; Blender exit -15 after RSS guard; 23.863s, peak sampled **9,817,888 KiB**. Overshoot is reported, not claimed within budget. Guardian reaped the group. |

The resource failure came from full-hull min/max paint buffers combined with large triangle raster temporaries. The failed input snapshot and log remain intact. **23 completed comparison groups** were recovered from the actual log into `registered-budget-v1-partial.json`, with its log hash and explicit partial status. These are not a completed sharing proof.

The revised comparison code uses 256-row strips instead of full-hull image buffers. The monitor now samples all stages every 0.1 seconds. These changes passed AST parsing only; no heavy rerun has occurred while held.

## Paint correspondence correction

The old `original-paint-controls.npz` matched corners by rounded UV plus material role. Repeated addresses could bind a corner to a different physical surface. Comparing against exact retained authoring corner indices found maximum field errors:

| Object | Max prior error |
|---|---:|
| Damaged Body | 0.2373582292 |
| Damaged cockpit | 0.0489879847 |
| Base Body | 0.0145559311 |
| Husked Body | 0.0032967329 |

The old file and affected layout histories remain preserved, but must not authorize a source rewrite. The corrected authoritative evidence is `20261107T113800619229Z-registered-surface-input-v2-exact-surfaces.npz` and its adjacent `-surfaces.json`. For unchanged topology, both original loop vertex indices and UV arrays were checked before transferring original corner fields directly. Landing rails still require the separately documented new-corner correspondence to be rechecked; no claim of full rail-field equivalence is made.

The retained input is already-local LFS object `f73327b3755418a816f18738b94345b68766d92416582e794af90fee5ba5d690`. No model generation, bulk recovery, fetch, installation or restoration occurred.

## Current artifact state and next work

Canonical assets remain byte-identical to the source-review RED inputs:

- Blend: 65,357,176 bytes, SHA256 `bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75`.
- GLB: 25,633,924 bytes, SHA256 `7f11e2bd2818045c1a861d4e959f2a985828bdcc9b60d44ed2fda8ff41300bad`.

HEAD is still `a89dd7f8a2d9375ed5df94f77e6c83d972f42f73`, tree `2354e2c110975902183ccde1103fc78495f9bf83`. New task tools/evidence are uncommitted. No corrected candidate source or export exists yet. No stock source/export or 512 px/m density PASS is claimed for a revised asset.

The next admissible investigation will finish the bounded registered-paint comparison using exact fields. A separate read-only `density_enclosure.py` is prepared to test strict containment of actual world-space triangles inside another **watertight, proven-convex static component**, with 1 mm clearance, across every LOD. It neither changes geometry nor treats a failed certificate as hidden. Its purpose is to establish whether truly enclosed faces can legitimately share physical finish regions while visible paint remains unique. It is syntax-checked only and has not run. Generic ray visibility or bounding-box coverage will not substitute for this certificate. No hidden-face density relaxation has been made.

Remaining work is still a feasible physical UV/trim allocation, actual CPU LOD0-derived maps in a private candidate, lower-LOD correspondence, stock source/export checks, normalized-accessor/world-transform density and coverage gates, negative controls, terminal cleanup, then canonical promotion and a scoped clean Appendix C.2 commit. Parent owns all independent source/visual/native acceptance.

No new diagnostic image was generated. The historical `qualified-front.png` was viewed in place again; it is not a view of a corrected density asset. The 12-new-image / 128 MiB cap remains intact. No shared exporter, library, runtime, other hull, old review or historical image was modified.
