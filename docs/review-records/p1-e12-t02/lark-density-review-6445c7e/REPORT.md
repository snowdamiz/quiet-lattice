# Lark P1.E12.T02 density / stock-validate slice

SLICE: PASS

Scope is stock validation, texel-density numbers, file hashes, UV and atlas counts, and material-link facts for candidate `6445c7ec07aa2a08b722aeca22d56132154ea32c` (tree `a09d51b1b594a799a9489504d44d64447bb15450`). This is not a visual grade, not a geometry root-cause review, and not a runtime or collision qualification.

## Bound files

| File | Bytes | SHA-256 | Git LFS at HEAD |
| --- | ---: | --- | --- |
| `assets/blend/hulls/lark.blend` | 48962870 | `d48d83e9c6a76b0214028a80389a77d6dfd19f65704c73ffc9f47dca58b244ba` | same oid |
| `packages/client/public/models/hulls/lark.glb` | 19791628 | `7cd5fed2661f96dd67b50c0a5f6d7df995be43d4adc57d327d35479d894a5e78` | same oid |

Worktree `/Users/andreyyurlov/.t3/worktrees/space/t3-7d211d96` was clean before and after. Both hashes match `FINAL-CANDIDATE-RECEIPT.json`. The blend also matches source anchor `1331891dcaba3e8438c6a62b2b698a1d054c0e79`. The GLB at that anchor is a different object: LFS `6f3a0774a8539435779985afdaca4322a2bea9a798fa51ad4a88f2ba27c88b55`, 19791752 bytes. The installed GLB matches HEAD, not that anchor.

Earlier commits, not reopened:

| Commit | Blend LFS | GLB LFS |
| --- | --- | --- |
| `8b6c3604bb842019c899956a1b57d6a01385d6f3` | `4d0eec86894b3eefa3985cbd6686e1f27d0d7512140e7d09e39a65adc19d07c1` (35508071) | `659b084f2664b9f79d406a4c5abf2a425ba9e4dc2d1c533de467fecde6ba8836` (16699824) |
| `9648690f6e3149684cbd7fe7787d6ae8cfc1c5f1` | `9fea5ec91f66247d8c459e5c599771ea4002b111d277406b021a82164c995ee0` (36597454) | `06cf7ca1b620d8f7b6fbf65969deba511c7c13cb5d00eb7712be7c19a72729a6` (16512872) |

Source opens in Blender 5.2.3 LTS. File header is a zstd blend, not an LFS pointer. Mode `0644`. `bpy.data.libraries` is empty, linked objects are 0, local mesh objects are 78.

## Stock validate

Tool: `packages/tools/blender/validate.py` from this worktree. Reports only under `/tmp/lark-grok-6445c7ec/reports/`. Blender 5.2.3 LTS. Both files PASS 5/5: naming, triangles, lods, materials, scale. Failures: 0.

Source warnings: 136. 135 are duplicate-suffix object names. One materials warning: subject `Hull (LarkHusk_HuskHull)`, message `emissive map lark_husked_4k_emissive is uniform under the surface's UVs (std 0.0000 < 0.0039)`.

GLB warnings: 1. Subject `Hull`, same emissive map, std 0.0008.

LOD0 triangles, source and export: lark 108746, lark_damaged 113554, lark_husked 110379. Longest reported side 13.522 m.

## Density gate

Metric: minimum of LOD0 material-role edge medians for engine_name / exported material role in {Hull, Accent, Trim, Dark}. Edge density is `4096 * uv_span / world_length` for edges longer than 1e-4 m and 1e-8 UV. No other scale is applied.

| Source | Roles | Min median px/m | Min group | Max median px/m |
| --- | ---: | ---: | --- | ---: |
| Blend UVMap | 23 | 590.6459274927377 | `lark_husked_LOD0/Body_husk/Accent` | 20459.628424054976 |
| Decoded GLB | 23 | 590.6403370883208 | `lark_husked_LOD0/Body_husk/Accent` | 40975.63866049564 |

Receipt blend min is 590.6459217270778 (same group). Absolute difference 5.8e-6. Receipt GLB min matches this run exactly. Both gates are above 512. Next-lowest blend gate group is `lark_LOD0/CockpitMechanismMesh/Trim` and `lark_damaged_LOD0/CockpitMechanism_dmgMesh/Trim` at 599.9909174755187.

Decoded GLB uses MeshoptDecoder (`meshoptimizer` 1.3.0) and `getElement()` floats. POSITION on all 151 render primitives is component type 5122, normalized. TEXCOORD_0 on the LOD0 gate groups is normalized. `all_texcoord_normalized` on the 23 gate rows is true.

## UV and atlas

Blend: 71 lark LOD mesh objects, every one has only UV layer `UVMap`, and that layer is active. LOD0 UVMap bounds are inside the unit square (min about 0, max 0.999755859375). Samples outside [0,1] by 1e-4: 0.

