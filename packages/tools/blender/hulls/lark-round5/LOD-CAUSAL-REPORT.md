# LOD repair installed

Installed intact boundary/UV/material-delimited reconstruction from scratch/repaired.blend. The earlier moderate-increase rejection was not a user budget and is superseded. No further destructive reduction was attempted after prior selective-panel trials left artifacts.

Counts (LOD0 / LOD1 / LOD2 / LOD3):
- lark: 108302 / 73651 / 59884 / 4388
- damaged: 113110 / 79033 / 65702 / 4557
- husked: 113994 / 81074 / 68488 / 5018

All four levels decrease; hero budgets and LOD3 <5% pass. 69 protected mesh geometry/UV digests match the canonical input, including glazing. Reconstruction changes only Body LOD1/2 mesh data; canopy, markers, transforms and other features are retained.

Prior neutral/no-normal/no-custom controls established geometric ridges and 627 non-boundary nonmanifold edges in original LOD2 versus zero in LOD0. Those controls were not repeated. Matching CPU material LOD0/2 previews were rendered and inspected: broad ridges are removed; some surface shading and texture differences remain. This is not a blind visual grade.

UVMap source LOD0 density: 21 material-role groups, minimum median 590.6459 px/m against 512; PASS. This measure is per-group median edge density, not a minimum for every texel or triangle.

Fresh source validation: 4/5 PASS. Naming, triangle budgets, LODs and scale pass. Materials FAIL: husk Dark and Hull normal-map variation is below validator threshold (0.0009 and 0.0001 versus 0.0039). Materials were not edited in this geometry unit; parent-owned material work must resolve this gate. No 5/5 or full completion claim.

Installed SHA256: f381d5bd9122c76f9362db5350f2464d276db179a5e0a3183043babba023e95d.

Evidence: lod-installed-validation.json, lod-installed-density.json, lod-source-validation.json, previews/installed-material-LOD0.png and installed-material-LOD2.png. Each stage has a lod-*-resource.json receipt. Two new previews; previous unit generated 12 and parent diagnostics 5. No new scratch intermediates; inherited reconstruction/control files retained as recovery evidence. All stages used run_stage watchdog, one Blender -b -t 2, CPU rendering, GPU denoise off.

Lower-LOD runtime cost remains unqualified and parent-owned. No export, runtime, GPU, browser, services, delegation, push, PR or merge. Parent retains material/wear/husk/cockpit/evidence/full export and blind grade.
