# Visual review

Every graded visual deliverable's verdicts, in order, with the artifacts each grader saw (IMPLEMENTATION_PLAN 0.10.4).
A fresh grader subagent writes each verdict with the C.3 brief; the orchestrator appends it here unchanged in substance.
A human may spot-check any PASS and reopen it.

## Calibration baseline (P1.E14.T09, 2026-10-26)

The demo's own assets graded against the rubric as written, each as if submitted for the task that rebuilds it
(0.10.5). All five are REVISE, with materials at 1 and detail and placeholder tell at 2 or below everywhere, as the
calibration expects, so the rubric is not tightened.

| Asset | As | Mean | Lowest criteria |
|---|---|---|---|
| Demo ship | P1.E12.T02 Lark | 2.0 | design 1, materials 1, fitness 1 |
| Box station | P1.E11.T01 Waystation | 2.1 | design 1, materials 1, placeholder 1 |
| Structures (outpost_0, monolith_0) | P1.E10.T08 / P1.E14.T08 | 2.2 | design 1, materials 1 |
| Creatures (4 of 10) | P1.E08.T08 | 2.3 | materials 1, placeholder 1 |
| Flora (7 of 40) | P1.E14.T04 / T05 | 2.4 | materials 1 |

What calibration changed in the grader's inputs before any verdict above was written:
- Creatures and flora carry a colour-region mask that the game fills with a species' or planet's palette; the review
  scene and the turntable first showed the raw mask (a rainbow no player sees). Both now fill it as the game does,
  with the representative palettes in `@astra/shared/art` (`gameLook`).
- `LIB_EngineGlow` exported a black emissive (strength 0); fixed in the library, and the validator now fails any
  signal material that emits nothing.
- The asset's own cost in `perf.json` (scene shown minus hidden) is noisy on a loaded machine: crystal_0's noon cost
  read 27.8 ms and re-measured at 0.34 ms. Graders should treat a single outlier as noise; the readout is to take
  paired shown/hidden samples (open item).
- Graders asked for a 100 m view at LOD2 (ship, creatures, flora) and a collider and marker overlay (structures);
  the review scene is to add both before the first art task is graded (open item).

### The demo ship (as P1.E12.T02's Lark)

```
VERDICT: REVISE
TASK: P1.E14.T09 calibration: demo ship (as P1.E12.T02's Lark)
SCORES: design 1, silhouette 3, proportion 3, materials 1, detail 2, topology 2, consistency 2, fitness 1, placeholder 2, performance 3 (mean 2.0)
NOTES:
- design: generic sci-fi kitbash (box-inset plates, capsule wing pods, cylinder nacelles); nothing from the peoples. Rebuild in the Compact combined language (art bible 2.4): Thalune lapped shell plates over fuselage and nacelles, Ulgani triangulated frame at pylons and wing roots, Ixari crystal canopy panes in socket collars.
- silhouette: no LOD2 and every capture at ~20 m, so the 100 m read is unproven; give the hull one dominant mass (a broad dorsal shell) and drop the outline clutter (antennas, dorsal and wingtip fins, capsule pods): a sturdy generalist, not a busy fighter.
- proportion: no source with REF_Grid/REF_Biped (validate fails scale references); seat the 1.85 m biped (seat point 1.2 m above the cockpit floor, 1.70 m eye clear of the canopy frame); keep the 1.95 m gear height and add a reachable boarding step or ladder.
- materials: 12 flat uniform colours, no maps (13 validator failures); bake 4k PBR maps from LIB_PaintedPlate/TrimMetal/DarkMetal with leading-edge chips, intake and gear-bay grime, nacelle soot; trim off mirror chrome (roughness >= 0.3); EngineGlow blooms the rear third to white in all cases; the orange Accent (0.92, 0.30, 0.05) is on no palette row.
- detail: one-scale greebles between empty colour fills; add panel seams, lapped plate edges, hatches, fasteners, stencils, a registration decal at ~512 px/m, concentrated at engines, intakes, gear bays and canopy.
- topology: no LODs (the LOD2 captures show LOD0; open-space LOD0/LOD2 byte-identical); fan-triangulated slivers on flat plates; an over-dense canopy.
- consistency: build from the library (Hull, Trim, Dark, Glass), drop ad hoc Interior/SensorGlow/VentGlow, ship the three liveries of art bible 7.
- fitness: missing HP_S_L/HP_S_R (validator fails), COL_ colliders, Gear* pivots, hinged Canopy*, a visible cockpit interior (the teal glass is opaque), a damage state, a husked variant.
- placeholder: reads as script-built from primitives with flat fills; hand-model the nacelles (lips, bevels, pylons) and texture worn panelling.
- performance: the asset's own cost is fine (0.39–0.86 ms GPU, 61,750 tris, hero budget) but with no LODs every Lark costs that at any distance and 44 draw calls; add four LODs, merge by material (<= 12 draw calls at LOD0).
WOULD REQUEST: the open-space case framed from 100 m to score the silhouette at its read distance.
```

Artifacts: `assets/renders/calibration/ship_{turntable,materials}.png`, `ship_materials.txt`, `assets/renders/review/ship/*` (three lighting cases at LOD0 and LOD2, wireframe, sheet, perf.json), `assets/renders/calibration/ship_validate.txt`.

### The demo box station (as P1.E11.T01's Waystation)

```
VERDICT: REVISE
TASK: P1.E14.T09 calibration: demo box station (as P1.E11.T01's Waystation)
SCORES: design 1, silhouette 3, proportion 3, materials 1, detail 2, topology 3, consistency 2, fitness 2, placeholder 1, performance 3 (mean 2.1)
NOTES:
- design: a generic 2001-style wheel (plain torus, cylinder spokes and tower, a rust-brown bay box); nothing Compact. Rebuild to art bible 2.4 (Thalune shell plates over an Ulgani lattice frame, Ixari crystal windows) in the Compact palette (#F4F4F0, #22406A, #F28C28); the rust reads as the Reaches' oxide red; the cold-cyan emissives belong to glyph light (bible 3.4), use nav white; replace the real-world "H" pad markings and ISO containers with Compact pad markings and cargo pods.
- silhouette: front-on a ring with a box bolted across; give the bay a shaped mouth (a stepped shell hood with lattice ribs) and make ring, spine and habitat distinct masses in three-quarter view; supply a LOD2 view from >= 100 m.
- proportion: no REF_Biped or grid; the door at the top of the hangar's back stair is 3–4 times the figure's height (spec 3.0 × 2.0 m) and the stair is far steeper than 0.18/0.30 m; railing 1.05 m.
- materials: flat colours plus one uniform tiled panel grid everywhere; no roughness or metallic variation, wear, grime or scuffs; author in LIB_PaintedPlate/TrimMetal/DarkMetal with baked AO, hand-painted wear at the bay lip, pad rings and walkways, trim-sheet variation and decals; noon-lush and night-exotic were not captured.
- detail: no plate seams, clamps, airlocks, radiators, antennas or habitat windows outside; flat walls and floor inside; model seams, ribs, gantries, door tracks, floor plates with tie-downs and drains at kit density.
- topology: no wireframe pass, LOD captures or validator report; the primitives shade cleanly and the approach clip does not pop.
- consistency: exterior and interior share no language; parked hulls are panelled far denser than the station; most of the named kit is missing (trade deck, fabricator, habitat, bay door, the Scrapyard kit).
- fitness: the player's ship and another ship sit on the same pad intersecting in the hangar capture and all 60 clip frames; about 4 pads against 24 per bay phase; no trade-deck or fabricator interact points visible.
- placeholder: unmistakably the procedural stand-in (torus, cylinders, UV spheres, box containers).
- performance: no perf readout, triangle or texture counts.
WOULD REQUEST: an exterior capture in the #review scene with the wireframe pass at LOD0 and LOD2 and the perf readout.
```

Artifacts: `assets/renders/ui/station-exterior/{16x9,21x9,clip-sheet}.png` and `_frames/`, `assets/renders/ui/station-hangar/{16x9,21x9,clip-sheet}.png` and `_frames/` (procedural: no turntable, material sheet or validator report).

### The demo structures (as P1.E10.T08 and P1.E14.T08)

```
VERDICT: REVISE
TASK: P1.E14.T09 calibration: demo structures (as P1.E10.T08/P1.E14.T08)
SCORES: design 1 (outpost_0 1, monolith_0 2), silhouette 4, proportion 2 (outpost_0 2, monolith_0 3), materials 1 (outpost_0 2, monolith_0 1), detail 2 (outpost_0 3, monolith_0 2), topology 2, consistency 2, fitness 3, placeholder 2, performance 3 (outpost_0 3, monolith_0 4) (mean 2.2; outpost_0 2.4, monolith_0 2.5)
NOTES:
- design: outpost_0 is generic sci-fi (geodesic dome, shipping containers, hazard-striped helipad, solar array, dish mast); rebuild as Compact architecture (art bible 2.4) in its palette, reading as abandoned in a hurry (DESIGN ch. 10). monolith_0 is an Egyptian obelisk in a Stonehenge trilithon and stone circle (Earth ruins, not a Cartographer marker); rebuild as a basalt marker and drop the lilac crystal shards (the Ixari motif).
- proportion: monolith_0 16.99 m tall, under the 18–26 m band (rebuild ~22 m); outpost_0's pad ~12–14 m against 24 m for Tier 0–1 hulls (a Lark's 13.4 m span does not fit); no source .blend, so grid and biped unchecked; airlock door >= 2.4 × 1.4 m.
- materials: every material a uniform colour with no maps; monolith_0's meshes have no UVs; its Stone is not basalt (navy at noon, pink-beige in open space) and its lilac GlyphGlow breaks the glyph-light colour rule (#D8F6FF core, #7FD8FF halo); link LIB_Basalt/LIB_GlyphLight and the hull library set, bake 2k maps, hand-paint wear at the airlock, pad edge and fittings.
- detail: a blank obelisk with one glowing strip and smooth-blob stones; cut glyph columns 2–4 cm deep with a V-section, add spalls and weathering; outpost_0's detail is clean primitives and random tile swaps.
- topology: 1 of 4 LODs for both (LOD2 captures show LOD0); outpost_0's pad cap is a centre fan of slivers.
- consistency: no library materials (ad hoc Stone, GlyphGlow, Warm, Lamp, Glow, Solar); the family is incomplete against the tasks (2 of 3 outposts, 2 of 3 monoliths, no anchor stones).
- fitness: outpost_0's pad stands on a ~2 m plinth with no steps or ramp; colliders (35/23) and markers (4/3) exist but no capture shows them (add a collider overlay pass and show the Interact markers).
- placeholder: raw extruded box plinths, a primitive cylinder pad, a UV-sphere dome, flat debris tiles; a ring of identical box flagstones with random gaps and shards; both untextured.
- performance: outpost_0 costs 1.2 ms GPU at night for 24k triangles (0.38 ms at noon; monolith_0 0.16–0.26 ms); no LOD chain across 110–160 sites per planet; find what doubles its night cost.
WOULD REQUEST: turntables of the siblings outpost_1 and monolith_1, to score consistency against the rest of the family.
```

Artifacts: for outpost_0 and monolith_0: `assets/renders/calibration/structures_<asset>_{turntable,materials}.png`, `assets/renders/review/structures/<asset>/*`, and `assets/renders/calibration/structures_validate.txt`.

### The demo creatures (as P1.E08.T08)

```
VERDICT: REVISE
TASK: P1.E14.T09 calibration: demo creatures (as P1.E08.T08)
SCORES: design 2, silhouette 3, proportion 2, materials 1, detail 2, topology 2, consistency 4, fitness 2, placeholder 1, performance 4 (mean 2.3)
NOTES:
- design: generic toy aliens with mascot faces (sphere button eyes, a stitched smile on quad_grazer_0, a grin and dot nostrils and a pot belly on biped_0, panda patches on flyer_0); build skulls and eye sockets from each plan's ecology (a grazer's grinding jaw and wide-set prey eyes, an armoured brow and horn bosses for the heavy); quad_heavy_0's dark crystal clusters copy the stone-touched read (DESIGN 12.3), keep crystals for that overlay.
- silhouette: the four plans are distinct but the predators don't read as predators (biped_0 upright with stub arms and a smile, flyer_0 a flat moth); rebuild biped_0 forward-pitched with a counterweight tail, long clawed forelimbs and an open-able jaw, flyer_0 with swept raptor wings and talons; drop thin parts that vanish at 100 m (quad_grazer_0's ball-tipped antennae).
- proportion: every quad 1.40 m overall, so quad_heavy_0 is far under its 2.5–5 m shoulder band and quad_grazer_0's ~0.8 m shoulder under 1.2–2.4 m; no creatures.blend with REF_Grid/REF_Biped; fix anatomy (uniform capsule legs, stub forelimbs a sixth of the height).
- materials: all ten variants untextured (vertex colour, no UVs, one flat material at roughness 0.7); posterised banding and per-triangle stair-stepped stripes and spots; UV-unwrap, bake 2k maps, keep the colour-region mask, add hand-painted roughness (glossy eyes, glossier horn and shell), a skin/scale/plate normal map, AO from the creature's own geometry, wear at horn tips, shell edges and foot pads.
- detail: LOD0 4.6k–5.5k triangles, a third of the 15k creature floor; vertex-colour gradients where geometry is expected (shell seams, painted stripes, stuck-on dots); sculpt landmarks, folds, toes and claws, bevelled scutes, wing venation and a membrane edge.
- topology: irregular triangle soup with slivers; 1 of 4 LODs; union seams at the necks; faceted feet and horns; flat card wings; retopologise to quad-dominant loops at the joints (the limb rig needs them) at 15–40k, with LOD1–LOD3.
- fitness: _LIMB/_PIVOT/_GLOW present so the instanced rig runs, but limbs are rigid integer ids (no hand-weighting, will shear); no attack-pose data; the predator variants, outpost drone and Overseer are missing.
- placeholder: reads as primitive-assembled (sphere eyes, ball-tipped antennae, capsule legs with blob feet, card wings, stacked-ring abdomen, stub-capsule arms); rebuild each plan by hand from a sculpt.
WOULD REQUEST: one noon-lush capture of the four together at 100 m, mid-stride.
```

