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
- **P1.E02.T09** World math is deterministic: `@astra/shared/math/det` ports fdlibm 5.3 (sin, cos, atan, atan2, asin, acos,
  log, pow; pow's |y| > 2^31 branch uses a 21-bit split of 1/ln 2) and V8's `Math.hypot` algorithm (`hypot2`, `hypot3`);
  sqrt, floor, round, abs, min, max, imul and fround stay on `Math` because IEEE 754 makes them exact. Under 1 ulp from
  the true value, atan2 under 2 (1.27 measured); 0 differences from Node in Chromium and WebKit over 861k world values
  and 313k adversarial calls (Firefox cannot launch on this macOS, so "every engine" is V8 and JSC for now). three.js's
  `Color` in system.ts is replaced by an exact copy of its sRGB/HSL arithmetic, so a three.js upgrade cannot change
  world generation. An ESLint rule bans Math transcendentals, `**`, `Math.random` and trig-calling three.js methods in
  `shared/src/{world,math}`. The belt now sits between the first two planets past the home world (26 of 70 belts had
  negative widths; 9 of systems 0–9 moved, system 0's from 7.89e6 to 20.19e6 m). Fixtures regenerated once. → The
  server and every client must build the same world bit for bit. Rule going forward: any shared code whose result both
  ends compute and compare (generation, loot rolls, thresholds) uses det; still on `Math` and to move when they reach
  shared: the client's Asteroids counts and sizes (loot), Station layout (P1.E11.T02), Fauna (P1.E08.T01); the XP curve
  in `combat/level.ts` (`**` before `Math.round`) should use det.pow when the client shows thresholds (P1.E07). Combat
  hit tests and the pulse-drive ease are decided by the server alone, so they may stay on `Math`.
- **Plan amendment (orchestrator)** P1.E08.T01 and P1.E13.T01 each had a client half that renders from replicated state,
  which needs the client net layer (P1.E04.T02) their deps did not list. Split: E08.T01 and E13.T01 are now the server
  and shared halves; the client halves are P1.E08.T09 (fauna from snapshots, deps T01 and E04.T02) and P1.E13.T06
  (nodes from zone state, deps T01 and E04.T02). E08.T02's attack animation moves to after T09. E13.T01 now follows
  E13.T02 because both edit the deposit scatter. E10.T01 (city renderer) now waits for the Thalune kit (E10.T05): built
  from kit pieces with none yet made, its graded result would grade placeholders; the Ixari and Ulgani kits slot in as
  they land. → Each task can finish and be verified on its own deps.
- **P1.E14.T03** Grader artifacts → `#review:<family>/<file>[:<asset>[/<variant>]]` (a file with several assets or variants
  writes one folder each under `assets/renders/review/<family>/<file>/<asset>[/<variant>]/`); lighting cases: noon-lush =
  sun 8° from zenith on the home system's lush world, night-exotic = the `alien` planet type at 160°, open-space = four
  planet radii off the home world, sunlit from the side; the asset sits on the flattest dry ground within 240 m with its
  lowest point on the ground, plants in its footprint and the eye-to-asset cone hidden, fauna, ship and multitool hidden;
  one fixed camera (35°, 16°, 1.7 asset radii), LOD0's bounds frame every level; a missing LOD shows the nearest lower
  one; the wireframe pass is clay with edges under noon-lush. Captures are 1920×1080 at pixel ratio 1, adaptive
  resolution off, game clock pinned at t = 120 s, `Math.random` seeded, a fixed 180-frame settle with the worker pool
  drained each frame; reproducibility is under 2% of pixels at a 16/255 cut on one machine. Perf: GPU time from
  `EXT_disjoint_timer_query_webgl2`, each frame started on an idle GPU, the asset's own cost = scene shown minus hidden;
  "holds 60 fps" in the rubric means the asset's own cost, because the planet scenes alone cost 22–30 ms GPU at 1080p
  (terrain and atmosphere GPU cost is a perf item for P1.E16). UI clips: per-screen length (`clipSeconds`; the title is
  3.6 s), optional HUD clock, `sheetFrames` per screen; clip frames are committed under LFS. Turntable sheets are
  `assets/renders/<stem>[_<asset>[_<variant>]]_turntable.png` / `_materials.png` (8 views 45° apart offset 22.5°, 20°
  elevation, LOD0, Cycles 48 samples, AgX), not the `assets/renders/<asset>.png` named in 0.4. → The grader always gets
  the same views of the same scene. Found in review: `LIB_EngineGlow` carried its colour at emission strength 0, so
  every hull's nozzles would have exported black; fixed in the library (strength 1), and the validator now fails a
  signal-profile material that emits nothing. Open: CSS-animation clip frames are timed in real time at 0.1× and can
  jitter when a screenshot overruns; seeking each animation's `currentTime` would make them exact (do it if a grader
  flags jitter).
- **P1.E09.T02** Phases → a PhaseManager per zone (`zone.phases`); caps in `server/src/phases/kinds.ts`: story one party (a
  player in no party is a party of one), bay 24, event 12 (DESIGN 17), raid 12 (DESIGN 16.6's "scale 1–12"; DESIGN 17
  gives no raid cap). Placement (`phaseFor`): the player's current or kept phase at that place, then a party member's
  phase with room, then the fullest with room (oldest on a tie), else a new one; one phase per entity. A member keeps
  the party it was placed under (its live tag only when none was given); a story phase never holds two parties. Story
  hides only its own actors (DESIGN 14.1, "everyone else sees the ordinary world there"); bay, event and raid seal a
  member inside the volume (enter at the radius, leave at 105%) so it and players of every other layer cannot see each
  other; shared-world NPCs stay visible; the phase rule overrides "party always visible". A member outside the volume
  returns to the shared world after a 15 s grace. A disconnect (every socket close until a logout message exists, and
  the kicked connection of a re-join) keeps the member's place for the same grace, keyed by character id: it counts
  toward the cap and the party rule, keeps the phase open, and is reclaimed by the next `phaseFor` at that place;
  reconnecting never extends the grace (it runs from when the member left the volume). Empty phases close at once and
  despawn their entities; phase ids are never reused; a phase's sphere moves with its frame. → DESIGN 17's private
  layers with the least surprise for parties and a network blip. Open: nothing calls `phaseFor` yet; the quest engine
  (P1.E09.T01/T04), the bays (P1.E11.T03) and events (P2.E21.T01) must re-place a character on join; combat, targeting,
  interaction and loot must check `phases.canSee`, and anything spawned for an instance must go through `phases.spawn`;
  snapshots do not yet say which phase a client is in (P1.E09.T04 may need it); kept places rely on a zone ticking 30 s
  after it empties, longer than the 15 s grace.
- **Orchestrator** The space flight model no longer applies the nearby world's gravity (the user's thruster pass from the
  planet-landing session, committed unchanged); the speed-window contract (P1.E12.T01) and movement authority
  (P1.E03.T04) must not assume it. Unit tests run with a 60 s per-test timeout because parallel worktrees load the
  machine (load average 85+) and the golden and fuzz suites take seconds alone.
