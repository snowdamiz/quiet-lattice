# Decisions

Where [DESIGN.md](DESIGN.md) or [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) left a question open, the choice made and why.
Format: task id, question → choice → why.

- **P1.E01.T01** Package names? → workspace packages are `@astra/{shared,client,server,tools}` as the plan writes them; the
  root package keeps the game's current title, `next-horizon`. → The plan names `@astra/shared`; the README's title stays.
- **P1.E01.T01** Where do the plan's `tools/…` and `public/models/` paths live? → `tools/…` means `packages/tools/…`;
  `public/` moved with the client, so exported models go to `packages/client/public/models/`. → The task moves `public/`
  into `packages/client`; one tools package keeps scripts and their dependencies together.
- **P1.E01.T01** Port 5173 can be held by another dev server on the machine. → Vite reads `PORT` and defaults to 5173;
  `.claude/launch.json` sets `autoPort`. → The demo is still served at 5173 when the port is free.
- **P1.E01.T01** The demo's videos (`docs/*.mp4`, 73 MB) → tracked with Git LFS beside `*.blend`. → Keeps clones small.
- **P1.E01.T02** TypeScript version → pinned to 6.0.x. → typescript-eslint 8.72 supports TypeScript below 6.1; 7.x is the
  newest release but cannot be linted yet.
- **P1.E01.T02** How is `@astra/shared` consumed? → its `exports` point at the TypeScript source; Vite, vitest and tsx compile
  it in place, and `tsc` only type-checks. → No build step to keep in sync; the server runs under tsx.
- **P1.E01.T02** Prettier on the demo → enforced on new code and configs; the demo's JavaScript is listed in
  `.prettierignore` until each file is migrated (0.6: "migrates file by file when touched"). → Reformatting 23k lines at
  any width would bury every later diff.
- **P1.E01.T04** Host ports for local Postgres and Redis → 55432 and 56379 (overridable in `.env`). → 5432 and 6379 are
  commonly taken by other local services.
- **P1.E02.T07 (plan)** DESIGN 9.1 says the web holds "7 × 20 + 6 = 146 nodes", but every branch table (9.2–9.8) lists 18
  nodes: 3 Tier I, 6 Tier II, 8 Tier III and a capstone. → The tables win: 132 nodes. 20 is each branch's point cost
  (17 nodes at 1 point + a 3-point capstone), so owning the web costs 7 × 20 + 6 × 2 = 152 points, matching "~160". The
  plan's count is corrected; the E02.T07 worker corrects DESIGN 9.1.
- **P1.E02.T08** Started before P1.E02.T07 merged. → Allowed: the protocol needs zod, not the tables' content; ids such as
  resources and peoples travel as strings (people as an enum) and are validated against the tables by the server. → Kept the
  critical path to the server moving while the tables were in flight.
- **P1.E02.T08** Entity ids on the wire → unsigned integers assigned per zone; character and account ids stay strings. →
  Snapshots are the hot path; integer ids keep them small.
- **P1.E02.T08** Snapshot number precision → msgpack float64 for every number. → In a system's inertial frame positions reach
  1e9 m, where float32 loses tens of metres; bandwidth can be tuned later per field.
- **P1.E02.T08 (review)** Message shapes differ from the first ARCHITECTURE draft: `input` nests its pose and uses `time`
  (the tag is `t`), snapshots use `time` and carry `base`, `correction` nests the pose and adds `mode`, `refused` has a
  `code`, `welcome` adds `entityId`, `pose` and `mode`, and there is a `zone` handoff message and a `notice` event. → The
  implementation is the spec; ARCHITECTURE §5 rewritten to match. → Nesting the pose lets one schema validate every pose;
  the rest are needs the draft missed.
- **P1.E02.T08 (review)** Deltas: how is a removed field sent, and what is a delta relative to? → An entity delta lists
  removed fields in `clear`; a delta snapshot names its baseline tick in `base`. → Without them an owner lock could never
  expire on the client and a delta applied to the wrong stored tick would corrupt state.
