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