- **Plan amendment (orchestrator)** P1.E15.T01 (chat and parties) is the server and protocol half; no task drew the chat panel or party frame, so P1.E15.T03 "Chat and party UI" is added (deps T01 and the client net layer P1.E04.T01, visual). → The two-client exit criterion needs players to talk and party up on screen.
- **DESIGN amendment (orchestrator, from the P2.E22.T01 review)** 16.2's "Hold counts as a third of a Feed" now reads: a Hold is a full vote of which a third is Feed, so an all-Hold day targets 383, inside Held. The literal alternative (a Hold weighs a third of a vote, all of it Feed) would send a world of Hold players to Fed, and Held (16.4) is a philosophy that must be able to win a season. The burn is one measure every 4.8 hours (16.1's "a measure every few hours", 16.2's 5 a day), not a lump at the day roll.
- **P1.E03.T05** Character persistence → a per-character component registry (`server/src/persistence`): each subsystem
  registers {key, version `v`, zod schema, migrations, default, load, save, unload}; Phase 1 registers progress (level,
  xp, home in their columns), the ship loadout (default Lark), the inventory (layout re-derived from the saved loadout)
  and the pose (system, frame, pose, mode); skills and quests register theirs later. Storage: one `characters.state`
  jsonb of {v, data} per component plus `revision` and `saved_at` (migration 0002); a new component needs no SQL
  migration; no child tables until state needs cross-character queries. Unreadable state: a bad pose falls back to
  docked at home (logged); any other unreadable component, a newer `v` included, refuses the join (`full`) rather than
  reset progress. Saves: every 30 s in 30 one-second slots (least-loaded), on logout/disconnect, kick, handoff and
  graceful shutdown (5 s wait); only changed components; at most one waiting save per character and one writer,
  batches of 64 in one UPDATE that skips any save whose revision is not above the row's; backoff 0.5 s → 30 s and
  one-row retries; a stale save logs at error level. A character that left stays held until its save lands, a rejoin
  loads the held copy, and the join pins the character during its row read; character ids are taken in lower case and
  any other spelling is refused. One process holds a character at a time: the revision orders one process's saves and
  does not fence two (a fence comes with P3.E37). In-memory services refuse characters they do not hold; changing a
  character out of play is P1.E03.T07's load–modify–save. A crash loses at most one interval while writes succeed.
  Socket close saves first, then leaves the zone as 'disconnected'. → Restart-safe characters without a schema change
  per feature. Open: until P1.E03.T04 merges, a saved pose is client-asserted; its `poseProblem` must validate restores.
