## 12. Mobs

### 12.1 Combat model (what mobs need from the engine)
- **Health and level.** Every mob has a level (1–50) and a threat rating (1–5 stars, shown after analysis). Health = base × (1 + 0.12 × level); damage likewise. Players have 100 health today; Second Skin raises it to 150.
- **Hits.** Ground abilities resolve as rays, cones or spheres against mob hit radii (the fauna picker already does sphere picks along the aim ray). Ship weapons use the existing hitscan against ship/asteroid spheres.
- **Aggro.** Each mob has a sense radius (sight) and a mind radius (the Hollow's). Threat goes to whoever has hurt it most in the last few seconds (damage that fades quickly, so the current attacker takes over but one chip hit does not), modified by Veil (−), Harmonic (reset), Bond companions (+taunt).
- **Resistances by branch.** Crystal creatures resist Thermal, break to Shatter. The Hollow ignore Symbiotic poison except Rot, and flee Nullsong. Sentinels and Wardens shrug Gravitic pulls (they are heavy) and are weak to Dissonance. Pirates are people: no resistances, they use the skill web too.
- **Death and drops.** Units, resources, **Count residue** (crafting material from stone-touched and Hollow), ship parts (space), codex entries. Fragments come only from monoliths, never from kills.
- **Animation.** Fauna attacks are new states in the existing vertex-shader rig (lunge, charge, bite, dive) driven by gait and a per-instance attack phase. Hollow ships are existing hulls with a husked material (dark, glyph-lit seams, missing panels). Sentinels, Wardens and crews are new Blender models; crews use the skinned biped rig.

### 12.2 Planet fauna: temperaments
The species generator gains a **temperament** axis beside skittish/docile, and worlds at Tier 1+ roll at least one hostile species (two at Tier 3+).
| Temperament | Behaviour | Body plans | Appears |
|---|---|---|---|
| Docile | today's herds: idle, wander, graze | all | everywhere |
| Skittish | today's: flee at 14 m + size × 3 | all | everywhere |
| Territorial | charges if you stay within 20 m of the herd for 5 s; returns to the herd afterwards | quad_heavy, quad_grazer | Tier 1+ |
| Predator | hunts: stalks to 30 m, then rushes; hunts other herds too (the grazers flee it, which tells you it is near) | biped (stalker), quad_small (pack), flyer (diver) | Tier 1+ |
| Ambusher | lies still beside deposits and sites until you are within 8 m | quad_small, biped | Tier 2+ |
| Apex | one per world, spawns at night near the landmark grove; territorial over 200 m, pack follows it | quad_heavy | Tier 2+ world boss |

**Attacks by body plan.** quad_heavy: charge (knockdown, 25 dmg), stomp. quad_small: bite swarm (3–5 animals, 6 dmg each, interrupted by Flare). biped: leap (closes 12 m, 18 dmg), claw combo. flyer: dive (20 dmg, telegraphed by circling lower), screech (summons the flock). quad_grazer: kick when cornered (12 dmg).
**Pack AI.** Predators spawn in 2–4; one flanks while one feints; they break off at 30% health and return at night. Harmonic calms a pack for 20 s; Chorus Call turns it.
**Spawning.** Reuses today's herd spawner (70–230 m from the camera, despawn at 420 m), which spawns predators as well as herds, with dens: a new small site type (burrow, nest, roost) planned with the planet like the other sites, about one predator den per 80 km² of land per hostile species, where packs are anchored and respawn, the apex keeps its lair, and ambushers wait beside sites. Night doubles predator spawns on living worlds.



## 19. Art and asset production (Blender)

### 19.1 The rule
Every model in the game is authored by hand in Blender, to one high bar. The demo's approach, Python scripts that generate geometry in headless Blender, was right for a demo and is wrong for the game: it caps quality at what a script can describe. From here, scripts export and bake; they do not model.
- **Source of truth**: `.blend` files in the repository (Git LFS), one per asset family, with named collections per variant and LOD.
- **Export**: one headless Blender script per family (replacing the `build_*.py` generators) that validates naming, bakes textures, generates LODs where none were hand-made, and writes `.glb` files to `public/models`. CI runs it; a failed validation fails the build.
- **Procedural only where it must be**: terrain, flora scatter placement, gas giants, atmosphere and the sky stay procedural. Everything they place or dress is hand-made.
- **No fallbacks**: the demo's procedural stand-ins (box outposts, primitive creatures, the box station) are deleted. A missing asset is a build error, not a downgrade.

### 19.2 The quality bar
| Area | Target |
|---|---|
| Geometry | hero assets (player bodies, hulls, Wardens, the Patient, each capital's landmarks) 60–150k triangles at LOD0; creatures 15–40k; props 2–10k. Four LODs per asset, LOD3 under 5% of LOD0. Flora keeps the impostor hand-over beyond 400 m. |
| Materials | full PBR: base colour, roughness, metallic, normal, ambient occlusion, emissive. 4k textures on heroes, 2k on creatures and buildings, 1k on props, atlases per kit. Hand-painted wear and detail; the demo's panel-detail shader survives only as a micro-detail layer under real texturing. |
| Rigging | one shared humanoid skeleton for the three peoples, crews and city NPCs, with facial blendshapes for the dialogue bar. Creatures keep the instanced vertex-shader rig for crowds, with hand-weighted limbs and hand-authored attack poses; hero creatures and bosses are fully skinned. Hulls articulate gear, canopy, hardpoint mounts and thruster nozzles, and carry damage and husked states. |
| Animation | hand-keyed in Blender: locomotion sets, jet and swim, mining, casts per branch, emotes, creature attacks, boss phases. Cutscene camera paths are authored in Blender and exported as curves the engine's camera-glide system follows. |
| Consistency | one art bible: the three peoples' design languages (shell, crystal, lattice), the Cartographer glyph alphabet, the Hollow's husked treatment, Compact and Reaches liveries, a shared material library. A 1 m grid and a 1.85 m biped are the scale references in every file. |
| Review | every asset is checked in-engine under three lighting cases (noon on a lush world, night on an exotic world, open space) before it merges, with a turntable render attached to the pull request. |

### 19.3 The asset list
| Family | What has to be made | Phase |
|---|---|---|
| Player bodies | 3 peoples × (body, 6 head or crest variants, 4 suit sets); shared skeleton; ~40 animation clips; first-person arms and tools per people | 1 |
| NPCs | crews (3 peoples × 3 armour sets), Quiet Table agents, the Quartermaster hologram, city NPCs (speaker, harbourmaster, apothecary, yardmaster, listener) in people variants | 1–2 |
| Hulls | 13 hulls, each with 3 liveries, gear, canopy, cockpit interior, damage state, husked variant; 8 weapon modules as mountable meshes | Lark, Swift, Kestrel, Mule in 1; the rest in 2–3 |
| Cities | 3 building kits (low, mid, tall × 4 variants; plaza, market hall, skill house, Compact office, listening house, shipyard, salvage yard, gates, walls, bridges, lamps, props); the three anchor stones as landmarks | 1 |
| Stations | the Waystation rebuilt as a modular kit (hangar bay, trade deck, fabricator, spine, ring, habitat, bays); the Scrapyard kit; the Hive (husked) variant | 1, 2, 3 |
| Sites | outposts (3), monoliths (3), beacons (2), crash sites (one per hull), dens (burrow, nest, roost), Cartographer vaults, glyph stones | 1–2 |
| Creatures | the 5 body plans rebuilt at the new bar (2 variants each), predators per plan, stone-touched overlays, 5 lifeless-world horrors, ring grazer, belt lurker, depth leviathan | 1–3 |
| Constructs | outpost drone, Overseer, monolith sentinel, 3 Wardens and a lesser Warden, sentinel ship | 2–3 |
| Bosses | Pack Alpha variants, Herd Mother, 3 Sentinel Primes, the Dreadnought, the Patient, the Hive Heart, Husk Admiral, Brood Mother | 2–3 |
| Flora | the 78-mesh library rebuilt at the new bar, plus resource plants and formations for the 10 new resources | 1–2 |
| Props and effects | cargo and loot pods, ammo, catalysts, market stalls, terminals, the Recall glyph set, ability effect meshes | 1–2 |
| Cosmetics | glyph patterns for suits and hulls, liveries, title icons | 2–3 |

### 19.4 Conventions the engine reads
Keep what the engine already understands so content stays simple: material names on hulls (Hull, Accent, Trim, EngineGlow, Nav*, Glass) for liveries and recolours; `COL_` meshes, `Interact`, `Light_`, `Blink` and `Spin` markers on structures; `_limb`, `_pivot` and `_glow` attributes on creatures; colour-region masks on flora. Add: LOD collections, hardpoint and bay empties, skeleton and blendshape naming, cutscene camera curves.