Artifacts: for quad_grazer_0, quad_heavy_0, biped_0, flyer_0: `assets/renders/calibration/creatures_<asset>_{turntable,materials}.png`, `assets/renders/review/creatures/<asset>/*`, and `assets/renders/calibration/creatures_validate.txt`.

### The demo flora (as P1.E14.T04/T05)

```
VERDICT: REVISE
TASK: P1.E14.T09 calibration: demo flora (as P1.E14.T04/T05)
SCORES: design 2, silhouette 3, proportion 3, materials 1, detail 2, topology 2, consistency 3, fitness 3, placeholder 2, performance 3 (mean 2.4)
NOTES:
- design: stock Earth low-poly (a lollipop broadleaf, a Christmas-tree conifer, a green fly agaric, a quartz cluster, a pebble); give each a nameable alien trait (crystal growth terraces and a dark-stone socket collar; a gilled mushroom underside with spore-light points; an asymmetric multi-limbed crown; ore growing out of fractures).
- silhouette: rock_0 an egg and bush_0 a ball on a pin from every angle; tree_round_0's crown one undivided blob; fractured planes and a bedding face, a multi-lobed bush on several stems, a 2–3-lobe crown showing limbs; resubmit with a 100 m LOD2 capture.
- proportion: no source .blend with REF_Grid/REF_Biped (validate fails scale); bush_0's 1.8 m ball on a 0.3 m stem; tree_conifer_0's bottom tier hides the trunk; tree_round_0's trunk too thin for an 8.3 m crown.
- materials: one flat vertex-colour material, no UVs or maps (79 validator failures), the same roughness on bark, leaf, stone and crystal; rock_0 flesh-peach and crystal_0 washed near-white in open space; UV and bake a 1k PBR set (bark, leaf, basalt-like stone, a grown crystal ~0.08 roughness with a clouded core), keeping the colour-region mask as a tint over base colour.
- detail: a smooth 490-triangle ellipsoid rock; ore as flat colour splats; perfect hexagonal crystal prisms; trunks without bark; model inset ore veins, bark, stone and crystal detail readable at 5–30 m.
- topology: LOD0 and LOD1 only, no LOD2/LOD3 or 400 m impostor (40 validator failures); LOD1 throws foliage shards outward, shows back-facing cards, collapses warts; deposit_0's ore patches move between LODs (mask not preserved).
- consistency: three surface idioms (shard cards, smooth clay, hard facets) and no LIB_ material; one stylisation rule and the library for all.
- fitness: 0 colliders and 0 markers; mineable assets lack Interact points; bush_0's pin stem hovers on slopes; T05's four deposit kinds exist only as two meshes in different mask colours.
- placeholder: a deformed ellipsoid, a sphere studded with cards, a radial array of identical prisms, perfectly symmetric star tiers: script output (DESIGN 19.1); re-author by hand.
- performance: own cost small (one draw call, mostly < 0.6 ms GPU) but not within budgets (2 of 4 LODs, no impostor, sampled trees below the 3k floor); crystal_0 at noon-lush measured 27.8 ms more shown than hidden (re-run requested), rock_0 4.5 ms at night.
WOULD REQUEST: a re-run of crystal_0's noon-lush perf, shown and hidden.
RERUN (orchestrator): crystal_0 noon-lush own cost re-measured at +0.34 ms GPU (scene 26.0 ms median); the 27.8 ms was load noise in the shown-minus-hidden difference (night-exotic and open-space re-measured at +0.01 and +0.19 ms).
```

Artifacts: for tree_round_0, tree_conifer_0, tree_mushroom_0, bush_0, rock_0, crystal_0, deposit_0: `assets/renders/calibration/flora_<asset>_{turntable,materials}.png`, `assets/renders/review/flora/<asset>/*`, and `assets/renders/calibration/flora_validate.txt`.

## P1.E06.T04 Suit inventory and cargo pods (UI)

Graded before this file existed; the scores are recorded here, the full notes are in the session that ran them.

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | hierarchy 4, HUD fit 4, motion 4, palette 3, correctness 3, spec 4, performance 4 | 3.71 |
| 2 | REVISE | hierarchy 4, HUD fit 4, motion 4, palette 4, correctness 5, spec 4, performance 5 | 4.29 |
| 3 | PASS | hierarchy 4, fit 5, motion 4, theme 5, correctness 4, spec 5, performance 5 | 4.57 |

Round 1's notes: the resource pips' saturated hues collided with danger red and the amber accent (fixed by the art
bible §4 "Resource pips" exception: shape by family, muted hues); a hauler's fourth pod was cut off by a fade mask with
no scroll affordance (fixed with collapsing pod lists and a scrollbar). Artifacts: `assets/renders/ui/inventory*/`.

## P1.E13.T02 Nineteen resources (icons)

Graded with the UI rubric on the inventory's nineteen resource icons; the six formation models are procedural stand-ins
graded as authored art under P1.E14.T06 (DECISIONS).

```
VERDICT: PASS
TASK: P1.E13.T02 (icons)
SCORES: hierarchy 4, fit 5, motion 4, theme 5, correctness 4, spec 5, performance 5 (mean 4.57)
```

Artifacts: `assets/renders/ui/inventory/{16x9-resources,16x9,21x9,clip-sheet}.png`, `assets/renders/ui/inventory/_frames/`.

## P1.E09.T04 Cutscene tooling

```
VERDICT: PASS
TASK: P1.E09.T04
SCORES: hierarchy 4, fit 5, motion 4, theme 5, correctness 4, spec 5, performance 5 (mean 4.57)
WOULD REQUEST: a 60 fps clip of one Space line-jump (with its dip) and one Esc skip mid-line.
```

Artifacts: `assets/renders/ui/cutscene-test/` (16x9, 21x9, approach, return, clip sheet, 804 frames); the requested
line-jump and skip clips were added after the verdict in `assets/renders/ui/cutscene-test-jump/` and `-skip/`.

## P1.E07.T02 Heat and Charge (HUD meters)

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | hierarchy 3, fit 5, motion 4, theme 4, correctness 3, spec 4, performance 5 | 4.00 |
| 2 | REVISE | hierarchy 4, fit 5, motion 4, theme 4, correctness 3, spec 5, performance 5 | 4.29 |
| 3 | REVISE | hierarchy 3, fit 4, motion 4, theme 4, correctness 4, spec 5, performance 5 | 4.14 |
| 4 | REVISE | hierarchy 3, fit 5, motion 4, theme 4, correctness 4, spec 5, performance 5 | 4.29 |
| 5 | PASS | hierarchy 5, fit 5, motion 5, theme 4, correctness 5, spec 5, performance 5 | 4.86 |

Round 1: OVERHEAT and the Charge rate under 4.5:1 over bright ground; the heat arc drew full at any level (the fill now
follows heat ÷ capacity). Round 2: the Charge arc swept up from empty, red, on the ship HUD's first frames (now set at
its value with transitions off, `.low` from the server's value). Round 3: the heat arc washed out against the beam's
glare (1.15:1); the altitude numerals touched the CHARGE plate; gauges popped on. Fixed with an opaque track inside a
near-black halo, 4.5 px strokes, an unplated Charge readout in the altitude's style, 150 ms fades, and Charge kept lilac
as an art bible §4 exception (teal is the shield's and the jetpack's). Artifacts: `assets/renders/ui/hud-{foot,foot-exit,ship,ship-board}/`.

Round 4: the beam-held heat arc now reads (fill 6.5:1 against its track, halo about 15:1 against the glare), OVERHEAT
8.2:1, the Charge figure 8.8:1, CHARGE EMPTY 5.4:1. Still failing: the Charge rate "+2.0/s" over the planet's bright
limb (2.3:1 against its halo, 1.2:1 against the limb) and the grey CHARGE label (about 3:1 where the limb turns blue);
the lockout's red fill against the empty track at about 2.9:1 (under 3:1 for non-text UI). Requested: an idle cool-down
clip from about 30 heat to 0. **Escalated to the owner after four REVISE rounds (plan 0.5); marked `[!]`.**

Round 5 (2026-10-31, the owner's rule: one more grade, then merge), on the tree merged with main: PASS. The Charge rate
sits on a solid 2 px ring at 13.5:1 over the limb, the CHARGE label is 11.7:1, the lockout red is 3.6–3.9:1 against its
darkened track, and the idle cool-down drains and fades out with no pop. Minor: the rate's #E2D4FF and the text red
#FF8A80 are not in art bible §4; `HUD.arc` snaps on any jump over 8% (an ability's heat chunk or a Waystation refill
would pop; P1.E07.T03 eases it); `hud-ship-board` stills show the ship before its reticle; the empty Charge track is
1.85:1 against its halo (the red readout carries the state). Artifacts: `assets/renders/ui/hud-{foot,foot-cool,foot-exit,ship,ship-board}/`.

## P1.E04.T02 Remote entities (in-engine scene)

Graded with the UI/HUD/VFX table read for an in-engine scene; the ship model's own art is P1.E12.T02's.

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | legibility 3, hud-fit 4, motion 4, palette 4, correctness 3, spec 2, performance 4 | 3.43 |
| 2 | REVISE | legibility 3, hud-fit 4, motion 4, palette 4, correctness 3, spec 4, performance 3 | 3.57 |
| 3 | REVISE | legibility 3, hud-fit 4, motion 3, palette 4, correctness 3, spec 4, performance 5 | 3.71 |
| 4 | REVISE | legibility 3, hud-fit 4, motion 4, palette 4, correctness 3, spec 4, performance 5 | 3.86 |
| 5 | REVISE | legibility 4, hud-fit 4, motion 4, palette 4, correctness 4, spec 4, performance 5 | 4.14 |

Round 1: 24 identical Larks in a grid with no markers (unreadable crowd); distant remote ships badly aliased; no capture
of a ship on a pad, near the planet or of an NPC ship, and no engine glow by speed. Fixed with `player` HUD markers gated
on sensor detection, a varied 24-pilot crowd, three LODs by screen length, speed-scaled glow and exhaust, and `-pads`
and `-surface` captures; the server sends no NPC ships until P1.E08.T05. Artifacts: `assets/renders/ui/remote-ships*/`.

Round 2: marker range text overlaps its own ship and falls to 1.3–2.4:1 over lit ground; markers hang at a fixed world
offset, so they drift hundreds of pixels off near ships, and collide with the fixed HUD and each other; far Larks
shimmer; pads (+3.97 ms for 3 ships) and surface (+3.0 ms, over 16.7 ms) cost out of proportion, the coarsest LOD is 25%
of LOD0 (§19.2 wants under 5%) and casts shadows. Requested: a full bay phase, 24 Larks docked, with the perf readout.