- **P2.E22.T01** The Count meter (`server/src/count`) → weights in thirtieths: a counted action is 30, a monolith touch
  3 (a tenth of a vote); Feed gives the Feed side 30, Hold 10 (DESIGN 16.2 as amended), Break 0; tags per action: wall
  choice and anchor held carry feed/hold/break, convoy raided, Hive Heart and Warden are Break only, convoy escorted and
  monolith touch Feed only. Lean = feed ÷ weight (a day with no votes has none and does not drift); target =
  round(150 + 700 × lean), halves up; the drift is clamped to ±25 and never passes the target. The burn ticks at
  k × 17,280 s of world time from the shard epoch (5 a day); a tick tied with midnight burns before the drift; a meter's
  first run counts burns from boot. The meter day is floor(world time ÷ 86,400) (00:00 UTC with the default epoch).
  Downtime burns and rolls on boot with no cap (one change, one log line, one transaction; a dev shard idle 100+ days
  boots at 0). One vote per (account, action type, day), first wins; account ids are UUIDs, lower-cased. The underdog
  is set by the Count's position (Break above 700, Feed below 300, Hold either way; DESIGN 16.2 amended to say so),
  multiplier 1.5 per action tag, applied by the rep model (P2.E18.T01). "Anchor held" is a per-account vote; P2.E28.T04
  decides whose accounts vote. Storage: `count_votes` (kept for the chronicle), `count_days`, and `shards.count`,
  `count_day`, `burn_step` (migration 0003); writes batched (votes in 1,000-row inserts) in one transaction per save,
  failed saves retried until written. The clock floor is max(`last_time`, latest stored vote time). The arithmetic
  lives in the server until a client shows the target (P2.E22.T04 moves it to shared). → DESIGN 16.2's lean-not-volume
  meter, exact at any population. Callers to come: P2.E21.T05 convoys, P2.E28.T04 anchors, P3.E33.T02 Wardens, P3.E33.T03
  Hive Heart, P3.E34.T02/T03 wall choices, the monolith interact.
