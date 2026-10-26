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