- **P1.E02.T08 (review)** Bad numbers → the snapshot encoder clamps hp/shield/heat to [0, 1] and drops non-finite fields;
  the decoder drops a bad entity, not the frame; control-message encoding throws on invalid input. → One NaN must never
  blank every client's view, and NaN must never become `null` silently.
- **P1.E02.T08 (review)** Chat text → refuses blank text and C0/C1 controls, soft hyphen, zero-width space, directional
  marks, separators, bidi embeddings/isolates, Hangul and Braille blanks, BOM; allows the zero-width joiner and
  non-joiner (emoji sequences, Persian). Ids refuse every one of those. Lengths are counted in UTF-16 units. → Spoofing
  and invisible names are the threat; emoji are not.
- **P1.E02.T08 (review)** Frame ids are canonical (no leading zeros, seed ≤ 2^32−1); `homeSystem` ≤ 1023;
  `CharacterList` carries `max` (≤ 16) and may not list more characters than it. → One spelling per frame; small bounds.
- **P1.E02.T08 (review)** Snapshot encoding cost → `sanitizeEntity` is exported; zones sanitise each entity once per tick,
  keep that as the sent state, and encode per client with `sanitized: true`. → Validating per client per entity tripled the
  cost (8.4 ms for 25 players × 200 entities); once per tick it is about 0.2 ms.
- **P1.E02.T01** Golden coverage: "home planet" read as each of systems 0–9's `SolarSystem.homePlanet` (10 planets), system 0
  forced lush as the client does; fixture recorded from the original client JS before the port, tests use exact equality.
  Until P1.E02.T02, planet types and radii are checked by a tools test through the client's SolarSystem. → Proves the port
  changed nothing, bit for bit.
- **P1.E02.T01** `EDGE_X`, `EDGE_CURVE_R` and `edgeX` moved from the client's `ui/map/EdgeOfSpace.js` to shared
  `world/edge.ts` (the client imports them from shared); `edgeBearing` and `EDGE_SEED` stay in the client. → Cosmos needs
  them and shared may not import client UI.
- **P1.E02.T01** Shared file names are lowercase (`rng.ts`, `galaxy.ts`, `cosmos.ts` …). → The plan already names
  `shared/world/sites.ts`.
- **P1.E02.T01** The title-shot pixel diff is a script (`packages/tools/src/smoke/title-shot.ts`), not part of `pnpm smoke`,
  with no committed baseline image. → Pixels depend on the GPU backend; the script makes the shot deterministic (seeded
  Math.random, fixed steps, drained worker pool) and compares two captures on one machine.
- **P1.E02.T01** Module-level three.js vectors in shared are marked `/* @__PURE__ */`. → The production chunk-worker
  bundle drops from 97 kB to 13 kB.
- **Orchestrator** Another Claude session edits client files in the main checkout while this plan runs. → Task commits stage
  explicit paths only; merges that would touch that session's uncommitted files wait in an `integration/<task>` branch
  (main plus the reviewed task, verified) until it is done; dependent workers branch from the integration branch.
- **P1.E14.T01** Budgets DESIGN 19.2 does not give → classes in `packages/tools/blender/families.json` with reasons: npc
  25–60k/2k, viewmodel 15–60k/2k, building 8–60k/2k (cities up to 400 m long), kit 0.5–15k/2k, weapon 4–20k/2k, tree
  3–15k/1k, flora 150–6k/1k, effect ≤5k/1k, cosmetic ≤2k/2k; bosses and Wardens are hero, constructs creature. → Between
  the classes DESIGN gives; families.json is the authority (art bible §8 points there).
- **P1.E14.T01** LOD counts → 4 everywhere except viewmodels, effects and cosmetics (1) and the library (none). → A
  first-person tool is always at arm's length; effects and decals have nothing to swap. The art bible says so.
- **P1.E14.T01** Source and export layout → a top-level `REF` collection, one top-level collection per asset, nested
  `<variant>_LOD<n>` collections, `_`-prefixed collections ignored, an `asset_class` property override; exports go to
  `packages/client/public/models/<family>/<file>.glb` with nodes `<asset>/<variant>/<variant>_LOD<n>`. → DESIGN 19.1's
  "named collections per variant and LOD"; per-family folders avoid name clashes and keep the demo's flat files until
  each family is replaced.