- **P1.E14.T09** Grader calibration → the five demo baselines (ship 2.0, box station 2.1, structures 2.2, creatures 2.3,
  flora 2.4) are all REVISE with materials 1 and detail and placeholder at 2 or below, as 0.10.5 expects, so the rubric
  stands as written. Graders see mask-coloured families in the game's colours (`@astra/shared/art` gameLook, in the
  review scene and the turntable), not the raw mask. Graders judged samples: 7 of 40 flora, 4 of 10 creatures, 2 of 6
  structures; a whole family is graded on the assets its task delivers. The perf readout's single-run asset cost is
  noisy under load (27.8 ms re-measured at 0.34 ms); P1.E14.T11 adds paired sampling, a 100 m LOD2 view, a collider and
  marker overlay and sibling grids, which four graders asked for. Art tasks are graded after T11 lands. P1.E06.T04 (UI)
  was graded before calibration; calibration covers the models rubric, and its verdicts are recorded in
  `docs/VISUAL-REVIEW.md`.
- **Orchestrator (visual gate of P1.E13.T02)** The six formation models P1.E13.T02 adds are procedural stand-ins by plan: P1.E14.T06 authors them and P1.E14.T07 deletes the generator, so grading them against "no placeholder tell" would fail by construction. E13.T02's blocking visual grade is the UI rubric on the nineteen inventory icons; the formation models are graded as authored art under P1.E14.T06, like the demo flora they sit beside (P1.E14.T04/T05).
- **P1.E13.T02** Nineteen resources → a shared, deterministic node spec (`world/resourceNodes.ts`): 12 node types
  (sodium and oxygen plants, the four deposits, six formations: frostglass on frozen worlds, acidsalt on shores
  0.4–6 m above toxic and corrosive seas, cinderglass along lava fissures in valleys, stormquartz from 0.12 of mountain
  height, gamma crystal up to 0.15, murkpearl on the seabed −18 to −1.5 m); a type is common from its resource's tier
  and 0.2× rarer per tier short; each world carries 2 of the 4 deposits weighted by tier (re-picked if its tier
  changes); sodium and oxygen grow on living worlds only; deposits stay ≥1.5 m above any sea; yields and hp per type;
  ~64 m cells, ids `face_i_j_type_k`, `NODE_TYPES` append-only. Both ends scatter over `drawnGround(params, tier)`
  (`world/ground.ts`): cities and sites planned at the system's tier, dens only once `DENS_DRAWN` is set by P1.E14.T10,
  no node within a site's footprint + 6 m; the server must pass its own copy of params (`drawnGround` sets
  `params.pads`). The tier passes Game → SolarSystem → Planet; the client uses `tierOf` at the default Edge until it
  reads the server's tier map (P1.E04.T02) — if the Edge moves before then, client and server node layers differ.
  Flora keeps main's random sequence (old plant and deposit slots skipped), so only nodes are new. Iridium, Count
  residue, husk alloy and glyphstone get inventory entries and icons only; their sources come with P1.E13.T01
  (asteroids), P2.E25.T01/T05, P2.E21.T03, P2.E30.T02, P3.E33.T02/T03. Icons extend the art bible §4 pip exception
  (family outline, a cut mark per resource, the pip hue); "Ferrite Dust" is "Ferrite"; the trade panel lists the demo
  nine plus any others carried. Nodes under a landed ship are not hidden until P1.E13.T06. → One spec the server
  (P1.E13.T01) computes exactly as the client draws.
