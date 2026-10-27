# Art bible

The single reference every asset is built and graded against. It turns DESIGN 5, 10.4, 12, 19 and 20 into rules an artist (or
an agent driving Blender) can follow without asking, and it is one of the visual grader's inputs (IMPLEMENTATION_PLAN 0.10.3).
Where this file and DESIGN.md disagree, DESIGN.md wins and this file is corrected.

**The bar in one line:** every asset is hand-authored in Blender, reads as one of the peoples, factions or the Cartographers
at a glance, and looks worn by use, not by noise.

---

## 1. Scale references

Every `.blend` source carries a collection `REF` (excluded from export, hidden in renders) with:

| Reference | Size | Use |
|---|---|---|
| `REF_Grid` | 1 m grid, 20 × 20 m, on the ground plane, origin at the asset's origin | proportion checks in every view |
| `REF_Biped` | 1.85 m standing biped, neutral A-pose, feet at the origin | the shared skeleton's rest height; doors, seats, railings, controls |

Fixed dimensions that the engine and other assets depend on:

| Thing | Dimension |
|---|---|
| Biped eye height | 1.70 m (first-person camera) |
| The three peoples | Thalune 1.80 m, Ixari 1.95 m to the crown of the crystal, Ulgani 1.75 m to the crest base; all on the shared 1.85 m skeleton, scaled ±6% per people |
| Doorways | at least 2.4 m tall × 1.4 m wide; station and city service doors 3.0 × 2.0 m |
| Corridors | 3.0 m wide, 3.2 m clear height |
| Seats | 0.45 m seat height, 0.5 m deep; cockpit seat reference point at 1.2 m above the cockpit floor |
| Railings | 1.05 m |
| Steps | 0.18 m rise, 0.30 m going |
| Landing pads | 24 m across for Tier 0–1 hulls, 36 m for Tier 2–3 haulers and gunships |
| Hangar bay (Waystation) | 130 × 150 m footprint, 42 m clear height (today's `HANGAR` box); one pad per player, 24 per bay phase |
| City towers | up to 340 m tall at a capital's core (the validator allows 400 m for the cities family) |
| Hull length bands | Lark 12–14 m (today's ship: 12.3 m long, 13.4 m span, 4.7 m tall, gear height 1.95 m); Swift 10–12; Kestrel 13–15; Mule 18–22; Dart 9–11; Wayfarer 16–18; Bulwark 24–28; Caravel 26–32; Ghost 14–16; Listener 20–24; Warden-breaker 32–38; Longhaul 45–55; Husk 22–26 |
| Creatures | quad_small 0.4–1.2 m at the shoulder, quad_grazer 1.2–2.4 m, quad_heavy 2.5–5 m, biped stalker 1.6–2.6 m tall, flyer 1–6 m span |
| Monoliths | 18–26 m tall; anchor stones 40–60 m |
| City buildings | low 6–14 m, mid 20–60 m, tall 170–340 m at the core (DESIGN 5.1) |

Units are metres, +Z up in Blender (the glTF exporter converts to +Y up). Apply all transforms before export; origins sit
where the asset touches the ground (buildings, props, bodies) or at the centre of mass (hulls, flyers, effects).

## 2. The three design languages

The peoples are told apart by biology and the worlds that shaped them (DESIGN 2.6, 5.1). Their architecture, hulls, tools
and dress follow from that biology, never from any real-world culture or region. Each language has a primary form, a
secondary form, a joinery rule and a light rule; a building, hull or tool of a people uses all four.

### 2.1 Thalune: shell

*Amphibious people of the tidal coasts. Smooth skin with colour cells, gill-frills, webbed hands, large dark eyes.*

- **Primary form:** the shell. Broad, low, continuous curvature; ribbed vaults whose ribs radiate from a hinge line like a
  scallop's; spirals at small scale (handles, finials). Hulls are the broadest in the cluster, with a dorsal shell over a
  flat belly.
- **Secondary form:** stilts and sea-walls: buildings stand on tapered piers above canal water; walls are thick, battered
  and water-stained to the tide line.
- **Joinery:** nothing is bolted where it can be overlapped: plates lap like shingles or the edges of a shell; seams follow
  the ribs.
- **Light:** soft, low, from within: nacre glows warm pearl at night through thin shell panels; no hard emitters.
- **Wear:** salt bloom and tide lines, verdigris on fittings, polished paths where hands and feet go.
- **Never:** sharp facets, exposed lattices, glowing seams.

### 2.2 Ixari: crystal

*Crystal-symbiont people of the spire forests. Living crystal along spine and forearms that glows; slate skin; two pairs
of eyes; long jointed fingers.*

- **Primary form:** the grown facet. Long prismatic forms with hexagonal and rhombic cross-sections, clustered and
  leaning, never perfectly regular; growth is visible as stepped terraces along each shaft.
- **Secondary form:** the hollowed spire: halls are cut into stone shafts, bridges are single grown crystals spanning
  between spire tops.
- **Joinery:** crystal is never fastened; it is grown into sockets of dark stone. Joints read as a socket collar where
  crystal meets slate.
- **Light:** glowing seams. Light runs inside the crystal along its growth lines and leaks at fractures; at night the city is
  lit by the crystal and the world's bioluminescence, not by lamps.
- **Wear:** chips at facet edges, clouding inside old crystal, soot-dark stone around sockets.
- **Never:** curves without facets, exposed fasteners, warm colours except as accents.

### 2.3 Ulgani: lattice

*Fungal-symbiont people of the spore moors. Pale porous skin, a crest of spore-fronds, breathing slits; luminous spores.*

- **Primary form:** the lattice. Light open frameworks of grown chitin, triangulated and lightly curved, with membrane
  panels stretched between members.
- **Secondary form:** the cap and the root: streets sheltered by giant caps with gills beneath; bridges and foundations are
  roots that braid and fuse.
- **Joinery:** members fuse where they meet with a smooth fillet, like grown bone; no bolts, no welds.
- **Light:** spore-light: soft points of luminous spores drifting from gills and fronds; the city's lake glows from below.
- **Wear:** membranes tear and are patched with newer, paler membrane; chitin weathers from amber to grey; lichen in
  sheltered joints.
- **Never:** solid heavy masses, glass, hard reflective metal on the outside.

### 2.4 Shared to all three

The Waystation Compact's stations, ships sold at every Waystation, and anything owned by a faction rather than a people
combine the languages: a Compact station has a Thalune-style lapped shell over an Ulgani-style lattice frame with Ixari
crystal windows. Factions draw from all three peoples (DESIGN 4); their liveries (section 7) are paint, not architecture.

## 3. The Cartographer glyph alphabet

The Cartographers left only markers. Their writing is the one thing every monolith, the Recall, the Count displays and the
suit glyphs share. The definition lives in code: `packages/shared/src/art/glyphs.ts` (`@astra/shared/art`); the reference
sheet is [art/glyph-alphabet.svg](art/glyph-alphabet.svg), drawn from that data by
`packages/tools/src/art/glyph-sheet.ts`.

### 3.1 The lattice
Every sign is drawn on seven nodes: a centre C and six rim nodes N0–N5 of a hexagon, N0 at the top, numbered clockwise. A
stroke is a spoke (C to a rim node) or a rim edge (between neighbouring rim nodes). Signs never rotate; on stone the top is
marked by a small notch, and a sign turned is a different sign.

### 3.2 The signs
24 signs: 23 letters and the word divider (a lone centre dot). Names transliterate letter by letter; c and q are written as
k, and x as ks. Every letter is one connected figure that touches the centre through at least one spoke, because every
monolith is anchored. The stroke sets are in `SIGNS`.

### 3.3 Count numerals
The Count is written in base 6 as concentric hexagonal rings. The innermost ring holds the units and each ring outward is
worth six times the one inside it: as the Count falls, the inner ring churns and the outer rings move rarely. A digit d
lights the first d rim edges of its ring, clockwise from the top; a zero shows its six node dots only. The Count at 1000 is
four rings reading 4-3-4-4 from the outside in.

### 3.4 How glyphs are made
- **Cut, not painted.** On monoliths and anchor stones glyphs are incised 2–4 cm deep with a V-section, in the mesh or a
  baked normal and height map, and lit from inside the cut by the `LIB_GlyphLight` emissive.
- **Stroke weight** is 8% of the sign's diameter, round caps, no serifs. Signs on a stone face sit in columns read top to
  bottom; on rings (the Recall, Count walls) they follow the ring clockwise.
- **Glyph light** is the monolith light: core `#D8F6FF`, halo `#7FD8FF`. It is the only cold white-cyan emissive in the
  game; nothing else may use it, so the player learns that this light means the network.

## 4. Palettes

Colours are given as base colour (linear workflow, authored in sRGB). Every asset's palette comes from one row of this
table plus neutrals; anything else needs a note in the asset's review.

| Owner | Primary | Secondary | Accent | Emissive |
|---|---|---|---|---|
| Thalune (livery sea-green / pearl) | sea-green `#2E8F84` | pearl `#EDE6D6` | shelf blue `#1F4E5F`, coral `#E07A5F` (small) | nacre warm `#FFE7C2` (low) |
| Ixari (livery violet / slate) | slate `#3B4252` | violet `#7A4FD0` | crystal lilac `#B9A6FF` | crystal `#B9A6FF`, biolume cyan `#64E3FF` |
| Ulgani (livery amber / ivory) | ivory `#F2EAD3` | amber `#D9962B` | chitin brown `#5B4636` | spore green `#C7F06A`, lake `#59F2C1` |
| Waystation Compact | deep blue `#22406A` | station white `#F4F4F0` | signal orange `#F28C28` | nav white `#FFFFFF` |
| Free Reaches | oxide red `#8E2F23` | gunmetal `#3A3D42` | patch yellow `#D8B23A` | engine red-orange `#FF6A3D` |
| Chorus of the Count | indigo `#2B2A5C` | parchment `#E9DFC7` | chant gold `#E8C66A` | glyph light (section 3.4) |
| The Hollow | husk black `#121416` | rust `#5A3B2E` | bone `#CFC6B3` | seam light `#9FE8DA` at 40–60%, flickering |
| Cartographers / monoliths | basalt `#2A2C30` | weathered basalt `#4A4D52` | none | glyph light core `#D8F6FF`, halo `#7FD8FF` |
| The Edge (sky) | opal white `#F5EEF8` | pale blue `#CFE8F7` | pale peach `#F7E3D0` | the wall is emissive at sky level |

Skin and body palettes (character creation, DESIGN 5.1): Thalune colour cells shift between teal `#3FA79A`, amber
`#E3A04B` and dusk violet `#6A4C93` over a pale green ground; Ixari slate skin `#2F3440`–`#4A5263` with crystal patterns in
the people's lilac-to-cyan range; Ulgani pale porous skin `#E8E1CF`–`#CFC4A8` with spore-frond colours amber, ivory, lake
green or spore green.

**HUD and UI** keep the flight-deck palette in `packages/client/src/ui/style.css`: warm white type `#E9E7E2` on near-black
plates, one amber accent `#F0A24A`, teal secondary `#8FD3C8`, danger `#FF5A4F`. Lore UI (dialogue busts, the journal's lore
lines, Count readouts) adds the glyph light and the speaker's people palette.

**Resource pips** are the one documented exception to that palette (P1.E06.T04). Each resource wears a small pip in
inventory slots, pickup toasts and trade rows: a shape by where it comes from and a muted hue of its own. The rule: a pip
says which resource this is and nothing else. It never marks a state (full, selected, at risk, low, refused); states keep
the flight-deck colours, amber for focus and cargo at risk, danger red for danger. Pip hues stay muted and clear of danger
red and the amber accent. The values live in `PIPS` in `packages/client/src/gameplay/Inventory.js`.

| Shape | Family | Resources (hue) |
|---|---|---|
| dot | plants | carbon `#93B07E`, sodium `#CFD18A`, oxygen `#9DC4E6` |
| diamond | rock, deposits, asteroids | ferrite `#B7B2A9`, di-hydrogen `#B39CDB`, tritium `#C8E4EC`, copper `#86B39A`, cobalt `#7E9FD4`, gold `#DED0A0`, iridium `#C5CAD3` |
| hexagon | crystals and salts of hostile worlds | frostglass `#B6E0E8`, acidsalt `#B5C77A`, cinderglass `#B497A8`, stormquartz `#9E9BD0`, gamma crystal `#A9D49A`, murkpearl `#8FA9A6` |
| square | what the Count, the Hollow and the Cartographers leave | Count residue `#D8F6FF`, husk alloy `#CFC6B3`, glyphstone `#7FD8FF` |

Items that are not resources wear a three-letter kind tag (CON, AMO, CAT, MOD, COS, CMP) in warm white on a hairline
border, not a pip. P1.E13.T02's resource icons replace the pips' shapes, keeping the hues and the rule.

## 5. The shared material library

`assets/blend/_library.blend` holds every shared material. Assets either link a library material (so a library fix
reaches them) or append it and rename it when an asset needs its own variant. Names start with `LIB_`. A material's name
in the exported model is its `engine_name` custom property when it has one, else its own name: the hull materials carry
the names the engine reads (`LIB_PaintedPlate` → `Hull`, `LIB_PaintedAccent` → `Accent`, `LIB_TrimMetal` → `Trim`,
`LIB_DarkMetal` → `Dark`, `LIB_Glass` → `Glass`, `LIB_EngineGlow` → `EngineGlow`, `LIB_Nav*` → `Nav*`). Every
material is full PBR (DESIGN 19.2): base colour, roughness, metallic, normal, ambient occlusion, and emissive where it
glows. Library materials drive their channels from procedural nodes; the export scripts bake them per asset, and bake
ambient occlusion from the asset's own geometry wherever no AO map was painted. Objects that share one material bake into
one image, so their UVs must not overlap. Emissive-only materials (`LIB_EngineGlow`, `LIB_Nav*`, `LIB_GlyphLight`,
`LIB_HollowSeam`) and `LIB_Glass` are exempt from the full map set.

| Material | Used for | Base | Metallic | Roughness | Notes |
|---|---|---|---|---|---|
| `LIB_PaintedPlate` | hull and station plates (engine name `Hull`) | livery primary | 0 (1 where chipped) | 0.35–0.5, higher in wear | edge wear and chips hand-painted along leading edges and hand-holds |
| `LIB_PaintedAccent` | livery secondary (engine name `Accent`) | livery secondary | 0 | 0.4 | |
| `LIB_TrimMetal` | trims, frames (engine name `Trim`) | `#8A8F96` | 1 | 0.3–0.45 | brushed direction follows the part |
| `LIB_DarkMetal` | intakes, undersides, landing gear (engine name `Dark`) | `#2C2F34` | 0.8 | 0.38 | grime in cavities |
| `LIB_Glass` | canopies, windows (`Glass`) | `#0B1016` | 0 | 0.05 | transmission off in engine; reflection does the work |
| `LIB_EngineGlow` | nozzles' throats (`EngineGlow`) | black | 0 | 0.6 | emissive per livery, driven by the engine |
| `LIB_Nav` | nav lights (`NavRed`, `NavGreen`, `NavWhite`) | | | | emissive only |
| `LIB_Nacre` | Thalune shell panels | pearl | 0 | 0.25 | thin-film tint at grazing angles, faint inner glow |
| `LIB_ShellRib` | Thalune ribs and piers | sea-green to grey | 0 | 0.55 | salt bloom in the lower 1.5 m |
| `LIB_GrownCrystal` | Ixari crystal | lilac | 0 | 0.08 | emissive seams follow growth lines; cloudy cores |
| `LIB_SlateStone` | Ixari sockets and spire stone | slate | 0 | 0.7 | soot around sockets |
| `LIB_Chitin` | Ulgani lattice members | amber to grey | 0 | 0.45 | fused fillets darker |
| `LIB_Membrane` | Ulgani panels | ivory | 0 | 0.6 | translucent look via emissive backlight at night; patches paler |
| `LIB_CapFlesh` | Ulgani caps and gills | amber, ivory | 0 | 0.7 | spore-light points in the gills |
| `LIB_Basalt` | monoliths, anchor stones | basalt | 0 | 0.75 | weathered faces, sharp cut glyphs |
| `LIB_GlyphLight` | glyphs, the Recall | black | 0 | 1 | emissive glyph light only |
| `LIB_HuskPlate` | the Hollow's treatment | husk black | 0.6 | 0.65 | see section 6 |
| `LIB_SuitWeave` | suits (all peoples) | people palette | 0 | 0.7 | seams, padding, wear at knees and elbows |
| `LIB_Skin_Thalune`, `LIB_Skin_Ixari`, `LIB_Skin_Ulgani` | bodies | people palette | 0 | 0.4–0.6 | colour-cell, crystal-pattern and frond-colour parameters exposed for character creation |
| `LIB_Ground_*` | dressing pads, plazas | | | | ground materials match the terrain shader's palette at their seams |

**Texture budgets** (DESIGN 19.2): 4k on heroes (player bodies, hulls, Wardens, the Patient, capital landmarks), 2k on
creatures and buildings, 1k on props; city kits and station kits share one atlas per kit. Texel density: characters
~2048 px/m, hulls ~512 px/m, buildings 256 px/m with trim sheets, props 512 px/m.

**Detail rules** (the demo's known failures, IMPLEMENTATION_PLAN 0.10.2): no uniform noise as detail; no visible tiling
(break repeats with decals and trim variation); no blown-out metals (metallic surfaces never above 0.9 albedo luminance,
roughness never below 0.2 on large metal areas); wear goes where use goes; the demo's panel-detail shader survives only as
a micro-detail layer under real texturing.

## 6. The Hollow's husked treatment

Anything the Hollow have taken (husked hulls, the Hive, husked crews) gets the same treatment so the player reads it at once:

- **Missing panels:** 15–30% of outer plates removed along their seams, exposing the frame beneath. Removal follows the
  hull's own panel lines, never random holes.
- **Glyph-lit seams:** remaining seams glow with the Hollow seam light (`#9FE8DA` at 40–60%, flickering), a sick echo of
  the monolith light; glyph fragments scrawl across plates where the network wrote itself on them.
- **Surface:** paint burnt to husk black with rust bleeding from fasteners; canopies dark and crazed; no running lights.
- **Silhouette:** unchanged at LOD2, so a husked Kestrel still reads as a Kestrel, which is the horror of it.

Hulls ship a husked variant (DESIGN 10.4) built with `LIB_HuskPlate` on separate panel-loss geometry, not a shader-only
recolour.

## 7. Liveries

A livery is three colours on the engine's material names: `Hull` (primary), `Accent` (secondary) and `Trim` (metal or
accent). Each hull ships three (DESIGN 10.4): its yard people's livery, the Compact livery and a neutral working livery.

| Livery | Hull | Accent | Trim |
|---|---|---|---|
| Thalune | pearl `#EDE6D6` | sea-green `#2E8F84` | shelf blue `#1F4E5F` |
| Ixari | slate `#3B4252` | violet `#7A4FD0` | crystal lilac `#B9A6FF` |
| Ulgani | ivory `#F2EAD3` | amber `#D9962B` | chitin brown `#5B4636` |
| Compact | station white `#F4F4F0` | deep blue `#22406A` | signal orange `#F28C28` |
| Free Reaches | gunmetal `#3A3D42` | oxide red `#8E2F23` | patch yellow `#D8B23A` (mismatched patch panels) |
| Working | warm grey `#9A968C` | graphite `#3A3B3D` | safety yellow `#E3B341` |

City liveries (DESIGN 14.4, Phase 2) are variants of the people rows.

## 8. Budgets, LODs and naming

These are the rules `packages/tools/blender/validate.py` enforces (P1.E14.T01). The budgets for heroes, creatures and props
come from DESIGN 19.2; the other classes and every size range are in `packages/tools/blender/families.json`, which is the
authority for the numbers.

| Class | LOD0 triangles | Textures | LODs |
|---|---|---|---|
| Hero (player bodies, hulls, Wardens, the Patient, bosses, capital landmarks) | 60k–150k | 4k | 4 |
| Creature (and constructs) | 15k–40k | 2k | 4 |
| NPC | 25k–60k | 2k | 4 |
| Building | 8k–60k | 2k | 4 |
| Kit piece | 0.5k–15k | 2k atlas per kit | 4 |
| Weapon module | 4k–20k | 2k | 4 |
| Tree | 3k–15k | 1k | 4 (impostor beyond 400 m) |
| Flora (plants, grass, rocks, deposits) | 150–6k | 1k | 4 |
| Prop | 2k–10k | 1k | 4 |
| First-person viewmodel (arms and tools) | 15k–60k | 2k | 1 (always at arm's length) |
| Effect mesh | up to 5k | 1k | 1 |
| Cosmetic decal | up to 2k | 2k | 1 |

- **LODs:** LOD3 under 5% of LOD0, each LOD lighter than the one before. LOD swaps must not pop at their distances (graded
  in the review scene's wireframe pass). The export scripts decimate LOD1–3 only where none were hand-made.
- **Source layout:** one `.blend` per asset family under `assets/blend/<family>/`; one top-level collection per asset; inside
  it, one collection per variant and LOD named `<variant>_LOD0` … `<variant>_LOD3` (a lone variant uses the asset's name);
  colliders and markers beside the LODs. The `REF` collection from section 1. Collections starting with `_` are ignored.
- **Exported layout:** `packages/client/public/models/<family>/<file>.glb`, nodes `<asset>/<variant>/<variant>_LOD<n>`.
- **Exported textures** (P1.E14.T12): every map a material uses ships as KTX2 (Basis Universal) behind
  `KHR_texture_basisu`, with its full mip chain and no PNG fallback: normal maps in UASTC (rate-distortion optimised,
  then Zstandard), base colour, emissive, AO and metallic-roughness in ETC1S; byte-identical maps (a variant whose bake
  of an unchanged material came out the same) are stored once. The 4k Lark (three variants, 49 maps) goes from 572 MB
  with PNGs to 128 MB, its review captures within 1.5% of pixels (at 16/255) of the PNG export's; its geometry alone is
  28 MB. The codecs and their settings are `families.json`
  `textures`; a family may opt out with its own `"textures": {"compress": false}`, and `pnpm art:export -- <family>
  --no-compress` writes PNGs to compare against (validation of shipped models refuses them). The validator and the
  turntable re-import a compressed export from its maps transcoded back to PNG (the texels the client shows); the
  validator fails a map that is not KTX2,
  a normal map not in UASTC, a colour map not sRGB or a data map not linear, a short mip chain, and a variant whose maps
  take more GPU memory once transcoded (8 bits a texel, mips included) than its class's `gpuTextureMB`: 512 MB for a
  hero, 128 MB for the 2k classes, 32 MB for the 1k ones. The encoder is Khronos' KTX-Software `ktx` 4.4.2, which `pnpm
  art:export`, `art:test` and `art:validate` of a `.glb` fetch on first use into `node_modules/.cache/` (checked against
  its SHA-256; `KTX=<path to ktx>` uses another build), as does `pnpm turntable` of a `.glb`. The client loads every
  model through three's `KTX2Loader`
  (`gltfLoader()` in `src/core/Engine.js`) with the Basis transcoder served from `packages/client/public/basis/`, a copy
  of three's that a unit test keeps equal to the installed version; the review readout reports the maps' GPU memory.
- **Engine conventions** (DESIGN 19.4): hull material names `Hull`, `Accent`, `Trim`, `Dark`, `Glass`, `EngineGlow`, `Nav*`
  (via `engine_name`, section 5); `Gear*` pivot empties for articulated landing gear, `Canopy*`, `CockpitInterior`; hardpoint
  empties `HP_S_*`, `HP_M_*`, `HP_L_*` (size in the name) and bay empties `BAY_*`; weapon modules carry `Mount` (where they
  meet a hardpoint) and `Muzzle*`; `COL_` collider meshes, `Interact`, `Light_`, `Blink` and `Spin` markers on structures;
  `Door*` meshes at least 2.4 × 1.4 m; `_limb`, `_pivot` and `_glow` attributes on creatures; colour-region masks on flora
  and creatures; an armature on characters, NPCs and bosses, with the shared rig's bone and blendshape names; cutscene
  camera curves `CAM_<cutscene>_<shot>`. Marker prefixes match case-insensitively.
- **Review:** every asset is captured in-engine under noon on a lush world, night on an exotic world and open space, at LOD0
  and LOD2, with a wireframe pass, a collider and marker overlay (`COL_*` volumes translucent, markers and `Gear*`,
  `Blink`, `Spin` pivots labelled), a far view at LOD2 from 100 m under noon (a hero also from 200 m), a paired perf
  readout (the asset's own cost as the median of shown-minus-hidden differences of adjacent frames) and a turntable
  sheet, plus a sibling sheet of the asset's family (IMPLEMENTATION_PLAN 0.4, 0.10.3): `pnpm capture -- --review
  <family>/<file>` and `packages/tools/blender/turntable.py` (`pnpm turntable -- <file.glb> [out_dir] --family`).