- **P1.E14.T01** Markers (DESIGN 19.4 "Add") → `HP_S_*`/`HP_M_*`/`HP_L_*`, `BAY_*`, `Mount`, `Muzzle*`, `Gear*` pivots,
  `Canopy*`, `CockpitInterior`, `Door*` ≥ 2.4 × 1.4 m, armatures on characters, NPCs and bosses; prefixes match
  case-insensitively. The first draft's `Hardpoint_*` and 2.0 × 0.9 m doors were changed to the art bible's.
- **P1.E14.T01** Materials → exported name = `engine_name` property or the material's own name; linked library materials
  are copied per variant before baking (a read-only material cannot be baked) and every bake is checked for written
  texels; AO is baked from the variant's geometry with everything else hidden unless an AO map was painted; signal
  materials (EngineGlow, Nav*, Lamp, GlyphLight, HollowSeam) and glass are exempt from the map set; a constant metallic is
  accepted beside a textured roughness (glTF packs them together); meshes without UVs fail when their material needs maps.
- **P1.E14.T01** Generated LODs → decimation ratios 1 / 0.3 / 0.1 / 0.035, only where no LODs were hand-made; LOD1–3 drop
  shape keys. A failing source writes nothing and removes its stale `.glb`; an unreadable source (LFS pointer) keeps it.
- **P1.E14.T01** `art:validate -- --changed [base]` diffs against the merge-base with the base (default origin/main, else
  main) and re-validates every source when the validator itself changes.
- **P1.E02.T07** DESIGN 9.4 listed 17 Resonance nodes (7 at Tier III), so 7 × 18 was impossible. → Added one Tier III
  passive, **Quiet Mind** ("Dissonance, Null and Nullsong silence you for half as long"), to DESIGN 9.4 and the data. →
  Every other branch's Tier III is 2 actives, 3 passives, 1 ship form and 2 augments; Resonance was one passive short,
  and it answers 9.10's anti-caster tools. **A design addition: the owner may want to rename or replace it.**
- **P1.E02.T07** Ids and terms → resource ids are the demo's (`dihydrogen` …) with DESIGN's names; world types use the
  generator's ids (`alien` = exotic, `gas`); "living worlds" = lush, alien, desert, frozen, toxic, volcanic, storm; "hot
  worlds" = desert, volcanic, inferno; a tier of "3+" reads as 3–5. → One vocabulary with the world generator.
- **P1.E02.T07** Stat modifiers apply add, then mul, then set; "Shield 125"/"Hull 125" are ×1.25 of the hull's base; Tempered
  Core +25 heat capacity; Gunnery scales every weapon cooldown by 0.08/0.12; Efficient Jetpack is jet-fuel duration ×2;
  Living Ship restores the full hull; Quiet Mind's halving applies only to Dissonance, Null and Nullsong. → Each reads
  DESIGN's text in the direction it is written.
- **P1.E02.T07** Unlock routes → Tier I trainers need no rank, Tier II the faction's first rank, Tier III the second; Void
  needs Free Reaches Deckhand; capstones unlock only by chapter; conjunctions are level 15 augments whose only prerequisite
  is a Tier II node in both branches; only branch augments require their target node; the Symbiotic "every species
  analysed" rule is a fragment override (that world's monolith grants Symbiotic instead). Hazard Weave is also unlocked by
  the quest `the_apothecarys_sodium` (DESIGN 14.8), validated once quests exist.
- **P1.E02.T07** Faction unlocks per rank (14.4 lists them per faction) → Compact: Hand double bounties, Factor Tier 2
  hulls at Waystations + Hangar Rights, Lanewarden the Warden-breaker + Quiet Table branch; Reaches: Deckhand Scrapyard
  market + Void + quartermaster, Cutter convoy raid contracts, Captain's Ear the Ghost; Chorus: Listener respec ×0.5,
  Reader memory dives, Voice the Listener hull; cities: Guest livery, Neighbour market fees halved + anchor chain, Claimant
  glyph. Hull rep: Ghost Captain's Ear, Listener Voice, Warden-breaker Lanewarden.
