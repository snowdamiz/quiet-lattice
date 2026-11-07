# P1.E12.T02 Lark REVISE fix (blind mean 3.60)

Parent auth: fix design / materials / topology / fitness only. Density ≥512, one 4096 atlas, single UVMap, force_fit_scale=1.0 retained. No push/PR/merge/Trunk. No self-capture/self-grade.

## Hash proof

| Asset | sha256 |
|---|---|
| `assets/blend/hulls/lark.blend` | `4d0eec86894b3eefa3985cbd6686e1f27d0d7512140e7d09e39a65adc19d07c1` |
| `packages/client/public/models/hulls/lark.glb` | `659b084f2664b9f79d406a4c5abf2a425ba9e4dc2d1c533de467fecde6ba8836` |

## Gates

- Private density re-measure (UVMap, LOD0): **min_median 590.6 ≥ 512** (`…-revise-density-revise-density.json`)
- Stock validate: **PASS 5/5** on blend and glb during export (`…-revise-export2-revise-export/hulls__lark.{blend,glb}.json`)

## REVISE item → change

1. **design (husked)** — Removed 24% of outer Hull/Accent plate IDs on `Body_husk` along `pid` seams (35/147 plates, 2478 faces) so Dark frame shows. Rebaked husked baseColor to husk black `#121416` with rust at fasteners and bone glyph scrawls (off the purple density atlas).

2. **materials** — Rebaked husked Hull/Accent/Trim/Dark baseColor+ORM; added packed `lark_husked_4k_emissive` with `#9FE8DA` seam/glyph glow wired at strength 0.5 on Hull/Accent. Base pearl/sea-green maps untouched. Replaced `lark_damaged_Glass_baseColor` white scribbles with dark crazed glass.

3. **topology** — Regenerated LOD1–3 at ratios 0.30 / **0.20** / 0.035 (LOD2 gentler than stock 0.10) so the 100 m scallop read holds; LOD3 still under 5% of LOD0. Sparse normal-island microdetail keeps validate map std above the uniform gate without multi-atlas.

4. **fitness** — Moved `Canopy` / `_dmg` / `_husk` empties to the aft glass rail so 55° X-open no longer folds the bubble through itself. Added `BAY_1` empty under the belly for the single cargo pod.

## Idle

Awaiting parent SOURCE/CPU review. No self-capture or self-grade.
