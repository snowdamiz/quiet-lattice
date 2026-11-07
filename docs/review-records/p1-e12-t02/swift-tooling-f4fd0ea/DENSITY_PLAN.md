# Swift R4 density correction — not executed

The independent source review against `7415bfa5ec9f2115c6304cdfa70c36129702f593`
is **REVISE**. The current source and GLB remain unchanged and fail the art-bible
approximately 512 px/m hull target. Stock validation is not density acceptance.
All new Blender, bake, render, codec, export and full-suite work remains held for
the parent's T13 controlled diagnostic until explicit release.

The measured input is `/private/tmp/swift-r4-review-v69_mmzw/REPORT.txt` and its
independently decoded `glb-decoded.json`, pinned in the adjacent evidence
`87-source-review-tooling/density-plan.json`. This plan uses read-only arithmetic
from those results; it does not claim a new measurement of modified assets.

| LOD0 Hull material | Current px/m | Scale to nominal 512 | Required summed UV triangle area at 4K |
| --- | ---: | ---: | ---: |
| Base | 79.6447 | 6.4285 | 1.238630 |
| Damaged | 78.1662 | 6.5501 | 1.164433 |
| Husked | 60.5238 | 8.4595 | 0.853865 |

A unique 4096-square atlas covers at most 64 square metres at 512 px/m before
padding. Base and damaged Hull surfaces exceed that limit. UV bounding boxes
and a 4K image label do not establish coverage or density. Increasing resolution,
counting overlapping areas as unique, or shrinking the physical ship are not
corrections.

After the parent releases the writer slot:

1. Work from the saved authoritative `.blend`, not `author.py` regeneration.
   Inventory world-space triangle area, UV area, and area-weighted density
   p05/median/p95 by material, connected panel and all three geometry states.
   Include the other substantial stone/crystal/trim surfaces; the review's Hull
   finding is not permission to omit other low-density material surfaces.
2. Author material-specific UV layouts sized to nominal 512 px/m. Replace the
   current fragmented, broadly packed layout with deliberate panel seams and
   efficient padding. Use compatible mirrored or repeated panels and trims only
   where the authored surface can share texels. Keep distinct rung/grip/socket
   wear, fracture edges, graphics and other unique features in dedicated regions.
   Overlapping faces with different normal or wear bakes must not overwrite one
   another; author the shared pattern and tangent orientation deliberately.
   Break visible repetition with the already scoped trim/panel variation.
3. Budget the actual layout before baking. Current full-mip estimates are
   384.0/426.7/448.0 MiB for base/damaged/husked against the 512 MiB cap. Prefer
   reuse of existing material maps; any additional atlas must include every
   required channel and mip in its budget and disclose additional material
   submissions. There is no assumed spare atlas or density exception. If the
   layout cannot meet both requirements, report the concrete conflict rather
   than silently changing the target.
4. Transfer the authored UV correspondence through all four saved LODs while
   retaining protected canopy/gear facet normals, transforms and silhouettes,
   the rear tip, cockpit fit, three liveries and damage/husk identity. Re-bake
   the UV-dependent color/roughness/normal/emissive maps from editable source.
   Do not reuse old texture encodings after a changed UV/bake unless fresh
   image bytes and bindings truly match the existing strict cache proof.
5. In separately admitted bounded stages, run stock source validation,
   serialization, compression and export validation. Measure density again
   from both the saved source and actual independently decoded GLB accessors,
   world transforms and map dimensions. Report per-surface distributions and
   source/export agreement, not just a favourable aggregate or a chosen tiny
   surface. Keep nominal 512 explicit; no new acceptance tolerance is invented
   in this plan.
6. Recheck actual topology/UV/normal identity, texture and geometry budgets,
   display fit and protected LOD geometry. Retain all failed attempts and the
   existing 34 PNGs/two EXR buffers. Only then plan additional compact previews
   against the remaining original 48-file/512-MiB allowance. The parent still
   owns standard engine captures, intended-distance temporal transitions,
   integrated smoke, T13 whole-scene performance and a fresh independent grade.

The tooling correction accompanying this plan addresses dispatch ownership and
terminal promotion gates only. It does not fix density or overturn the source
REVISE or the earlier third-round visual REVISE.