- **P1.E02.T07** Recipes → a tier range takes the tier of the rarest input; the pressure-hull module and husk plating craft at
  the Scrapyard (DESIGN names no fabricator above Tier 3); catalysts take 10 of their resource; suit glyphs 10 and hull
  glyph seams 40 Count residue; field-craftable: pulse fuel, both cartridges, flak ammo, torpedo (Tier 2+); salvage is
  floor(amount / 3) per input, modules only; every Waystation fabricator crafts Tier 0–2.
- **P1.E02.T07** Numbers DESIGN does not give (all in `packages/shared/src/data`, tunable): weapons (Pulse Lasers 11 per
  volley, 0.12 s, 1500 m; Beam Lance 120 dps; Flak 12 × 8 in 40 m; EMP 30 Charge, 150 m; Railgun 400 dmg, 2 s charge;
  Torpedo 600 dmg, 4 per rack, 6 km); body-plan base health (quad_heavy 160, grazer 60, quad_small 30, biped 80, flyer
  50); threat stars by temperament; resistances ×0.5 / ×2 / ×0; horrors, constructs, people and brood stats; Hollow swarm,
  belt lurker and husk stats; convoy composition; boss base health/damage (Pack Alpha 600/35 … Hive Heart 40000/40).
  DESIGN 12.2 attack damage is a base value scaled by level like health. → Balance passes later tune these.
- **P1.E02.T07** Known DESIGN inconsistencies left as written: 9.7 says Pilot has three actives (two listed); 12.7's "Vent in
  ship form" (Vent has no ship form); section 1's "5 hostile variants" lists six; no fabricator for Tier 4–5 recipes; no
  unit price for the Lark (sold on credit).