GLB: 151 render primitives, all with only `TEXCOORD_0`, missing 0, extra 0. Every sampled material texture slot uses texCoord 0. Seventeen lower-LOD primitives keep float TEXCOORD_0 (component type 5126, normalized false): cockpit mechanism Dark at LOD1 and LOD2, and LOD3 body/cockpit/landing primitives. They are outside the LOD0 median gate.

Images: 17 in the blend, all packed 4096×4096. 17 in the GLB, all `image/ktx2`, 4096×4096, 13 mip levels. Gate-role TEX_IMAGE links in the blend: 38 links, all 4096×4096.

`force_fit` is not a custom property or text in the blend (0 hits). The density scripts stamp `force_fit_scale: 1.0`. This measurement uses 4096 px per UV unit and the measured UVs occupy the unit square.

## Material links

Paint roles share one 4096 set per state:

- Base Hull/Dark/Accent/Trim: `lark_4k_density_baseColor`, `_ORM`, `_normal`. UVMap node into each TEX_IMAGE.
- Damaged: `lark_damaged_4k_density_*`.
- Husk Hull/Dark/Accent/Trim: `lark_husked_4k_density_*`.

Husk Hull, Husk Accent, and `LIB_HollowSeam_Lark` (`engine_name` HollowSeam) also connect `lark_husked_4k_emissive` (4096, sRGB, packed) to Principled Emission Color. The exported husk Hull, Accent, and HollowSeam materials connect that KTX2 image to emissive, texCoord 0. The image is 26925 bytes. The stock materials check calls it uniform under Hull UVs and still returns PASS.

`HollowGlyph_LOD0` and `HollowGlyph_LOD1` are meshes with material HollowSeam, 8 triangles each. Blend LOD0 glyph median is 1940.704 px/m. No LOD2 or LOD3 object of that name was found. No image name contains `glyph`.

Husk slot `engine_name` values present: Accent, Dark, EngineGlow, Glass, HollowSeam, Hull, NavGreen, NavRed, NavWhite, Trim. Husk is a name prefix, not one of the four density roles.

Other LOD0 engine_name medians, excluded from the 23-role gate:

| Median px/m | Group | Triangles |
| ---: | --- | ---: |
| 21.428 | `lark_husked_LOD0/Body_husk/NavRed` | 98 |
| 21.478 | `lark_husked_LOD0/Body_husk/NavGreen` | 98 |
| 21.485 | `lark_husked_LOD0/Body_husk/NavWhite` | 294 |
| 22.294 | `lark_husked_LOD0/Body_husk/EngineGlow` | 128 |
| 27.686–35.300 | damaged and base Body Nav/EngineGlow | 98–128 |
| 1114.036 | CanopyGlass on base, damaged, and husk | 1296 |
| 1208.911 | `Body_husk/HollowSeam` | 16 |
| 1940.704 | `HollowGlyph_LOD0/HollowSeam` | 8 |

Decoded GLB outside-gate minimum is 21.248622904364208 on `lark_husked_LOD0/Body_husk/NavWhite`.

Base and damaged Nav and EngineGlow materials export with `KHR_materials_emissive_strength` and no textures. Husk Nav and husk EngineGlow export with neither textures nor that extension.

`KHR_materials_variants` is used. Extra materials `Hull_compact`, `Accent_compact`, `Trim_compact` use `lark_livery_compact` as baseColor. `Hull_working`, `Accent_working`, `Trim_working` use `lark_livery_working`. Both livery images are 4096 KTX2. They share the base ORM and normal. They do not add a UV set. The 23-role median is the base mesh roles, not a second measurement of those variant materials.

## Commands

Disk free at start: 100084293632 bytes. Scratch peak during the GLB validate: 106457404 bytes. No stage killed. No blend or GLB hash change. No Blender process left.

| Stage | Exit | Seconds | Peak RSS |
| --- | ---: | ---: | ---: |
| Blend density | 0 | 3.132 | 831619072 |
| `validate.py` source | 0 | 3.143 | 1641299968 |
| `validate.py` GLB | 0 | 11.374 | 2030747648 |
| GLB meshopt density | 0 | about 1.1 | sampler interval missed the interior peak; process was under the 8 GiB kill line |

Each Blender invocation: `-b -t 2 --factory-startup`. Thread env 2. `ART_KTX_JOBS=1`. KTX 4.4.2 ran through `/tmp/lark-grok-6445c7ec/ktx_one.py`, which holds an exclusive lock, because `decoded_copy` asks for `max(2, jobs())` workers. Reports and the KTX binary were not written into the author worktree. Decoder packages resolved from `/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab/node_modules` at the versions pinned by this candidate (`@gltf-transform/*` 4.5.1, `meshoptimizer` 1.3.0). The candidate worktree has no `node_modules`.

## Left to other reviewers

Plate loss, openings, ribs, wear appearance, glyph readability, LOD surface breakup, cockpit finish, collision, motion, flicker, and performance were not judged. Prior visual record `docs/review-records/p1-e12-t02/lark-blind-visual-8b6c360/VERDICT.md` remains REVISE on `8b6c360` and was not regraded. No renders. Preview budget was not spent.