- **P1.E15.T01** Chat and parties (`server/src/social`) → channels: `shard` (everyone online), `system` (the sender's
  zone, through a per-zone index checked each second), `party` (online members anywhere); the sender hears its own line;
  text trimmed, control and bidi characters refused by the schema (`ChatText`, `CharacterName` on ChatEvent too); one
  serialisation per line. Limits per account: 5 at once then 1/s, a flood allowance of 10 (one per 3 s) then a 60 s
  mute; shard-wide 20 at once then 10/s; mutes in memory, manual mute API for P1.E03.T07; every line logged. A
  non-fatal `denied {of, code}` reply (separate from `refused`, which closes the socket). Parties: at most 6
  (`PARTY_MAX`; DESIGN is silent); invites by name (case-insensitive), only to online characters in no party, any
  member invites, 60 s lapse, 5 at once then one per 10 s per account, at most 8 held; offline and unknown names both
  get `not_found`; accept joins the inviter's party as it is then, or forms one the inviter leads; only the leader
  kicks and promotes, promoting an offline member is refused (`offline`); lead passes to the longest-standing online
  member; a party disbands at one. Disconnect grace 15 s (the phases'), checked at each party's refresh (≤1.1 s late);
  party state (names, online, system index, health in tenths; no ids or positions) refreshed once a second spread over
  100 ms ticks and sent only when changed. Zone party tags follow the party service (the first production caller of
  `setParty`). A kept phase place is reclaimed only under the party it was kept for, for every phase kind (orchestrator
  decision): a member kicked during its grace is placed afresh. Callers that re-place on join (the quest engine, bays,
  events) must do it after `social.joined` or pass `partyId: social.partyIdOf(character)`. Nothing social is persisted;
  a restart dissolves parties. Protocol 3 adds party, denied and the party event; `PROTOCOL_VERSION` carries a history
  comment and a pinned test, so concurrent bumps conflict visibly. → DESIGN 16.6's Social row at both five and five
  thousand players. Open: P1.E04.T04 should call `social.moved(session)` on handoff; a disbanded party mid-phase leaves
  two parties of one in one story phase until re-placed (quest engine).
- **P1.E08.T01** Server-side fauna (`server/src/fauna`) → species from a shared deterministic `faunaSpecies(params,
  tier)` (det math, plain data; each tier pass appends hostile species on its own stream, so a lower tier's list is a
  prefix of a higher one's; nothing added above Tier 3; DESIGN 12.8's rows read as cumulative); not an exact port of the
  demo's species (the demo shares its RNG with geometry) — the client keeps its own Fauna.js until P1.E08.T09. Herds
  live in ~250 m cells on an equal-angle cube map around players near the ground (measured from the ground under the
  player): wake within 400 m, sleep beyond 500 m (frozen and still visible), unload after 30 s asleep; at most one herd
  per cell (0.14 per species, capped 0.6; hostile weighted 0.6; one level per herd from DESIGN 11's band). Bounds:
  each player wakes at most 4 new cells/s (40 at once, one allowance across the zone), 256 cells per world, 150
  creatures per zone, oldest asleep cells unload first (late arrivals in a busy system may find fewer herds; fairness
  is P1.E16.T02's). Ground is the shared `drawnGround` planned in a worker thread from the moment a player enters the
  world's frame (16 worlds cached; a dead or hung worker is restarted once, then planning falls back to the main
  thread; a failing world backs off 30 s doubling); cells load only once the ground is ready. Interest by size (<1 m
  500 m, apex 2 km, else 1.5 km). The AI's numbers live in `fauna/ai.ts` (sense 60/50/80 m, leashes 40/200/60/40 m, a
  1 s attack phase, 15 s rest after a meal attempt — a bolted prey counts). Only players on foot are prey; players
  hidden from the shared world (`phases.hiddenFromShared`) keep herds awake but are no creature's prey, intruder or
  threat. No damage until P1.E08.T02 (predators break off and rest). Ambushers and the apex come only through
  `spawnHerd` (dens, P1.E08.T03, which must handle `null` when the zone is full and should request ground ahead).
  Protocol 4: a unit `attack` phase; `species` is an index into the world's list. The zone's fauna tier follows the
  world service's tier map. → DESIGN 12.2's living worlds, server-owned and bounded. Open: P1.E08.T03 takes den kinds
  from the rolled species; herds moving around a sealed player hint at its presence.