- **P1.E02.T05 (review)** Den density and spawning → dens are lairs scaled to land area (one predator den per ~80 km² of
  land from Tier 1, a second layer from Tier 3, ambusher burrows at most one per site from Tier 2, one apex lair from
  Tier 2), and predators also spawn around the camera from the herd spawner (DESIGN 12.2 "reuses today's herd spawner …
  with dens"). P1.E08.T03 amended. → A fixed count per world left dens 16–26 km apart, too sparse to be the only spawn
  source; lairs anchor packs, respawns, the apex, ambushers and board bounties.
- **P1.E02.T05** No dens at Tier 0; den kind by body plan (burrow: quad_small packs and ambushers; nest: bipeds and the
  apex; roost: flyers), predator dens split evenly across kinds until species roll (P1.E08.T01); the landmark grove is the
  most wooded of 48 candidate spots; footprints 4/6/5/10 m, relief ≤ 4 m (roosts up to 0.8 × mountain height); 300 m
  between dens, 2 km beyond every city's levelled ground, 40 m clear of sites; a separate JSON `Den[]` returned by
  `planSurface`, planned on natural ground after cities and sites, each pass on its own RNG stream.
- **P1.E02.T05 (review)** DESIGN 13 put the Pack Alpha on Tier 1–2 worlds while 12.2 and 12.8 put the apex at Tier 2+. → The
  Pack Alpha is the apex: Tier 2+ (DESIGN 13 and the boss table changed). → Two sections against one; Tier 1 already has
  territorial and predator fauna.
- **P1.E02.T05 (review)** DESIGN 19.3 lists dens under Sites but the plan had no den art task. → Added P1.E14.T10; the client
  plans without dens until it lands, so no bare clearings appear.
- **P1.E03.T01** Per-account socket cap 4 (the oldest connection is closed at hello, newest wins); 6 characters per
  account; a duplicate join of a character kicks the older connection; per-IP sockets 16; message budget burst 60 at
  40/s with strikes; join timeout 30 s; headers timeout 10 s; outbound buffer cap 1 MiB; control pings share the message
  budget; home system by people is a placeholder index until P1.E02.T04; serverTime from a shard epoch of 2026-01-01Z
  advanced by a monotonic clock until P1.E03.T06; refusals map server errors to `full`, join timeout to `character`. →
  Each bounds memory or keeps a reconnecting player from waiting on a dead socket; numbers are config where tests need it.
- **P1.E02.T02** Body order and indices → each planet followed by its moons, innermost first; `index` is the frame-id body
  index, `slot` keeps the client's old `Planet.index` (orbit or moon number). Params are embedded in full (SolarSystem
  deep-copies them). Quaternion parts are written as +0 (JSON turns −0 into 0). `describeGalaxySystem(info)` in shared is
  the one way to describe galaxy system i (system 0's home world is lush there, not in the client). → Frame ids line up
  with the client array, client and server describe the same system, and the description is pure JSON.
- **P1.E02.T02** The station spec covers orbit, size, soi and seed; the station's layout (pads, bays, colliders) and the
  belt's asteroids are still generated in the client from the seed. → Both must move to shared before docking (P1.E11.T02)
  and mining (P1.E13.T01) become server-authoritative; recorded here so those tasks pick them up.
- **P1.E02.T02** The world-424242 fixture was regenerated once to add orbits, rotations, tilts, gravity, soi, rings, star,
  outer orbit, belt and station (no existing value changed; gas giants' params gained a digest). → Pins every number the
  description produces.
- **P1.E02.T03** A body's `angularVelocity` is a world-frame vector (axis × rate) instead of a scalar; the Waystation's
  velocity is its orbital velocity plus its world's (the demo copied only the world's; nothing read either). `bodyPose`
  takes the parent's pose and throws for a moon without one; `systemPoses` orders parents. "Server uses it for frames" is
  met by a Node-tested API on plain arrays, wired in by P1.E03.T02/T03. → One frame rule for client, server and pirates.
- **P1.E06.T01** Combat math choices → Flare's "60° cone" is the full width (30° each side); resistances never stack (most
  specific of node, weapon, branch decides; lowest at equal specificity); a mob is Hollow if it carries every Hollow
  resistance; killable bosses are 5 stars, the Patient unrated; XP per level rounded to whole points (level 1 costs 0);
  damage is level-scaled only for mob and boss attacks (player abilities are flat until P1.E07 sets their numbers); aggro
  is damage that halves every 3 s (forgotten below 0.5), a taunt forces the target 4 s without adding threat, Veil drops
  the caster's threat, any damage breaks Harmonic; sentinels and Wardens ignore the whole Gravitic branch (×0), Collapse
  Star excepted. DESIGN 12.1's "whoever hurt it most recently" is reworded to match. → Each reads DESIGN's text plainly;
  aggro by decaying threat stops one chip hit stealing a mob.
- **P1.E06.T01 (balance flag)** Mob damage scales ×7 by level 50 while player health stays 100–180 (a level-50 Pack Alpha
  hits for 245). → Left as DESIGN 12.1 writes it; the Phase 1 balance pass (P1.E16) must address it.
- **P1.E06.T01 (follow-ups)** Stone-touched herds keep their body plan's (or apex boss row's) health and attacks, add the
  stone-touched resistances, and rate the higher threat; a row with its own base damage rescales its body-plan attacks so
  the heaviest equals it; Slam's sphere is 6 + 12 × reach m (reach 0–1, mapped from fall height by P1.E07.T04); Crush and
  Singularity take Well's 12 m sphere; AGGRO and XP_CURVE moved into the data tables.
- **P1.E02.T04** "Two nearest neighbours" → the pair of system 0's neighbours whose triangle with system 0 has the shortest
  longest side (ties to lower ids), the Ixari taking the nearer: systems 0 (Thalune, lush, Sarelun radial), 59 (Ixari,
  exotic, Quavel spiral) and 1 (Ulgani, toxic mild, Belost grid), 9.55 / 9.91 / 12.18 ly apart (system 60, at 9.49 ly,
  is 18.7 ly from 59). DESIGN 5.1 now says ~12 ly. → New players of the three peoples meet within one warp.