Round 3: performance now passes (crowd +0.25 ms, bay +1–1.5 ms, coarsest LOD 2.8%, +17 draw calls). Still failing: name
labels sit past the ship's screen bounds, 100–220 px from their own diamond; remote nav and strobe lights flash full on
for one frame and their bloom grows with distance (250–350 px at 1–2 km, brighter than the local ship's); markers still
meet the EDGE line, the speed readout and the local ship in motion; the coarsest LOD starts at 130–200 m and smears;
the landed remote ship shows no gear or ground contact.

Round 4: labels now sit 8 px from their diamonds with no HUD overlaps in any clip frame, distant strobes no longer
bloom, and the landed ship stands on its gear. Still failing: past about 190 m the coarsest LOD breaks into speckle
that reshuffles every frame (heading unreadable); several ships in plain view get no diamond (a Lark closing through the
crosshair, five diamonds for 24 docked ships, the ship dead ahead on the pads), and markers cut in and out in one frame
or swap label sides. Requested: a debug overlay of sensor detection per ship. **Escalated to the owner after four REVISE
rounds (plan 0.5); marked `[!]`.**

Round 5 (2026-10-31, the owner's rule: one more grade, then merge): every criterion at 4 or above, and every round-4
note fixed: the coarsest LOD holds a solid silhouette past 190 m, every ship in plain view keeps a diamond (the Lark
through the crosshair, the pad Lark, the bay), markers keep their sides, and the requested sensor overlay shows every
pilot detected, so earlier gaps were screen logic. Still under the 4.5 mean: labels all one weight from 10 m to 4 km;
up to 20 marks at once; a fading label left behind its moving diamond and fades of 80–130 ms ending in a snap; the
diamond stroke at about 70% of the teal; far names drawn over a nearer hull; no capture of a withheld or boosting
signature. Merged under the rule; the notes are P1.E04.T06. Performance: the remote layer 0.21–0.5 ms CPU, +9–18.5
draw calls, coarsest LOD 3.2% of LOD0. Artifacts: `assets/renders/ui/remote-ships*/`.

## P1.E05.T01 Skeleton and three base bodies (art)

Graded per people with the "Models and environments" table, each file as a family of ten variants.

| Round | People | Verdict | Scores | Mean |
|---|---|---|---|---|
| 1 | Thalune | REVISE | design 3, silhouette 3, proportion 4, materials 3, detail 2, topology 3, consistency 4, fitness 3, placeholder 3, performance 4 | 3.2 |
| 1 | Ixari | REVISE | design 3, silhouette 3, proportion 3, materials 2, detail 2, topology 4, consistency 4, fitness 3, placeholder 2, performance 4 | 3.0 |
| 1 | Ulgani | REVISE | design 2, silhouette 3, proportion 4, materials 2, detail 2, topology 3, consistency 4, fitness 3, placeholder 2, performance 4 | 2.9 |
| 2 | Thalune | REVISE | design 3, silhouette 3, proportion 4, materials 3, detail 3, topology 3, consistency 4, fitness 3, placeholder 3, performance 4 | 3.3 |
| 2 | Ixari | REVISE | design 3, silhouette 3, proportion 4, materials 3, detail 3, topology 4, consistency 4, fitness 4, placeholder 3, performance 4 | 3.5 |
| 2 | Ulgani | REVISE | design 3, silhouette 3, proportion 4, materials 3, detail 3, topology 3, consistency 4, fitness 4, placeholder 3, performance 4 | 3.4 |
| 3 | Thalune | REVISE | design 3, silhouette 3, proportion 4, materials 3, detail 3, topology 3, consistency 4, fitness 3, placeholder 3, performance 4 | 3.3 |
| 3 | Ixari | REVISE | design 3, silhouette 3, proportion 4, materials 3, detail 3, topology 4, consistency 4, fitness 4, placeholder 3, performance 4 | 3.5 |
| 3 | Ulgani | REVISE | design 3, silhouette 4, proportion 4, materials 3, detail 3, topology 3, consistency 4, fitness 4, placeholder 3, performance 4 | 3.5 |

Round 1, common to all three: mascot faces (a fixed smile, goggle or button-ring eyes, no nose, lips or brow); smooth
mannequin bodies without anatomical landmarks; suits from primitives (torus bands, rounded boxes, straight rods) that
break each people's design language (Ixari facets, Thalune shingled shell, Ulgani grown chitin lattice); heads that differ
only by small cards, unreadable past 10 m; uniform-noise skin; in-engine material errors (back-lit fins black, nacre as
chrome, crystal as white plastic, Ulgani toe bleed); uniform remeshed LOD0 with no loops at the face or joints; blinks
that bulge instead of closing; L/R shape pairs missing; Ulgani feet 3.9 cm above the ground. Artifacts:
`assets/renders/characters/`, `assets/renders/review/characters/`.

Round 2 (2026-10-31, at 5fa9b38e, from the KTX2 + meshopt exports; the review camera had framed the feet of quantized
skinned bodies until this round): faces are no longer mascots (Ixari and Ulgani lidded, Thalune neutral slit), blinks
close, L/R pairs exist, heights and feet are fixed, the Ixari and Thalune suits speak their languages, crests reach
20–38 cm. Still failing on all three: the six heads share one skull and differ only above the scalp; bodies below the
neck are mannequins with few landmarks; suits lack seams, weave, padding and wear; nothing breaks the outline at 100 m
except colour. Per people: Ixari's suit crystal is a flat regular hex array and its skin reads navy at noon; Thalune's
eyes bulge past the skull, its nacre bakes as metal (black at noon and night), its blink is a translucent bubble and its
neck folds; Ulgani's lattice is straight tubes over a unitard with torus rings, white flank cards and toe bleed. The
in-engine wireframe pass draws a mis-posed copy of each body, so LOD0 loops could not be checked in-engine. Verdicts in
full: `~/.local/state/t3-pstack/orchestrate/astra-nullius/verdicts/p1e05t01_r2_*.md`. Artifacts as in round 1.

Round 3 (2026-10-31, at dc3463b9): the wireframe now draws on the posed body; the black Ulgani crest and Thalune
nacre at noon were baked occlusion and are fixed; Ulgani's suits are chitin lattices over bare skin; Ixari's tiles are
raised and tinted. Scores stalled (3.3, 3.5, 3.5). Still failing on all three: no anatomy below the neck, heads that
differ only above the scalp, skin that shifts colour between the lighting cases, nothing breaking the outline at 100 m
but colour, and toes that regressed into torn shards. Per people: Thalune's eyes still bulge and its hands are not
webbed; Ixari's crystal is one reused straight shaft; Ulgani has no pore pits and its fronds repeat. Round 4 is a
focused pass on the notes repeated across rounds 2 and 3.

## P1.E04.T05 Login and character screens (UI)

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | hierarchy 4, fit 5, motion 3, theme 5, correctness 3, spec 4, performance 5 | 4.14 |
| 2 | REVISE | hierarchy 4, fit 5, motion 3, theme 5, correctness 4, spec 4, performance 5 | 4.29 |
| 3 | REVISE | hierarchy 3, fit 5, motion 3, theme 5, correctness 4, spec 4, performance 5 | 4.14 |
| 4 | PASS | hierarchy 4, fit 5, motion 4, theme 5, correctness 5, spec 4, performance 5 | 4.57 |

Round 1: screen changes cross-dissolve in place, so outgoing and incoming headers overlap for about 7 frames; entering
hard-cuts from the lit menu to flat black; the panel snaps to the shorter screen's height mid-fade and clips the
outgoing screen (Create and Back cut to a sliver while the request is pending). Contrast is 4.9–16.3:1 on the panel;
the title tagline, ordinals and BUILD line sit at 2.7–3.2:1 over the planet limb. Requested: registering a fresh
account with a refusal, landing on an empty list. Artifacts: `assets/renders/ui/{title,login-error,characters,create,entering,account-flow}/`.

Round 2: steps now sequence and nothing clips; still failing: the cut into the world fades only to about 20% black and
then jumps to flat black in one frame, its amber fill cut at 10%; the sign-in error box collapses in two frames while
the layout eases; JOINING swaps to IN THE WORLD in one frame. Requested: the arrival with pointer lock granted (the
captured arrival lands on the pause menu with no scrim, ordinals 3.6–3.8:1).

Round 3: the fade to black and up, the step sequencing and the error box are clean; the panels and pause menu pass AA.
Still failing: on arrival the location line and the banner's eyebrow sit on a lit ceiling beam at 2–2.6:1; the slot
counter is 4.3–4.5:1; "JOINING" and "IN THE WORLD" overlap for about 10 frames, as do the rail ordinal and its tick;
the Esc hint vanishes in one frame; the selected-row tint jumps rows. Requested: the list at 6 of 6.

Round 4: PASS. Artifacts: `assets/renders/ui/{title,login-error,register,characters,characters-full,create,entering,account-flow,arrival}/`.

## P1.E15.T03 Chat and party UI (with the beacon list)

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | hierarchy 4, fit 4, motion 3, theme 4, correctness 3, spec 4, performance 5 | 3.86 |
| 2 | REVISE | hierarchy 4, fit 4, motion 3, theme 4, correctness 4, spec 5, performance 5 | 4.14 |
| 3 | REVISE | hierarchy 4, fit 4, motion 3, theme 4, correctness 4, spec 5, performance 5 | 4.14 |
| 4 | REVISE | hierarchy 4, fit 4, motion 3, theme 4, correctness 4, spec 5, performance 5 | 4.14 |
| 5 | REVISE | hierarchy 4, fit 4, motion 3, theme 4, correctness 4, spec 5, performance 5 | 4.14 |

Round 1: layout changes jump in one frame while the fades are eased (the feed stack on a new line, the feed swapped
and shifted 16 px as the panel opens, the invite card and party frame resizing on accept, a beacon refusal pushing rows
down); the beacon list overruns the panel with no scroll affordance; a world-marker label shows through the party frame
at 21:9; the leader row's tag column is misaligned. Requested: the muted state and an offline member. Artifacts:
`assets/renders/ui/{social,social-space,party,party-invite,beacons}/`.

Round 2: layout changes now ease; still failing: the open/close cross-fade overlaps two different lists as double text
for 4–5 frames; the action row on accept still changes in one frame; some eases end with a 2 px snap; the clip opens
with 12 frames of plate-less text over the limb. Requested: an overfull beacon list with a scroll clip.

Round 3: the list cross-fade, accept row, pixel snaps and opening frames are fixed; still failing: opening chat with an
invite card showing pushes the card down in two jumps and a stall; every tween stalls for one frame early; on accept,
the card's text and "Not in a party" show through the rows passing over them. Requested: a tab-switch clip.

Round 4: every layout move now eases with no stall (feed rise 7, 7, 5, 3, 2, 2, 1, 1, 1 px; the invite card, accept and
refusals clean); all text passes AA (feed 10–14:1, dim rows about 5:1). Still failing: on a tab switch the cleared
unread badge vanishes and the tabs to its right jump about 22 px in one frame, and the prompt label swaps in one frame;
the beacon list's scrollbar appears at full opacity in one frame. Minor: a repeated mute line, a refusal's wrap without
a hanging indent, "Not in a party" beside a PARTY tab with unread, shorter health bars on leader rows. **Escalated to
the owner after four REVISE rounds (plan 0.5); marked `[!]`.**

Round 5 (2026-10-31, the owner's rule: one more grade, then merge): the tabs now slide over 6 frames when a badge clears,
the prompt label cross-fades, and all four minor notes are fixed. Still failing motion: an overflowing beacon list drops
its scrollbar thumb (about 175 to 55) and its bottom-edge fade in one frame on every redraw, then eases them back over 6
frames, so they blink every 8 to 15 frames (`beacons/_frames` 048→049, `beacons-many/_frames` 017→018 and on); the
cleared badge itself is clipped away in two frames at full brightness. Minor: `party-invite/21x9.png` caught mid-fade;
the beacon scroll crawls 13 frames at a 1 px floor; the smallest caps tags sit at 4.4–4.6:1; no frame-time readout.
Merged under the rule; the notes are P1.E15.T04. Artifacts: `assets/renders/ui/{social,social-space,social-tabs,party,party-invite,beacons,beacons-many}/`.

## P1.E13.T05 Basic fabricator (UI)

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | hierarchy 4, fit 5, motion 3, theme 5, correctness 3, spec 5, performance 5 | 4.29 |
| 2 | REVISE | hierarchy 4, fit 5, motion 3, theme 5, correctness 4, spec 5, performance 5 | 4.43 |
| 3 | REVISE | hierarchy 4, fit 5, motion 3, theme 5, correctness 4, spec 5, performance 5 | 4.43 |
| 4 | PASS | hierarchy 4, fit 5, motion 4, theme 5, correctness 4, spec 5, performance 5 | 4.57 |

Round 1: all small text at or above 4.5:1; the craft sweep is eased but the button, stepper and LEARN snap state in one
frame around it, and the selected row flashes twice; after a ×3 craft the quantity stays at 3 while the row says CAN
MAKE 1 and the materials go red (clamp to the new maximum); the result flash sits flush on its rows. Requested: a LEARN
clip. Artifacts: `assets/renders/ui/{fabricator,fabricator-ship}/`.

Round 2: the button and controls now ease and the quantity clamps; still failing: in the learn clip the fading header
crosses the rising row; the row's tag and slot, and the footer status line, swap in one frame; the CRAFT label drops to
1.3:1 while fading back to disabled. Requested: the stepper at its maximum.

Round 3: the sequential out/in fade reads well where used; still failing: a craft's results (CAN MAKE counts, MAKES,
needs, the stepper and CRAFT ×n) swap at full opacity in one frame; moving the selection to an uncraftable recipe snaps
the CRAFT fill; the learn header still shows at 25% then 10% under the rising row. Requested: the stepper at 6 of 6.

Round 4: PASS. Artifacts: `assets/renders/ui/{fabricator,fabricator-ship,fabricator-learn,fabricator-limits,fabricator-limits-max}/`.

## P1.E12.T02 Lark, Swift, Kestrel, Mule (art)

Graded per hull with the "Models and environments" table, each file as a family of base, damaged and husked.

| Round | Hull | Verdict | Scores | Mean |
|---|---|---|---|---|
| 1 | Lark | REVISE | design 3, silhouette 3, proportion 4, materials 3, detail 3, topology 3, consistency 3, fitness 3, placeholder 3, performance 3 | 3.1 |
| 1 | Swift | REVISE | design 3, silhouette 4, proportion 4, materials 3, detail 3, topology 3, consistency 4, fitness 3, placeholder 3, performance 4 | 3.4 |
| 1 | Kestrel | REVISE | design 3, silhouette 4, proportion 4, materials 3, detail 3, topology 4, consistency 4, fitness 3, placeholder 3, performance 4 | 3.5 |
| 1 | Mule | REVISE | design 4, silhouette 4, proportion 4, materials 3, detail 3, topology 3, consistency 3, fitness 3, placeholder 4, performance 4 | 3.5 |
| 2 | Lark | REVISE | design 4, silhouette 5, proportion 4, materials 3, detail 4, topology 4, consistency 5, fitness 4, placeholder 4, performance 4 | 4.1 |
| 2 | Swift | REVISE | design 3, silhouette 4, proportion 4, materials 3, detail 3, topology 3, consistency 3, fitness 4, placeholder 3, performance 4 | 3.4 |
| 2 | Kestrel | REVISE | design 4, silhouette 4, proportion 4, materials 3, detail 4, topology 4, consistency 4, fitness 4, placeholder 3, performance 4 | 3.8 |
| 2 | Mule | REVISE | design 4, silhouette 4, proportion 4, materials 3, detail 4, topology 4, consistency 4, fitness 3, placeholder 4, performance 4 | 3.8 |

Round 1, common to all four: wear as uniform noise rather than placed by use; damaged variants indistinguishable from
the base at gameplay range; LOD0 budgets spent on uniform tessellation of flat plates rather than modelled detail
(nozzle throats, hardpoint mounts, hatches, fasteners where the language allows); no capture of the cockpit interior or
a boarding path; hardpoints without mount geometry. Per hull: the Lark still reads as a generic fighter under a tile
grid and misses the calibration's draw-call ask (65 against ≤12); the Swift reads as a jet with crystal glued on; the
Kestrel's lattice reads as stick-and-tissue rather than grown chitin; the Mule's form passes (design and silhouette 4)
but its liveries are swamped by nacre and it lacks BAY_* empties. Artifacts: `assets/renders/{lark,swift,kestrel,mule}_*`,
`assets/renders/review/hulls/`.

## P2.E21.T01 Event framework (banner announcement)

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | hierarchy 5, fit 4, motion 3, theme 5, correctness 5, spec 5, performance 5 | 4.57 |
| 2 | PASS | hierarchy 5, fit 4, motion 5, theme 5, correctness 4, spec 5, performance 5 | 4.71 |

Round 1: the clip was clean, but the shared banner queue let the next banner start at 6.2 s while the 7 s fade still
ran, so a queued banner vanished in one frame and the band restarted, which a login during an event always hits; the
eyebrow named no place; "in a minute" under 30 s. Round 2, with the requested `event-banner-queued` hand-off: the band
holds 19.7–20.6 across the hand-off, the largest band step is 3.7 grey levels, nothing pops; title 12.5–15.7:1, eyebrow
7.7–9.3:1. Minor: a third banner within 2 s was dropped as stale (fixed after the grade: the cutoff is three holds); the
full-width band stays heavier than the HUD language (a footprint scrim later, for all banners). Artifacts:
`assets/renders/ui/event-banner{,-night,-queued}/`.

## P1.E15.T04 Chat and party UI motion follow-ups

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | hierarchy 4, fit 4, motion 3, theme 4, correctness 4, spec 5, performance 4 | 4.00 |
| 2 | PASS | hierarchy 4, fit 4, motion 5, theme 4, correctness 5, spec 5, performance 5 | 4.57 |

Round 1: the scrollbar blink, the scroll crawl, the tag contrast and the mid-fade still were fixed; the cleared badge
still vanished in two frames (its close squeezed the face before the gap). Round 2: the badge fades whole (opacity 0.96
to 0.07 over 018–023 while the next tab slides), overflow fades start with the overflow, the party count waits for the
old line, meta lines 5.7–6.3:1, worst frames 0.7–1.0 ms; the requested `beacons-rest` shows no redraw at rest with
OFFLINE, LEAD and KICK. Minor: whole-pixel scroll steps; edge fades over the scrollbar's end; 1–3 px badge trim;
party-invite's worst frame at exactly 1.0 ms. Artifacts: `assets/renders/ui/{beacons,beacons-many,beacons-rest,social-tabs,party-invite}/`.

## P1.E07.T03 Ability runtime (ability bar and eased meter costs)

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | hierarchy 4, fit 4, motion 3, theme 3, correctness 4, spec 5, performance 4 | 3.86 |
| 2 | PASS | hierarchy 5, fit 5, motion 5, theme 5, correctness 5, spec 5, performance 5 | 5.00 |

Round 1: the cast flare went white for one frame; small heat chunks skipped the arc's ease, so the cost moved 2 px;
flight rings and timers in Charge lilac broke art bible §4; the refusal plate sat 480 px from its slot on the gun grip.
Round 2: the flare and cost ease together, every cost eases onto its arc drawn brighter, the flight bar is warm white,
the plate sits over its slot, names hide at rest, ready beats show, and the HUD stays under 1 ms; the requested 21:9
cost clip is in `hud-abilities-cost`. Minor: the cost eases run about 185–200 ms (asked 250); the flight ready beat
is about 70 ms; long flight names nearly touch at 1920. Artifacts: `assets/renders/ui/hud-abilities{,-flight,-cost}/`.

Round 2 of P1.E12.T02 (2026-10-31; the Lark, Mule and Kestrel at 3413edb7, the Swift at 72d2df4b): the Lark's shell
and silhouette now read (silhouette and consistency 5), the Kestrel's members curve and fuse like grown bone, the
Mule's dome and aft plate are clean and its damage reads at 100 m. Still failing on all four: wear as noise instead of
placed by use, 1024 bakes against the 4096 hero target, LOD2 maps not baked from LOD0, more than 12 draws, and
blockout cockpits, hardpoints or boarding paths. Per hull: the Lark's clean white hull and unscorched damage; the
Mule's colliders miss the pod, dome and aft plate and its strobe sits on the medium hardpoint; the Kestrel's uniform
crackle, tech stipple and box cockpit; the Swift still reads as a jet, with a material mosaic, whole-face emissive and
liveries that barely change it (its open-space GPU reading of about 7 ms came from a shared GPU and is to be
re-measured). Round 3 dispatched with the four verdicts.

## P2.E22.T02 The Edge moves (galaxy map, sky, dark stations)

| Round | Verdict | Scores | Mean |
|---|---|---|---|
| 1 | REVISE | hierarchy 3, HUD fit 4, motion 3, palette 3, correctness 4, spec 3, performance 4 | 3.43 |
| 2 | REVISE | hierarchy 4, HUD fit 5, motion 4, palette 4, correctness 4, spec 5, performance 5 | 4.43 |
| 3 | PASS | hierarchy 5, HUD fit 5, motion 4, palette 4, correctness 4, spec 5, performance 5 | 4.57 |

Round 1: the map label sat on the wall's brightest part at 1.2–1.6:1; the sky's wall re-rolled in one frame whenever
the Edge moved again, and the label hopped between anchors; the sky's Edge was saturated violet with mint ribbons
against the bible's opal; no capture showed a dark system. Round 2: the label on a plate (10.5–13.4:1), the sky's
re-roll and the label hop gone, violet and mint gone, the requested Broken-season capture in `edge-dark`; still the
info captions at 3.1:1, dark marks popping in one frame, grey rather than opal highlights, and a mark reading on a
neighbour's name. Round 3: captions 5.1–5.8:1, marks fade and flicker with their own seam-light names, opal crests at
every Count, sanctuaries exempt (Duntha unmarked), the Shift row, credits on a plate. Minor: a relit station's label
changes style in one frame while its ring eases out; the pale-blue and peach fringe play does not survive the sky's
grade; Venmirix and Tervelost's rings still interlock; the map's worst frame 2.6 ms; edge-dark's clip opens on a fading
selection. Artifacts: `assets/renders/ui/{edge-map,edge-sky,edge-dark}/`.


## 2026-11-02: retained component verdicts

These entries preserve previously issued verdicts retained outside this central log, with their original text and source hashes. They add no new grades. Historical performance scores reflect their original evidence; current shared timing qualification remains P1.E14.T13. Thalune and Ixari retain their fifth REVISE dispositions with follow-ups P1.E05.T07/T08. Ulgani awaits its fifth grade, and both station kits await their third. Whole-task code review and merged verification remain required.

### Thalune — round 4

Source: [p1e05t01_r4_thalune.md](/Users/andreyyurlov/.local/state/t3-pstack/orchestrate/astra-nullius/verdicts/p1e05t01_r4_thalune.md). SHA256: `c6af4e321d0571fcbb7d240c4d0305cbde61b90345c69348c6b27dc35de9adaa`.

````text
VERDICT: REVISE
TASK: P1.E05.T01 (Thalune), round 4 at 7337fc20
SCORES: design 3, silhouette 3, proportion 4, materials 3, detail 3, topology 3, consistency 4, fitness 3, placeholder 3, performance 4 (mean 3.3)
NOTES:
- **design:** the hands are still not webbed, and DESIGN 5 names webbed hands as a Thalune trait. In the palm and back-of-hand panels of thalune_hands_feet.png, the web is a small coral sliver at the finger roots, about a sixth of the finger length. The fingers stand apart from the knuckle down. Build each web as one continuous opaque skin surface between each pair of fingers. Its free edge should be a shallow concave arc that reaches the middle knuckle (about two-thirds of the finger length) and thins toward the edge, in skin colour with a faint coral rim. Keep the webs through LOD2.
  - The eyes are now set back correctly, but they are not "dark". In the Basis cell of thalune_blendshapes.png the irises are a speckled mid teal-green. Darken them to shelf blue #1F4E5F or deeper with a near-black pupil, so the eye reads as a large dark eye at 2–5 m.
- **silhouette:** at 100 m the Thalune is still a teal T-pose about 15 px tall, told apart from the Ixari and Ulgani only by colour. Suited, it is a blue stick. This shows in lineup_far_lod2.png, thalune_lineup_far_lod2.png and far_lod2.png for all ten variants. The new dorsal fin and the head crests are smaller than a pixel at that range. Give the body an outline that reads at the scale of the whole figure:
  - Widen the neck frills into a collar about 35–40 cm across from the front, wider than the head, so it breaks the neck-to-shoulder line.
  - Broaden and flatten the head at the jaw.
  - Make the webbed hands and feet visibly paddle-like.
  - To check, render far_lod2 for the three peoples in greyscale side by side. They must still be told apart.
- **materials:** the noon belly is fixed: pale ground, coloured cells, no black blots. Three problems remain:
  - **Skin gloss:** the skin is still mirror-glossy. In noon-lush_lod0 for head1, head4 and head6 the whole body reflects the sky and reads as wet latex, with a smeared teal streak down the right side of the torso and both legs. Raise skin roughness to 0.5–0.55 outside a small wet-sheen zone, or lower specular to about 0.35.
  - **Suit wear:** the only wear on the suits is still the shin salt speckle. Add scuffs and polish at the knees and elbows of SuitA and SuitB, verdigris on suit4's collar fastening, and a salt tide-line at the cuffs (art bible 2.1).
  - **Nacre glow:** the suit2 and suit3 shell plates render unlit at night (night-exotic_lod0). Add the LIB_Nacre low inner glow: #FFE7C2 emissive at about 0.05–0.1.
- **detail:** the Cycles turntables now show kneecaps, clavicles, a sternum line and faint knuckles. In engine (open-space_lod0, noon-lush_lod0) the limbs still read as smooth tubes. The elbow point, wrist tendons, ankle bones and calf carry no visible form. Deepen the baked normals or add geometry there until they read at 3–5 m in the review scene.
  - **Suits:** still no stitching, weave or padding (suit1 turntable: smooth cloth with one seam line). Bake stitch rows along the seams, a fine weave normal, and quilted padding under the shoulder plates.
  - **Gills:** the throat still has painted vertical lines on every head (thalune_heads_closeup.png). Cut 3–4 gill slits as geometry behind the jaw.
- **topology:** three defects remain.
  - **Brow and upper lid:** this mass self-intersects on every face. It has a hard planar cut at the inner end and a crumpled, jagged top edge, visible in the Basis cell of thalune_blendshapes.png and the head1, head3, head4 and head6 profiles in thalune_heads_closeup.png. Rebuild each brow and lid as one closed, smooth surface.
  - **Small shards:**
    - a torn nail on the outer finger in "back of the hand"
    - a dark jagged crease at the thumb root and a dark band across the thumb in "palm"
    - tiny shard spikes at the toe tips and between the toes in "toes from the front"
    - dark seam lines at the head1 and head4 fan roots
    - a dark pit in head3's neck in profile
  - **Density:** in thalune_bendtest_head1.png the head still renders almost solid while the torso shows an open grid. Move density from the head into the hands and feet.
- **fitness:** blink_L/R now close an opaque lid, but the closed lid bulges and folds under the brow. Make the closed lid a smooth curve that meets the lower lid line.
  - blinkUpper_L/R still show no change from Basis, and browDown_L/R show no visible travel. Give browDown 4–6 mm of downward and inward travel at the inner brow, and make blinkUpper visibly lower the upper lid.
  - Bottom-left view of thalune_bendtest_head1.png: in the crouch the head still drops face-down onto the chest. Spread the neck weights over both neck bones and the upper spine.
- **placeholder:** the fins are still flat cards with hard roots. Head6's crest is a straight flat sheet stuck into the back of the skull, and the head1, head3 and head4 fans meet the neck on a straight vertical line. The claimed skin fold does not show at close-up scale. Grow each fin from a visible skin fold 1–1.5 cm high, thicker at the root, and give the leading ray some thickness and curl.
  - **Heels:** each heel is a near-spherical ball wider than the ankle (turntable and bend-test back views). Reshape it into a heel pad.
  - **Calf and forearm fins:** these render as thin dark slits that read as cuts (head1 turntable back view, thalune_bendtest_head1.png back views). Give them thickness and a root fold, or remove them.
- **minor proportion:** heights of 1.80–1.87 m match the art bible's 1.80 m. The neck is still long against narrow shoulders, and the palms are rectangular mitts. Taper the palm toward the wrist.
- **minor consistency:** the family hangs together. At full-body scale (thalune_heads_family.png), head1 and head4 still read as the same skull with side fans. Give head4 a distinct outline, such as swept-back fans or broad cheek frills.
- **minor performance:**
  - **Measured:** LOD0 is 91–139k tris with 4 LODs and LOD3 at 3.4%, in 5–6 draws. Open-space GPU cost is 0.49–0.80 ms unsuited and 0.61–1.39 ms suited, and the open-space scene frame is 3.3–7.0 ms. Textures are 139/181 MB shown (213/277 MB at 8 bits a texel), under the 512 MB hero cap.
  - **Re-measure:** run noon and night on an idle GPU with the standard readout (600 warm-up frames, up to 720 pairs) to confirm those scenes hold 60 fps with the body. Also re-measure the open-space readings for head3, suit3 and suit4, which the tool marks unreliable.
  - **Still open:** mip streaming for remote bodies is still not addressed.

ROUND-3 NOTES:
- design, hands not webbed: not fixed (the webs are slivers at the finger roots).
- design, eyes the biggest form, push about 1 cm back: fixed (brow and cheek now make the profile).
- silhouette, 100 m read by colour only: not fixed.
- silhouette, dorsal ridge 6–10 cm: fixed (it stands off the back in the side views, but it does not read at 100 m).
- silhouette, head3 occipital lobe and head5 brow nubs: fixed (head3's hood reads in the family sheet; head5's nubs are still faint at full-body scale).
- materials, noon belly and black cells: fixed (the skin is still too glossy).
- materials, suit wear at knees and elbows, suit4 verdigris: not fixed.
- materials minor, nacre night glow: not fixed.
- detail, landmarks at knees, elbows, wrists, ankles, calves: not fixed (kneecaps and clavicles now show; elbows, wrists, ankles and calves do not read in engine).
- detail, knuckles: not fixed (faint bumps only).
- detail, stitching, weave and padding: not fixed.
- detail, gill slits as geometry: not fixed.
- topology, crumpled and torn toes: fixed (separate digits on a connected forefoot; tiny tip shards remain).
- topology, jagged creases over the brows: not fixed.
- topology, head3 fan-root gap and head1 fan seam: not fixed (straight roots; seam lines at head1 and head4).
- topology, head density against hands and feet: not fixed.
- topology, head sinking toward the shoulder in the bend test: not fixed.
- topology minor, stray line from the crown: fixed.
- fitness, opaque blink: not fixed (the lid is now opaque but bulges and folds under the brow).
- fitness, blinkUpper with no change: not fixed.
- fitness, browDown travel: not fixed.
- placeholder, fins as flat cards with hard roots: not fixed.
- placeholder, cells in a single file down the sternum: fixed (scattered, mixed sizes).
- placeholder, dark blot on the palm: fixed.
- minor performance, mip streaming: not addressed.
- minor proportion, long neck: not fixed.

ARTIFACTS: all under /Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/assets/renders/
- characters/thalune_turntable.png
- characters/thalune_thalune_thalune_{head1..head6,suit1..suit4}_turntable.png
- characters/thalune_heads_family.png, characters/thalune_suits_family.png (.txt)
- characters/thalune_materials.png, characters/thalune_thalune_thalune_suit2_materials.png
- characters/thalune_heads_closeup.png
- characters/thalune_blendshapes.png (.txt)
- characters/thalune_hands_feet.png
- characters/thalune_bendtest_head1.png, characters/thalune_bendtest_suit3.png
- review/characters/thalune/thalune/thalune_<variant>/{noon-lush,night-exotic,open-space}_lod{0,2}.png, wireframe_lod{0,2}.png, overlay.png, far_lod2.png, far200_lod2.png, perf.json, sheet.png (all ten variants)
- review/characters/lineup_far_lod2.png, review/characters/thalune_lineup_far_lod2.png
- characters/validate/characters__thalune.blend.json, characters/validate/characters__thalune.glb.json
````

### Thalune — round 5

Source: [p1e05t01_r5_thalune.md](/Users/andreyyurlov/.local/state/t3-pstack/orchestrate/astra-nullius/verdicts/p1e05t01_r5_thalune.md). SHA256: `42e0a7f0ff875eb8f90442f9d494d92f38c15379039d2df4e6a1521314d8874a`.

````text
VERDICT: REVISE
TASK: P1.E05.T01 (Thalune component), round 5 at 6b55969daea518ce03017540371a0fed1f42dd5f
SCORES: design 4, silhouette 3, proportion 4, materials 3, detail 3, topology 2, consistency 5, fitness 3, placeholder 3, performance 3 (mean 3.3)

Fresh native reviewer: /root/thalune_visual_review5. Artifact paths below are relative to /Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41.

NOTES:
- silhouette: Preserve a stronger gill-frill/head outline in LOD2. At 100 m, assets/renders/review/characters/thalune_lineup_far_lod2_grayscale.png reads as thin generic bipeds; the amphibious silhouette largely disappears, including in the enlarged crops.
- materials: Separate pearl-shell and fabric roughness and add localized polishing along shell edges. The plates in assets/renders/review/characters/thalune/thalune/thalune_suit3/noon-lush_lod0.png read as matte white plastic rather than nacre; shin mottling supplies most visible wear.
- detail: Add shaped garment seams, joint gussets and padding to the suit bodies. In assets/renders/characters/thalune_suits_family.png, especially suit4, the torso and limbs remain largely uninterrupted blue forms beneath shell ornaments.
- topology: Repair the visible triangular creases and surface discontinuities around brows, finger joints and toe ends, then verify the repaired surfaces across LODs. These are conspicuous in assets/renders/characters/thalune_heads_closeup.png and thalune_hands_feet.png, despite passing structural validators.
- fitness: Refine dialogue morphs so vis_MBP visibly closes the mouth and vis_FV produces a distinct articulation. The assets/renders/characters/thalune_blendshapes.png sheet retains the dark mouth slit for vis_MBP, while vis_FV remains nearly indistinguishable from Basis.
- placeholder: Sculpt continuous palm-to-digit transitions, rounded digit pads and integrated webbing. The hands/feet closeups still read as block palms and blunt tubular digits rather than finished hero anatomy.
- performance: Resolve or isolate the review-scene bottleneck and recapture evidence meeting the 16.67 ms frame budget. Suit2's perf.json records noon GPU median 27.837 ms, versus 27.364 ms with the asset hidden; its paired asset estimate is flagged unreliable. Geometry and texture budgets pass, but this loaded development session does not establish 60 fps or an attributable character performance regression.

ARTIFACTS: reviewer verified every listed hash in assets/renders/characters/validate/thalune-review5-inventory.json (179 files), read source/export validation and performance/generation context, and inspected component turntables, family/detail sheets, both bend tests, all ten review sheets, and distance lineups.

Orchestrator disposition: fifth REVISE preserved as REVISE. Remaining appearance/playability notes filed as P1.E05.T07; shared scene performance evidence as P1.E14.T13 under plan 0.1. Whole P1.E05.T01 remains unmerged pending the other components and remaining gates.
````

### Ixari — round 4

Source: [p1e05t01_r4_ixari.md](/Users/andreyyurlov/.local/state/t3-pstack/orchestrate/astra-nullius/verdicts/p1e05t01_r4_ixari.md). SHA256: `a8f7a653ca8c612e79e838b2e1156ebefe0d0de94a2d9ee66f3a7929db314f9c`.

````text
VERDICT: REVISE
TASK: P1.E05.T01 (Ixari component), round 4 at 6be95980aadbbd69544c141cf3b2b2e5e586e5bb
SCORES: design 4, silhouette 3, proportion 5, materials 3, detail 3, topology 3, consistency 5, fitness 4, placeholder 3, performance 3 (mean 3.6)

Fresh native reviewer: /root/ixari_visual_review4. Artifact paths below are relative to /Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41.

NOTES:
- silhouette: At LOD2/100 m, the crystal crown and forearm growths disappear into a generic slender biped outline. Strengthen grouped crystal masses and preserve their silhouette through LOD2. Evidence: assets/renders/review/characters/ixari_lineup_far_lod2_grayscale.png.
- materials: Suit crystals read as nearly uniform white patches, with little separation between facets, cloudy cores and luminous seams. Reduce broad-face emission and strengthen localized growth-line light, clouding and edge wear across all three lighting cases. Evidence: assets/renders/review/characters/ixari/ixari/ixari_suit3/open-space_lod0.png.
- detail: The four suits largely read as smooth unitards decorated with crystal clusters; broad knee patches do not convincingly describe padding or garment construction. Add shaped joint padding, seam relief and articulated garment transitions at knees, elbows and cuffs. Evidence: assets/renders/characters/ixari_suits_family.png.
- topology: Finger joints and toe roots show crumpled shading and dark slit-like discontinuities; several brow and mouth transitions also pinch. Clean those junctions and normals, then verify their shaded appearance through the LODs and deformation poses. Evidence: assets/renders/characters/ixari_hands_feet.png and ixari_heads_closeup.png.
- placeholder: The broad slab-like palms and blunt, nearly constant-width toes retain a primitive construction appearance. Sculpt palm-to-digit transitions, differentiated joint volumes, tapered digits and intentional fingertip/toe pads while preserving the long-jointed Ixari anatomy. Evidence: assets/renders/characters/ixari_hands_feet.png.
- performance: Geometry and texture budgets pass, but recorded full-scene GPU medians are 27.7–28.3 ms at noon and 23.4–24.5 ms at night, above 16.67 ms. Profile the full review scene and repeat all three cases under documented stable host conditions. The supplied session had host contention and no independent limiter profile; these results do not establish that Ixari caused the excess. Paired asset costs establish neither 60 fps nor whole-game performance. Evidence: assets/renders/review/characters/ixari/ixari/ixari_head1/perf.json and assets/renders/characters/validate/ixari-review4-performance-context.json.

ARTIFACTS: reviewer verified all hashes in the 179-file inventory, source/export validation, ten-variant review sheets, family sheets, turntable/material evidence, facial blendshape sheet and head1/suit3 bend tests.

Orchestrator disposition: same character worker receives the notes for one fifth revision/grade; source edits stay Ixari-specific while Ulgani's recovery process is waiting. Shared review-scene performance investigation belongs to P1.E14.T13. The whole character task remains unmerged.
````

### Ixari — round 5

Source: [ixari-review5-parent-relayed-verdict.md](/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/assets/renders/characters/validate/ixari-review5-parent-relayed-verdict.md). SHA256: `660b0f70555c7e21ff4ad854a554bd91e9ee90e7e06dd6aa93f839e59018b8f8`.

````text
# Ixari fifth visual review — parent-relayed verdict

TASK: P1.E05.T01
SPECIES: Ixari
REVISION: 5
REVIEWER: ixari_fifth_grade_sol
MODEL: gpt-6.1-sol
REASONING_EFFORT: xhigh
FORK_TURNS: none
ARTIFACT_HEAD: 0e625c1928a05ac90126320417f2d6efaacee926
PROVENANCE: Preserved verbatim from the parent agent's relay on 2026-11-02; this worker did not perform or reconstruct the independent grade.
GRADER_MANIFEST: assets/renders/characters/validate/ixari-review5-grader-packet.json
GRADER_MANIFEST_SHA256: 5fb19c7f7b927beeac0296942d345d7b72be99924d4a831b8d59ef46ce807ef6

## Verbatim verdict and notes

VERDICT: REVISE. SCORES: design4, silhouette3, proportion4, materials3, detail3, topology3, consistency4, fitness3, placeholder2, performance3 (mean3.2).
- silhouette: In ixari_lineup_far_lod2.png and its grayscale counterpart, the crown and forearm crystals collapse into a thin biped outline at100m. Preserve a broader, offset crystal mass at LOD2 so the biological identifier survives that distance.
- materials: In ixari_heads_closeup.png and suit3’s open-space_lod0.png, crystals read as opaque lavender prisms with clean colour bands. Add localized internal clouding, chipped edges and stronger crystal-versus-skin roughness separation; keep emission concentrated along growth fractures.
- detail: ixari_suits_family.png shows four close-fitting suits distinguished mainly by scattered hexagonal plates. Shape garment seams, joint gussets and padding around elbows, knees and waist so the suits have construction detail at character-view distance.
- topology: ixari_heads_closeup.png, especially heads1 and6, shows puckered brow shading and dotted discontinuities along the lip rim. Clean those surface transitions and verify the corrected shading through facial morphs and lower LODs.
- fitness: In ixari_blendshapes.png, vis_FV reads chiefly as a narrow horizontal mouth seam. Give it a legible lip-contact pose distinct from vis_MBP, then demonstrate the transition at dialogue size.
- placeholder: ixari_hands_feet.png still shows slab-like palms, tubular fingers and swollen feet ending in simple prongs. Finish palm-to-digit transitions, thumb roots, knuckles and toe pads while preserving the long jointed-finger design.
- performance: Geometry, four-LOD and compressed-texture evidence meets the numerical asset budgets, but60fps remains unsupported. ixari-review5-performance-context.json explicitly leaves pass/query attribution unresolved; head1 noon reports27.835ms shown and27.600ms hidden under those limitations. Resolve attribution and provide five qualified paired runs per lighting case with host-load context. These observations do not establish an Ixari performance regression or explain the appearance findings above.

Grader verified all179 hashes and bindings, viewed all six heads/four suits turntables/material/review sheets with three lighting cases, LOD0/2, wireframes, overlays, distance, family/detail/morph/hands/bends and both lineups, validators and raw perf/context.

## Parent disposition

The parent filed appearance/playability follow-up P1.E05.T08 at main f2f7681b6 under the owner's fifth-grade rule. Performance remains assigned to P1.E14.T13. Ixari fifth source, export and completed artifacts are frozen; no sixth revision is authorized. Whole P1.E05.T01 remains incomplete while Ulgani and shared final gates remain open.
````

### Ulgani — round 4

Source: [ulgani-review4-parent-relayed-verdict.md](/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/assets/renders/characters/validate/ulgani-review4-parent-relayed-verdict.md). SHA256: `1c249fe63abbe63ca79271a4f0b2ed91b70faf34ca66fe6e1b4291954343477c`.

````text
# Ulgani fourth visual review — parent-relayed verdict

TASK: P1.E05.T01 — Ulgani fourth grade
ARTIFACT_HEAD: 10ae8f49b949c9b63ffc6111d6fead4205f43c9c
GRADER_MANIFEST: assets/renders/characters/validate/ulgani-review4-grader-packet.json
GRADER_MANIFEST_SHA256: 2d77bc6c26d2dd69047e0a244add567e91a36617ebf2b3ad31ece61b4f09e20d
PROVENANCE: Preserved from the parent's fresh independent fourth-grade relay on 2026-11-02. The parent supplied the original note spacing in a follow-up. This worker did not perform or reconstruct the independent grade. A reviewer instance identifier was not provided in the relay.

VERDICT: REVISE
SCORES: design 4, silhouette 3, proportion 4, materials 3, detail 3, topology 2, consistency 4, fitness 3, placeholder 3, performance 3 (mean 3.2)

NOTES (verbatim):

- silhouette: The 100 m grayscale lineups retain a pale biped, but the finer crest branches and terminal clusters lose their fungal read. Preserve broader, connected frond/cap masses in LOD2, particularly for heads 2–6, and verify recognition at native capture size.
- materials: Skin reads as largely uniform ivory, while suit membranes and lattice members share similar amber response. Separate their roughness and colour treatment; add localized amber-to-grey chitin weathering, darker fused joints and visibly paler membrane repairs.
- detail: The torso and limbs remain smooth beside the densely detailed crest. Add authored medium-scale breathing-slit rims, membrane tension folds and attachment-edge thickness that remain visible in the supplied gameplay framing.
- topology: The detail sheets show jagged surface breaks around finger joints, thumb roots, toes and the jawline of heads 3 and 6. Repair these joins and shading. Preserve terminal crest shapes across LODs: head 4’s rounded caps visibly become diamonds at LOD2, and head 3 loses substantial terminal mass.
- fitness: `vis_FV` reads as another narrow mouth slit, with weak distinction from `vis_MBP`. Shape a clear lip-contact articulation and verify that the two poses remain distinguishable at dialogue-bar size.
- placeholder: The feet retain rectangular, flat-ended toe extrusions, and the hands have abrupt palm-to-digit transitions. Finish rounded pads, toe roots, thumb bases and knuckle forms so these close-up areas no longer read as blockout.
- performance: Geometry, four-LOD counts and texture budgets pass validation, but qualified 60 fps evidence is absent. The packet explicitly leaves timing attribution unresolved and supplies one session rather than five independent qualified runs. Complete the shared T13 qualification with baseline attribution and repeated standard-scene captures; the nominal reliable flags establish neither an asset regression nor a scene-budget pass.

GRADER COVERAGE (parent relay): Verified all 179 required and 12 supporting artifacts, source/export/inventory/packet bindings and inspected all ten visual sets, morphs, deformations and lineups.

DISPOSITION: The parent authorized the fifth Ulgani saved-source revision and artifact cycle. No fifth verdict exists. Thalune and Ixari remain frozen after their fifth REVISE; no sixth peer revision is authorized. Shared performance qualification remains P1.E14.T13. No renderer/exposure changes or capture downgrade may substitute for appearance/playability fixes. Whole P1.E05.T01 remains incomplete.
````

### Waystation — round 1

Source: [p1e11t01_grade1_waystation.md](/Users/andreyyurlov/.local/state/t3-pstack/orchestrate/astra-nullius/verdicts/p1e11t01_grade1_waystation.md). SHA256: `fad475628a133b7e2efa2bbf511d5d52a9e77d10aaea0010101d99f885628cc1`.

````text
VERDICT: REVISE
TASK: P1.E11.T01 Waystation
SCORES: design 3, silhouette 4, proportion 5, materials 3, detail 3, topology 4, consistency 4, fitness 4, placeholder 3, performance 5 (mean 3.8)
NOTES (REVISE only, one per failing criterion):
- design: The kit has the Compact palette and the shell motif: the hangar roof ribs fan out from a hinge line (waystation_ws_hangar_turntable.png) and the habitat dome is scalloped. It has no Ulgani lattice and no Ixari crystal (art bible 2.4). Every frame member is a straight steel truss or box section: the hangar's interior roof trusses (stations_kit_hangar.png), the ws_spine cage (waystation_ws_spine_turntable.png), the ws_ring spokes and the ws_habitat straps. Every window is a flat blue glass band or panel.
  - Rebuild those members as triangulated, lightly curved members with fused fillets at the joints.
  - Replace the window bands on ws_ring, ws_spine and ws_habitat with faceted crystal inserts set in dark socket collars.
  - Give the ws_ring torus and the ws_baydoor leaves real overlapping shingle plates along their ribs, so they stop reading as a generic wheel and a generic panel wall.
- materials:
  - ws_refuelpost's emissive strip blooms over the whole post in noon, night and open space (review/stations/waystation/ws_refuelpost/sheet.png). Cut its emissive to about a fifth, or make it a thin indicator line.
  - The kit is spotless. Add hand-painted wear where use goes: grime at the mouth lip and gantry rails, scuffing on the trade-deck stair and floor, wear around hatch rims on ws_spine and ws_habitat, and edge chips on the cargo pod.
  - Break the visible repeats:
    - The stencil numbers repeat panel to panel on the hangar walls (07/31/14/22 and 20/29/11 in stations_kit_fabricator.png).
    - All 24 pads carry the same scorch smudge (stations_kit_hangar.png). Vary it per pad with rotated or swapped decals.
  - ws_baydoor in open space at LOD0 renders as a flat, toneless white sheet. Give it value variation from the trim sheet and from wear.
- detail:
  - ws_baydoor is 1,400 triangles for a 130 × 42.6 m door and reads as a flat painted wall (waystation_ws_baydoor_turntable.png). Model leaf frames and ribs, top and bottom track rails, guide rollers and leaf edges with depth.
  - ws_tradedeck is a 129 m bare slab at 3,748 triangles (waystation_ws_tradedeck_turntable.png). Build visible counters where COL_Counter_30 and COL_Counter_45 already sit, a Quartermaster plinth at Interact_Quartermaster (x 0), a board screen at Interact_Board, and light fixtures and deck dressing.
  - The hangar's inner walls are 42 m flat planes with painted panel lines, where the exterior has structural ribs (stations_kit_hangar.png). Bring the ribs, recessed panels and pipe runs through to the interior.
- placeholder:
  - Three props sit under the prop floor because their asset_class property makes them kit pieces: ws_cargopod (960 triangles), ws_refuelpost (784) and ws_fabricator (1,586). The prop class floor is 2k–10k, and DESIGN 19.3 lists these as props. Reclassify them as props and build them to that budget.
  - The pod's cylinder and straps are visibly faceted at walking distance (waystation_ws_cargopod_turntable.png). The refuel post's hose is a flat ribbon bent into an "R" (waystation_ws_refuelpost_turntable.png). The fabricator is stacked boxes and a prism under a canopy of loosely overlapping planks (waystation_ws_fabricator_turntable.png).
  - Give all three rounded, purpose-built forms: a real hose and reel, latches and handles, and a canopy of lapped plates that follow its ribs.

Minor notes (passing criteria):
- topology: Several LOD2s drop their main secondary forms: ws_habitat loses its cage straps and solar wings, ws_ring loses its eight rim fins, and ws_cargopod becomes a hexagonal prism (the review sheets). Confirm the switch distances put these drops below a few pixels. Raise the segment count on cylinders a player stands next to (pod straps, refuel post base).
- fitness:
  - ws_baydoor has two static colliders, COL_BayDoor_L and COL_BayDoor_R, beside ten leaves that slide by open_x up to 65 m. When the door opens, the colliders no longer match the leaves. Parent a COL to each leaf, or document that the engine disables them on open.
  - ws_habitat's single box collider overhangs its tapered dome. Two or three boxes would fit it better.
  - The socket joins all measure 0.0000 m (stations_kit.txt). The 24 BAY_Pad markers and the pad colliders line up.
- consistency: Once the design note is done, ws_baydoor, ws_tradedeck and ws_ring should share the hangar's and habitat's lapped-rib motif.
- performance:
  - The assembled station is about 117k triangles at LOD0 and about 71 draws.
  - GPU texture memory is 37.3 MB per kit piece and 85.3 MB for the hangar and trade deck, all within the 128 MB class limit.
  - Re-measure the hangar's 1.76–1.88 ms GPU delta, and the assembled station in one scene, on an idle machine. The current readings were taken under load and are marked unreliable.
- capture request (round 2):
  - Recapture ws_cargopod's in-engine review from the current domed-cap model. The current captures predate that change.
  - Add one capture: the assembled Waystation in-engine at LOD2 from 200 m, under noon-lush and open-space. The 100 m far views of the hangar and ring sit on their roofs.

ARTIFACTS: assets/renders/stations_kit_exterior.png, assets/renders/stations_kit_spine.png, assets/renders/stations_kit_approach.png, assets/renders/stations_kit_hangar.png, assets/renders/stations_kit_fabricator.png, assets/renders/stations_kit.txt, assets/renders/waystation_family.png, assets/renders/waystation_family_2.png, assets/renders/waystation_ws_{hangar,baydoor,tradedeck,fabricator,spine,ring,habitat,cargopod,refuelpost}_turntable.png, assets/renders/waystation_ws_{hangar,tradedeck}_materials.png, assets/renders/waystation_ws_*_materials.txt, assets/renders/review/stations/waystation/{ws_hangar,ws_baydoor,ws_tradedeck,ws_fabricator,ws_spine,ws_ring,ws_habitat,ws_cargopod,ws_refuelpost}/sheet.png and perf.json, assets/renders/review/stations/waystation/ws_hangar/noon-lush_lod0.png, assets/renders/validate/stations__waystation.glb.json, assets/renders/validate/stations__waystation.blend.json
````

### Waystation — round 2

Source: [waystation_grade2_sol.md](/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/renders/stations/waystation_grade2_sol.md). SHA256: `883c5d8166f8fe955a16dd3f561524d1697182d6c6f6e3ec1bef0aed33500874`.

````text
Parent-relayed verdict. Model: gpt-6.1-sol. Reasoning: xhigh. Fork: none. Recorded by parent in main fb3caea60. This file preserves the relayed second-round verdict; it is not a new grade.

VERDICT: REVISE
TASK: P1.E11.T01
KIT: Waystation
ROUND: 2
SCORES: design 4, silhouette 4, proportion 5, materials 3, detail 4, topology 4, consistency 5, fitness 4, placeholder 4, performance 3 (mean 4.0)

NOTES:
- materials: In grader-scale-supplement-round2/uncut/controls_eye_8p7m_uncut.png, both terminal faces collapse into featureless white glare. Pad lights also obscure their housings and adjacent rim surfaces in cutaway/door_eye_1p7m.png. Reduce authored emissive output under the existing exposure until these surfaces retain contrast; verify with the same uncut controls view.
- performance: timing remains unqualified; qualified unchanged-scene frame-cadence evidence is required after shared timing controls are resolved. Raw deltas do not establish a Waystation regression. This part remains coordinated with T13; do not alter the scene/exposure to claim it fixed.
````

### Scrapyard — round 1

Source: [p1e11t01_grade1_scrapyard.md](/Users/andreyyurlov/.local/state/t3-pstack/orchestrate/astra-nullius/verdicts/p1e11t01_grade1_scrapyard.md). SHA256: `980ca82c6d270327e319318e87afce01ccf76878d8c96a952f9648ca73de0702`.

````text
VERDICT: REVISE
TASK: P1.E11.T01 Scrapyard (sy_rock, sy_mouth, sy_dock, sy_deck and the assembled kit)
SCORES: design 3, silhouette 3, proportion 3, materials 2, detail 2, topology 3, consistency 4, fitness 3, placeholder 2, performance 5 (mean 3.0)

NOTES (REVISE only, one per failing criterion):
- **design:** sy_deck, sy_dock and sy_mouth read as generic industrial sci-fi: a slab with hazard stripes, a round pad on a flat plate, and a regular octagon with evenly spaced boxes (scrapyard_family.png). The Reaches palette and the mismatched patch panels are there, but per art bible 2.4 a faction's structures are built from the three peoples' languages, with livery as paint only. None of those forms appear.
  - Build the pieces from recognisable salvage:
    - a lapped Thalune/Compact hull section as sy_dock's anchor plate and as sy_deck's hold
    - triangulated Ulgani lattice members as sy_deck's under-truss and legs
    - a cracked, salvaged Ixari crystal pane on the hold
  - Make sy_mouth irregular: unequal girder lengths, one bay closed with a hull plate, visible weld beads at the corner nodes.
- **silhouette:** From outside, sy_rock is a smooth egg with a hole and one mast (stations_kit_scrapyard_mouth.png, sy_rock/open-space_lod2.png). Nothing says "pirate base" at a distance.
  - Add exterior structure built to survive LOD2: a lit scaffold frame around the mouth, two or three sensor masts, clusters of hull-plate patches, and approach beacons leading to the mouth.
  - Keep sy_mouth's 16 radial struts in LOD2. They vanish there (sy_mouth/sheet.png), and they are what makes the ring read as a gate.
- **proportion:** sy_dock's pad is 25 m across, the Tier 0–1 size. The Scrapyard is a Tier 2 dungeon, and the pirate wing's Bulwark (Tier 2 gunship, 24–28 m) retreats there (DESIGN 486, 593). The art bible requires 36 m pads for Tier 2–3 gunships. Add a 36 m dock variant with its own Socket_Dock on the cavity wall and a BAY_Dock radius to match.
- **materials:** SY_Rock is one uniform marbled noise at a single scale over the whole 240 m asteroid (sy_rock/open-space_lod0.png, the sheet's 100 m tile, scrapyard_sy_rock_materials.png). That is the demo's known failure. It also stretches into streaks along the mouth rim and into concentric rings on the cavity's end wall (stations_kit_scrapyard_cavity.png).
  - SY_Rock needs:
    - large-scale variation in albedo and roughness: darker regolith in hollows, lighter fractured faces
    - fracture or strata normals
    - engine scorch and soot around the mouth and below each dock
    - re-unwrapped or triplanar UVs on the mouth rim and the end cap
  - SY_Scrap reads new: the hazard stripes on sy_deck and sy_dock are pristine. Add wear where use goes: a scuffed walkway strip, a burn ring on the pad, rust runs below welds and bolts, chipped hazard paint on edges.
- **detail:** LOD0 counts are sy_deck 840, sy_dock 1,184 and sy_mouth 1,296 triangles, the floor of the 0.5–15k kit budget, for pieces the player fights across on foot. sy_deck/noon-lush_lod0.png shows a flat slab, plain box crates and an unbevelled container.
  - Bring each module to roughly 4–10k triangles:
    - bevelled plate edges
    - a modelled grate frame with support beams under the deck
    - container corrugation and corner castings
    - weld seams and bolt heads on the cover plates
    - cable runs
    - a real truss under the dock pad
- **topology:** sy_rock LOD0 shows flat triangular shards around the mouth (sy_rock/wireframe_lod0.png, open-space_lod0.png); sculpt or smooth that break. The LOD2 swaps drop visible features:
  - sy_mouth loses all its struts and floodlights.
  - sy_dock loses its 8 landing lamps. They are emissive, so the swap visibly pops in night-exotic and open-space (sy_dock/sheet.png).
  - sy_deck drops 4 of its 7 cover pieces.

  Simplify these parts through LOD2 instead of removing them.
- **fitness:**
  - **Dock collider:** sy_dock's COL_Pad is a 25 × 25 m box under a 25 m disc (sy_dock/overlay.png), so at the diagonals players stand on air about 5 m past the rim. Use a 12–16-sided prism.
  - **Deck colliders and rails:** sy_deck has colliders only for the floor, the hold and the front rail (sy_deck/overlay.png). The cover plates and crates the deck exists for have none. The two 14 m ends are open 11 m drops with no rail. Add a COL_ box per cover piece, and rails or connection sockets at both ends.
  - **No dock-to-deck route:** no module joins a dock to a deck. The kit has no catwalk, stair or ladder, so chapter 11's "dock → deck fight" has no walkable path. Add a gangway or stair module whose sockets span a dock's hatch to a deck.
- **placeholder:** Every piece reads as a procedural primitive:
  - sy_deck is a slab on three square legs with boxes on top.
  - sy_dock is a disc cantilevered off a flat rectangle. The anchor bars at its base extend past the plate's ±8 m edges and float in mid-air (the dashes beside the plate in scrapyard_sy_dock_turntable.png and stations_kit_scrapyard_cavity.png).
  - sy_rock is a displaced ellipsoid with round craters.

  The detail and design fixes cover most of this. In addition, sink sy_dock's anchor bars into a rock-anchor collar.
- **minor, consistency (4):** The four modules share SY_Scrap and SY_Grate, the hazard language and the palette, and the rock's patch plates tie it to the rest. In the swatch, NavReaches reads pale salmon rather than the Reaches engine red-orange #FF6A3D; check the emissive colour. The red plates are close to oxide red #8E2F23 in-engine but read brighter in the turntables.
- **minor, performance (5):** LOD0 is 12,312 / 1,296 / 1,184 / 840 triangles with 2–3 draws per module. Texture memory is 21–37 MB per module, under the 128 MB budget, from one shared 34.7 MB kit set. The assembled base is about 19k triangles. The GPU readings are unreliable; re-measure on an idle machine at 1080p:
  - the paired cost of the assembled Scrapyard (rock, gate, 3 docks, 2 decks, Light_* on) in open-space
  - whether the review scene holds 60 fps
- **minor, capture defect:** sy_rock's night-exotic captures at LOD0 and LOD2 show terrain spires instead of the rock, so its material cannot be judged under that light. Re-shoot both with the camera clear.
- **capture request (my one):** an assembled cutaway of sy_rock sectioned along the mouth axis, LOD0, noon-lush, showing:
  - where sy_mouth's struts meet the rock wall
  - all three sy_dock and both sy_deck on the cavity wall
  - the Lark on a dock and bipeds on a deck

  The current cavity view shows only one dock and one deck, and not where the gate meets the rock.

ARTIFACTS:
- Kit and family: assets/renders/scrapyard_family.png, scrapyard_family.txt, stations_kit_scrapyard_mouth.png, stations_kit_scrapyard_cavity.png, stations_kit.txt
- Turntables and material sheets (+ .txt): assets/renders/scrapyard_sy_{rock,mouth,dock,deck}_turntable.png, scrapyard_sy_{rock,mouth,dock,deck}_materials.png
- In-engine review: assets/renders/review/stations/scrapyard/sy_{rock,mouth,dock,deck}/{sheet,noon-lush_lod0,noon-lush_lod2,night-exotic_lod0,night-exotic_lod2,open-space_lod0,open-space_lod2,wireframe_lod0,wireframe_lod2,overlay,far_lod2}.png, perf.json
- Validation: assets/renders/validate/stations__scrapyard.blend.json, stations__scrapyard.glb.json
````

### Scrapyard — round 2

Source: [scrapyard_grade2_sol.md](/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/renders/stations/scrapyard_grade2_sol.md). SHA256: `5e74d7d9d12761b650e74b381be2f2f5849a599f8bafa3c51b0ac45c5c6a31ac`.

````text
Parent-relayed verdict. Model: gpt-6.1-sol. Reasoning: xhigh. Fork: none. Recorded by parent in main fb3caea60. This file preserves the relayed second-round verdict; it is not a new grade.

VERDICT: REVISE
TASK: P1.E11.T01
KIT: Scrapyard
ROUND: 2
SCORES: design 3, silhouette 4, proportion 4, materials 3, detail 3, topology 3, consistency 4, fitness 4, placeholder 3, performance 3 (mean 3.4)

NOTES:
- design: The sy_deck container and dock bulkheads read as generic industrial equipment. Incorporate recognizable salvaged shell, lattice, and crystal-derived parts beneath the Reaches patchwork livery.
- materials: sy_rock has an all-over contour-noise pattern and abrupt boundaries against broad smooth patches. Replace these with varied geological texturing and deliberate rock-to-regolith transitions.
- detail: The asteroid mouth and cavity read as smooth, scalloped shell surfaces. Add substantial fractured rock faces, excavation cuts, and localized debris around the entrance and interior.
- topology: The LOD0/2 pairs visibly flatten asteroid crater relief and angularize the dock rims. Preserve those major forms in LOD2 and demonstrate the transitions at their intended distances.
- placeholder: The seven plain rectangular cover blocks on sy_deck read as blockout. Develop them into recognizable salvage or cargo barriers with shaped construction, attachments, and distinct wear.
- performance: qualification is unresolved separately from visual defects; retain standard1080p three-light/five-pair/device/load/warm-up/error/sample requirements with T13. No60fps or asset-regression claim from current data.
````

## P1.E11.T01 Waystation — third submission (2026-11-02)

Fresh grader `/root/waystation_third_grade_sol`, `gpt-6.1-sol`, `xhigh`, no transcript inheritance. Artifact checkpoint `789a383ce96ac6510c63e63e31637c8bb479ef1c`. Complete verdict follows verbatim; this is the third component grade and does not invoke the fifth-grade disposition.

VERDICT: REVISE

TASK: P1.E11.T01 — Waystation component — third submission.

SCORES: design 4; silhouette 4; proportion 5; materials 4; detail 4; topology 4; consistency 5; fitness 4; placeholder 3; performance 3. **Mean: 4.00/5.**

NOTES:

- **Placeholder — appearance:** In `assets/renders/stations/round3/engine/attempt01/standard/waystation/ws_fabricator/open-space_lod0.png`, the principal working area remains a featureless opaque rectangular block beneath the finished hood and braces. The blank control strip reinforces the unfinished appearance. Replace this central stand-in with a visibly designed fabrication chamber, work surface and tooling, and give its controls purposeful detail.
- **Performance — shared measurement gap:** The nine standard `ws_*/perf.json` files and `review_round3/waystation/metadata/capture_context.json` do not establish qualified, repeatable whole-scene 60 fps. Complete the shared P1.E14.T13 measurement qualification and supply independent repeated runs plus representative whole-scene frame cadence with this kit. Nominal timing flags and small paired deltas do not establish an asset-caused regression; none is asserted here.

ARTIFACTS:

- Entry: `assets/renders/stations/review_round3/waystation/manifest.json`, SHA256 `c832f7b50f947c659753756afcfbc45975ab1aeea3b3c737dc16ce8ec546339a`.
- Independently verified **all 192 inventory-bound files’ SHA256 hashes and byte sizes**, including **129 PNGs**, with no mismatches. Verified reference, source, export and validator bindings. Canonical source SHA256: `83532327ba2ce3c72a597ceb41ef2b0d3add7f5352c139bc771a38bb34c4747f`; export: `c74e09c52d670005273197f0b66c8226a36dccbd2acecba081f1616ef3a6e038`.
- Inspected all 129 PNGs at native resolution: all nine modules’ turntables/material sheets, both family sheets, three lighting cases at LOD0/2, both wireframes, overlays and distance views; current-source scale/cutaway/uncut-control, ring and whole-kit distance supplements.
- Read immutable DESIGN 19.2/19.3, art bible, rubric, source/export metadata, capture provenance, actual/requested camera fields, point-light records and performance context. Supplied source/export validators pass; canonical GLB’s 36 LOD triangle counts agree with the export report.
- Standard ring night/distance and hangar distance coverage gaps remain recorded. Supplements provide additional visual evidence under distinct placement and camera conditions; they do not replace standard placement or performance evidence. Runtime door animation and continuous LOD transitions remain unverified by this static packet.

## P1.E11.T01 Scrapyard — third submission (2026-11-02)

Fresh grader `/root/scrapyard_third_grade_sol`, `gpt-6.1-sol`, `xhigh`, no transcript inheritance. Artifact checkpoint `789a383ce96ac6510c63e63e31637c8bb479ef1c`. Complete verdict follows verbatim; this is the third component grade and does not invoke the fifth-grade disposition.

VERDICT: REVISE

TASK: P1.E11.T01 — Scrapyard component only, third submission.

SCORES: design 4, silhouette 4, proportion 4, materials 3, detail 3, topology 4, consistency 5, fitness 4, placeholder 3, performance 3 **(mean 3.7)**

NOTES:
- **materials:** The asteroid reads as nearly uniform grey-beige stone under studio, noon, and space lighting. Thin angular cracks and broad bands provide little separation between exposed rock, dusty deposits, and worked cavity surfaces. Author distinct colour, roughness, and normal treatment around fractures, sheltered recesses, and excavated areas; preserve that separation under all three lights.
- **detail:** Large stretches of the exterior and cavity remain smooth, with a few shallow depressions and widely spaced cracks. Add a coherent hierarchy of fractured faces, ledges, broken edges, and localized debris around the entrance and inhabited cavity. The current close and scale-detail views expose insufficient detail for this large environment asset.
- **placeholder:** The dominant asteroid still resembles an elongated rounded primitive with an axial tunnel. Give the outer mass and excavated opening a more specific, asymmetric geological structure, and integrate the collar’s anchors into those fractures so it reads as a reclaimed asteroid rather than a hollow shell with an attached ring.
- **performance:** Geometry, LOD, compression, and texture-budget validation pass, but qualified evidence that the review scene holds 60 fps is absent. Supply the coordinated, qualified frame-cadence and independent paired measurements required by P1.E14.T13. This score reflects an evidence gap; the raw deltas and nominal reliability flags do **not** establish an asset-caused regression.

ARTIFACTS:
- Frozen checkout: `/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01`, HEAD `789a383ce96ac6510c63e63e31637c8bb479ef1c`.
- Entry [manifest.json](/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/renders/stations/review_round3/scrapyard/manifest.json), SHA-256 `b3f19bcdfa9b229aaa0c7503c70accc44293f96e3b0adb4db414f42c0719dfb0`; [inventory.json](/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/renders/stations/review_round3/scrapyard/inventory.json), SHA-256 `02a489b42fb5bbf88379e75fe7aba78e2e8d92f89ba91d190de7e8a45945ea32`. All **140 entries** match recorded hashes and sizes. All **87 PNGs** were inspected: 13 studio/material/family sheets, 66 standard module images, and eight supplemental/assembled/cutaway images.
- Canonical source SHA-256 `e9354909ea92b046da886af3b3aba1632b42b827e2ad5ffcc1fac253eb00be03`; canonical export SHA-256 `6ccd4ab7f358485480be201d8348020b5d1b4bea602f35ac010ef8a5cb7fa3e5`. Packet copies match the original canonical paths. Grading used the inventory-bound DESIGN 19.2/19.3 extract, art bible, rubric, validation reports, source/export metadata, camera metadata, and review-copy audit.
- Supplied validation reports: source PASS with ten duplicate-name warnings; export PASS with zero warnings. Six modules have four decreasing LODs and LOD3 below 5%. These reports were inspected; validation was not rerun.
- **Coverage limits:** Standard asteroid night views are substantially terrain-occluded; its standard 100 m view is inside the surface. The lifted night pair and bounds-aware distance image provide separate visual evidence. Night metadata records a 500 m altitude adjustment, orbit 35°/25° at 1.6 radii, and null actual range. The distance supplement records **265.5207203565617 m centre range**, labelled 100 m beyond bounds. Neither substitutes for standard placement or performance evidence.
- **Camera limits:** Cutaway requests specify explicit eye/target coordinates and 40°/50° FOV. Reported metadata instead retains orbit 35°/16°/1.7 with null range and approximately **70° noon / 64° space FOV**. The requested and reported camera fields are not treated as equivalent.
- **Assembly provenance:** Current-source review copies include four actual point lights, nine 1.85 m bipeds and one Lark per LOD. The cut removes `x>0` and caps **only the rock**; the mouth remains uncut. The cut plane was reconstructed from retained geometry; original literal CLI arguments are unavailable. Uncut exterior views occlude the internal references, while the scale-detail image remains too distant for a strong human-scale reachability check.
- Static LOD pairs support the topology score, but continuous automatic transitions were not captured. Runtime door animation and player traversal remain unverified. All performance readouts remain explicitly unqualified; supplements contain no performance calls.

## P1.E05.T01 Ulgani — fifth submission (2026-11-02)

Fresh grader `/root/ulgani_fifth_grade_sol`, `gpt-6.1-sol`, `xhigh`, no transcript inheritance. Artifact checkpoint `d00d61ba5be3935f63feb7a91a8d0104d44e6cf7`. Complete verdict follows verbatim. The owner's fifth-grade disposition carries remaining appearance notes as P1.E05.T09 and performance as P1.E14.T13; this is not a visual PASS or whole-task completion.

VERDICT: **REVISE** — mean **3.8/5**. Three criteria fall below 4; mean is below 4.5.

TASK: **P1.E05.T01 — Ulgani component only, fifth submission.** No whole-task completion decision.

SCORES:

| Criterion | Score | Assessment |
|---|---:|---|
| Design language | 4 | Fungal crests, breathing slits, ivory/amber palette and open lattice suits clearly identify Ulgani. |
| Silhouette and read | 4 | Crest silhouettes remain distinguishable at LOD2. The 100 m captures contain a small visible body; it is not missing. |
| Proportion and scale | 4 | Source references and validated dimensions support the scale. The lineups provide no additional 3D calibration. |
| Materials | 4 | Matte skin, chitin, membranes and spore points respond coherently across the three lighting cases. |
| Surface detail | **3** | Close skin surfaces remain largely smooth, with broad faint polygonal lines and irregular discontinuities around digits instead of convincing porous biological detail. |
| Topology and LODs | 4 | Four budget-compliant LODs, generally clean wireframe presentation and retained primary forms. Static comparisons do not establish animated transition quality. |
| Consistency | 5 | Six crests and four suits form a coherent family with consistent body, palette and grown-frame construction. |
| Fitness for play | 4 | Bend sheets retain usable body and suit forms; primary mouth and blink shapes are demonstrated statically. Integrated playback is unproven. |
| No placeholder tell | **3** | Hands and feet retain blunt, visibly faceted digit endings; shoulder and ankle transitions still read as assembled basic forms. |
| Performance | **3** | Geometry and texture budgets pass, but qualified 60 fps evidence remains unresolved. |

NOTES:

- **Surface detail — revise:** In `ulgani_heads_closeup.png` and `ulgani_hands_feet.png`, develop localized pore relief and biological variation around breathing slits, joints and facial folds. Resolve the irregular pale/dark edges across toe roots into intentional, continuous surfaces. Preserve readable larger forms rather than adding uniform noise.
- **No placeholder tell — revise:** Refine finger/toe end shapes, pads and joint transitions, particularly the flat polygonal toe tips shown in the front-foot close-up. Integrate shoulder-to-torso and ankle-to-foot forms into a more convincing organism while retaining the alien anatomy and shared rig.
- **Performance — revise evidence:** Resolve T13 pass/query attribution, then supply qualified review-scene evidence for the 60 fps requirement under the three specified lighting cases. Existing nominal flags and shown-minus-hidden deltas do not establish compliance or an asset regression. Head3/noon and suit2/noon explicitly have raw `reliable=false`.

Material limitations retained:

- Head1’s actual capture succeeded; its original controller **FAILED**, and the results were CPU-recovered without rerendering. Its active port was unobserved. The remaining nine corrected controllers passed.
- Lineups are **2D pixel compositions**, not fresh shared-stage scale, deformation or animation proof. Thalune and Ixari are contextual peers only.
- Native FV/MBP and 160 px comparisons are offline static compositions, not integrated dialogue playback.
- No additional capture was requested or launched.

ARTIFACTS:

- Checkout: `/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41`
- Frozen clean HEAD: `d00d61ba5be3935f63feb7a91a8d0104d44e6cf7`
- [Grader packet](/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/assets/renders/characters/validate/ulgani-review5-grader-packet.json) SHA-256: `80ad60aa81e0700f1bdd1423073ba833dd267dbf68d69a2f98c09bed39efd40e`
- [Canonical source](/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/assets/blend/characters/ulgani.blend) SHA-256: `06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b`
- [Canonical export](/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/packages/client/public/models/characters/ulgani.glb) SHA-256: `9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682`
- Independently verified **217 unique packet file bindings**, zero hash/size mismatches. Verified compressed pixel data, chunk CRCs, dimensions and scanline layout for **157 PNGs**.
- Reviewed all ten variant studio/material sets, master grid, families, close-ups, hands/feet, morphs, native FV/MBP comparisons, both bend sheets, complete engine sheets covering all specified lights/LODs/wireframes/overlays/distances, and color/grayscale lineups; checked relevant native engine images at full capture resolution.
- Read only DESIGN §5/§19.2, the art bible, rubric §0.10.2/input rules §0.10.3 and factual artifact metadata/provenance.
- Both bound validators report **5/5 PASS, zero warnings**. Read-only GLB inspection confirms one shared 70-joint index set, 27 named morph targets, required compression extensions and sixteen 4096² maps. No files changed.


## P1.E11.T01 — Waystation fourth independent visual grade (2026-11-02)

VERDICT: REVISE
TASK: P1.E11.T01 — Waystation
SCORES: design 4, silhouette 5, proportion 4, materials 4, detail 4, topology 4, consistency 5, fitness 4, placeholder 5, performance 3 (mean 4.2)
NOTES:
- performance: Supply qualified three-light review measurements with actual renderer telemetry, stable attributable asset timings, and demonstrated 60 fps. The supplied unqualified readouts do not establish a performance pass.

Artifact-only grader index: `/private/tmp/station-fourth-artifact-only-jyslgamo/waystation.json`, SHA256 `8f6fac190d96e67e1809321bd625754c1f7dc63d4b0bfee4560d7acd956ca0b2`. Detailed inspection record: `/private/tmp/waystation-visual4-sol-ig08srq9/viewing-record.md`; integrity and actual viewing are recorded separately. No additional capture was requested. Current source/export hashes remain `84fd86e0d68730e8a18edc061c965a6ef26aa99d35b0aae5d4098316a4327c68` / `aabf38551d7a5ea0e34e980bd496ef53943dae3de91fa5a37cd11824bd729e81`.


## P1.E11.T01 — Scrapyard fourth independent visual grade (2026-11-02)

VERDICT: REVISE
TASK: P1.E11.T01 — Scrapyard
SCORES: design 4, silhouette 4, proportion 4, materials 3, detail 4, topology 4, consistency 5, fitness 4, placeholder 3, performance 3 (mean 3.8)
NOTES:
- materials: Replace the rock’s regular pale crosshatching with irregular fractures and mineral variation; remove stretching over curved surfaces.
- placeholder: Break the smooth capsule mass and evenly stepped cavity rim with asymmetric rock planes, varied chunks and uneven excavation cuts.
- performance: Supply qualified paired timing under all three lights, with actual renderer telemetry and demonstrated 60 fps; current timing is explicitly unqualified.

Artifact-only index: `/private/tmp/station-fourth-artifact-only-jyslgamo/scrapyard.json`, SHA256 `0a78e9f2b25737762088eee372b115c2ef3cc7c7f5c869b8bd92fb1c70b155c4`. Detailed record: `/private/tmp/scrapyard-visual4-sol-inspection/evidence.md`. The grader directly viewed 44 supplied images and two private inspection crops; six full engine sheets cover all modules. All 106 linked hashes match, and 88 PNGs pass separate CPU integrity/decode checks. No additional capture was requested. Current source/export hashes remain `f4a8c86c06314aa8ce6a5c9f21973e41860c94252de1aeabad86fc8a15164be9` / `00610b536701916229540c74be1935848716703fea7f4575c6d8c2d8c125ead2`.


## P1.E04.T06 — First independent visual grade (2026-11-03 UTC)

Verbatim grader report:

# VERDICT: REVISE

Task: **P1.E04.T06 — Remote pilot markers polish**. This is the first explicit fresh artifact-only verdict, following the accepted supplement.

| Criterion | Score /5 | Assessment |
| --- | ---: | --- |
| Hierarchy / legibility |4| Near names read clearly at1080p; sparse naming and dark halos keep pilot text subordinate to flight information across sky, surface and bay views. Full #E9E7E2 core pixels were observed in a near label. No exhaustive pixelwise4.5:1 proof was obtained. |
| Fit with HUD language |5| Thin keyed diamonds, restrained names/ranges, dot crosshair and arc gauges are coherent and stay out of the way in both aspect ratios. |
| Motion |3| Authored fading is eased, attached to its diamond and approximately150ms on the deterministic animation clock. **Failing qualification:** the required jitter-free60fps runtime motion is not demonstrated. Screenshots advance deterministic1/60s steps at about6 wall-clock fps; measured rAF-gap medians are33.4–66.6ms. These artifacts cannot establish observed60fps motion or identify the cause of delivery gaps. |
| Theme / palette |5| Warm-white pilot text and teal keyed diamonds fit the existing palette and remain identifiable in dark sky and busy surface/bay views. No unrelated environment or hull-asset quality was graded. |
| Correctness |4| Inspected product views show no new label overlap, clipping or cutoff at16:9 or21:9. Supplied clip receipts have at most nine nonzero named labels including fades, supporting the sampled views; no exhaustive OCR or source-invariant proof was performed. |
| Spec match |4| Visual evidence covers near/range-only marker hierarchy, moving fades, crowded labels, near-hull crossing, beyond-reach suppression, boost-at-edge detection, and full/half/35% capacity poses at both aspects. Exact source stat binding and alarm audio/cadence are outside what these rasters prove. |
| Performance |2| **Failing qualification:** total UI cost under1ms is not established. Five actual HUD-script trial medians are0.6–0.8ms, but they exclude deferred browser work; their p95 values are2.3–4.8ms. The separate conservative profiled union has median3.2515ms and attribution/overhead limits. wholeUiCostMs remainsnull and assessment INCONCLUSIVE. Neither scoped result qualifies the whole-UI budget. |

**Mean:27/7 =3.86/5.** PASS requires every criterion≥4 and mean≥4.5; both gates fail.

The visible polish is coherent, and no additional cosmetic defect is asserted. REVISE is required for the motion/runtime and whole-UI performance qualifications above; the measured script median must not be represented as a total UI budget pass. No further supplemental capture request is made in this verdict.

Artifact roots:

- `/Users/andreyyurlov/.codex/worktrees/p1-e16-t09-count-rollover/space/assets/renders/ui/P1-E04-T06-capture01` — all24 required stills, seven sheets,71 unique original motion frames inspected.
- `/Users/andreyyurlov/.codex/worktrees/p1-e16-t09-count-rollover/space/assets/renders/ui/P1-E04-T06-supplement01` —21:9 original still, sheet,11 original frames, scoped readout/validation and raw trial/receipt metadata inspected.

Exact image/frame paths, verified bindings, scope of timing recomputation and honest inspection limits: `/tmp/p1-e04-t06-visual1-sol-final/VIEWING-RECORD.md`. Prior record preserved at `/tmp/p1-e04-t06-visual1-sol/HOLD.md` and included verbatim in the combined viewing record.

Images support visual state and authored animation judgments. They do not independently prove exact source alpha values, exhaustive WCAG-AA pixel contrast, nearest-eight selection under every input, fading-box reservation under every overlap, ship.stats source binding, fractional35% alarm behavior, alarm audio/cadence, live online multiplayer or target-device performance. The supplied diagnostic sensor overlays were treated as instrumentation, not product clutter.