- **P1.E02.T04** The mild toxic world stays type `toxic` with `params.mist` (line 0.3 × mountain height + 400 m, a 150 m
  band, rate 1.2) and no ship hazard; `mistHazard` is the one hazard function and the client's suit drain calls it. The
  capital is the first plain the existing planner finds, renamed and given its plan (radial, spiral new, grid); every
  random draw stays in order, so the rest of each home system is unchanged. The forcing lives only in shared
  `describeGalaxySystem`; the server's home systems come from `homeSystems()`.
- **P1.E12.T01** Ship model → a weapon fits a hardpoint of its own size or larger; only weapons go on hardpoints (DESIGN 10
  gives platings and husk plating no utility slot — P2.E20.T02 needs one); cargo pods are a count, capacity = the hull's
  bays + Pack Mule; hardpoint ids `s1/m1/l1…` map to `HP_<size>_*` markers sorted per size by name (digits numerically);
  ability slots come from the hull roster (2–5), over DESIGN 9.1's flat 4 (9.1 reworded below); the Lark carries one Pulse
  Lasers module (both barrels) on `s1`; shop upgrades map to their Pilot nodes; `ship.speed = v` divides by the modified
  space speed (with Photon Thrusters, pulse exit holds 400 m/s instead of drifting to 500). Client bundle +45 kB gzip.
- **P1.E12.T01** Server flight caps (for P1.E03.T04) → windows of ≥ 1 s split at every mode or frame change; a window
  passes within ×1.1 + 50 m/s of the larger allowance at its two end poses (never a mid-window pose a cheat could fake);
  pulse clearance computed by the server from the pose; after a mode change the previous allowance decays at 60 m/s² in
  flight and fades e^(−4t) entering the pulse drive; in the air the cap is the boost cap until a per-hull air model
  exists. → Honest flight peaks at 0.88–0.91× the allowance across every hull and manoeuvre simulated; a cheat gains at
  most ~1.2× in flight and 1.1× in pulse, acceptable for Phase 1.
- **P1.E14.T01 (reviews)** AO bakes use every mesh of the variant at that LOD as occluders; markers directly in an asset
  collection are shared by all its variants, markers in a variant collection belong to it; map variation is measured on
  full-resolution texels under the material's UV triangles. → Contact shadows, husk variants and small UV islands now
  validate correctly.
- **P1.E14.T02** The material library carries metre-scale, geometry-independent variation (base colour ±6%, ±18% on dark
  materials; roughness ±0.06–0.09) and stronger normals, so a smooth panel bakes real texture; asset artists still add
  hand-made wear on top. → A library material must never bake flat.
- **P1.E02.T06** Tiers → the home systems are always Tier 0; any other system is Tier 5 on the Edge-ward fringe (within
  EDGE_X − 45 ly of the wall, i.e. 45+ ly out along +X at the default Edge; the line moves with the Edge); otherwise
  DESIGN 11's bands by distance to the nearest home, lower edges inclusive. Tier 1's upper edge moved from 15 to 18 ly
  (DESIGN 11 amended): 3/9/11/22/19/6 systems in tiers 0–5. → Two Tier 1 systems could not carry Act I's opening levels
  for three peoples; the fringe puts DESIGN's Edge-ward Tier 5 at baseline. P2.E22.T02 must move the Edge by tens of ly
  (the fringe moves ly for ly) or keep the fringe line separate from the visible wall.
- **P1.E03.T02** Zones → the interest radius belongs to the entity seen (players are ships unless on foot; npcs and props are
  walkers; pods are loot), with 5% hysteresis; party is a tag until a party system exists; a 64-tick snapshot history
  with a full snapshot when no usable ack exists; entity ids per zone, never reused, restarting when a zone reloads;
  zones sleep after 30 s empty and unload after 5 min; catch-up capped at 3 ticks; client input clamped and marked
  unvalidated until P1.E03.T04 (a client picks its own interest class through `mode` until then); input seq counts from
  1 so `ack` 0 means no input yet; message budget 60/s with a burst of 120 (20 Hz input + 20 Hz ack + pings + casts);
  the bench gates on main-thread CPU p95, wall time is informational. → Each keeps honest clients unpunished and the
  tick inside budget (CPU p95 ≈ 2–4 ms at 200 entities and 25 sessions).
- **P1.E03.T02 (open)** A stall of about 3 s or more can still close an honest client's socket (the burst absorbs ~2.5 s);
  a session whose entity is despawned stays joined with no zone. → P1.E04.T03 (client acks) and P1.E06.T03 (death and
  respawn) must handle these.
- **P1.E14.T01 (skinned follow-up)** Skinned meshes are stamped with `art_variant` / `art_lod` extras at export so the
  re-validation (and the engine) can place them back under their variant and LOD after the glTF importer moves them under
  the armature; the importer runs with `disable_bone_shape`. The glTF exporter writes each skinned object's mesh separately
  (no mesh sharing), so character files grow with their variant count — accepted for now; the engine must not assume a
  skinned mesh is a child of its skeleton root.
- **P1.E12.T06** Detection → sensor ranges (DESIGN gives none): player ship 4000 m × the hull's scan range, pirate scouts
  3500, wing 3000, raiders 3000, the Hollow 1000 (DESIGN 12.7's drifter "within 1 km" for a 1.0 signature), Compact 5000;
  detector kinds player, pirate, hollow, compact; stealth hides the ship (signature 0) from the kinds each effect names —
  Veil from the Hollow, Cloak and Silent Running from all four (Cloak counters the Husk Admiral, DESIGN 13); boosting is
  judged from measured speed above 1.1 × the space cruise cap (never the button); pulsing = on the pulse drive; boost and
  pulse double once; cover = the belt volume as the client draws it and a ±2 km ring sheet; nebulae are not cover until
  the world models them; a raid only rolls if a scout at the spawn distance would detect the ship, and pirates lose a
  ship they cannot detect after a 20 s search. → DESIGN 10.1's rule applied literally, with detection judged from what
  the server can measure.
- **P1.E03.T03** Frame selection is the client's old rule, now shared (`selectFrame`): the Waystation's sphere first, else
  the smallest body sphere holding the entity, else inertial, with 5% hysteresis unless a smaller sphere inside holds it.
  Each tick the zone re-selects every entity's frame at the tick's time and re-expresses it with `setFrame`; a client's
  input frame is taken as sent and wins until the next tick. → One rule on both ends. Open for P1.E04.T03: when the client
  reconciles against snapshots it must re-express the server's pose into its own current frame, not adopt the server's
  frame (near a sphere's edge the two can differ by a tick).
- **P1.E06.T04** Inventory → 16 suit stacks and 8 stacks per cargo pod (schema bounds 64/32/64); stack cap 9999, 15000
  with Pack Mule (suit and cargo); modules, cosmetics and components one per slot; units live in the inventory value;
  fragments, skill points and reputation are refused as non-tradeable; starting kit 2500 units and 1 warp cell on a Lark;
  grants fill suit then cargo and report what did not fit; a hull change repacks or refuses `no_room`; clients may only
  request move/split/merge/transfer/compact with an increasing `seq` (protocol 2); every reply carries the full state; the
  client predicts, replays unanswered requests and drops any unanswered for 5 s; pods come from the ship loadout checked
  against `shipStats` bays; key I. The resource pips (shape by family, muted hues) are a documented functional exception
  in the art bible §4. → DESIGN gives no counts; these keep a trip on foot workable and hauling the ship's job.
- **P1.E03.T06** World service → a `shards` row (epoch 2026-01-01Z, `last_time`, season 1 of 8 weeks from first boot; DESIGN
  16.4's four-week small-population season comes with P2's season roll); the clock starts at max(wall, last_time) and runs
  monotonically, saved every 60 s and on close; the Count (500) and the Edge (EDGE_X) live in memory until P2.E22; the tier
  map is `galaxyTiers(edgeX)`; a JSON Redis mirror with a `{time, at}` sync point; `world` after `welcome` and on change,
  time refreshed through ping/pong; one ZoneManager subscription keeps a tier per zone; the server refuses to boot without
  its shard row (run `pnpm db:migrate`). Two processes must not share a shard row (P3.E37 gives each shard one clock
  owner). → A stub that already behaves like the real service on restarts.
