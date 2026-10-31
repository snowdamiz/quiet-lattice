# Astra Nullius: Implementation Plan

**Spec:** [DESIGN.md](DESIGN.md) (design v1.0). **Plan version:** 1.0, October 2026.
**Purpose:** a task graph an autonomous agent loop can execute end to end, from today's demo to the Phase 3 game. Every task has dependencies, a "done when" and a "verify" an agent can run.

---

## 0. Running this plan with an agent loop

### 0.1 Loop protocol (one iteration of the orchestrator)
The loop is an **orchestrator** that dispatches work to **subagents** (0.9) and owns this file. It does not implement tasks itself beyond trivial ones; it plans batches, briefs workers, merges, grades and records.
1. **Read this file.** Collect every task marked `[ ]` whose `deps` are all `[x]`, lowest phase first. Tasks tagged `(art)` run on the parallel art track and are always eligible when their deps are met.
2. **Form a batch.** From the eligible set, pick tasks whose `files` do not overlap and whose `done` criteria do not touch the same systems, up to the concurrency cap (0.9.3). Two writers never share a file set.
3. **Dispatch.** For each task in the batch, mark `[~]`, create its branch and worktree, and brief a worker subagent with the template in Appendix C: the task block verbatim, the DESIGN.md sections under `spec`, the global rules, the art-track rules where relevant, the verify commands and the report format.
4. **Workers implement and verify.** A worker reads before writing, implements, runs every command under `verify` inside its worktree, and reports. A task with no passing verification is not done.
5. **Grade.** Every task passes a **code review subagent** on its diff (0.9.5). Every **visual task** (0.10.1) additionally passes the **visual grading subagent** (0.10); while it is there the task is marked `[R]`. A REVISE verdict goes back to the same worker with the grader's notes; the task stays `[R]`. After four REVISE rounds the task gets one more grade (the owner's rule, 2026-10-31): a PASS merges, and a fifth REVISE merges too, with its open notes filed as follow-up tasks in this plan.
6. **Merge.** On PASS from every gate, the orchestrator merges the branch into `main`, re-runs the task's `verify` plus `pnpm typecheck && pnpm test && pnpm smoke` on the merged tree, then marks `[x]`, appends to `docs/PROGRESS.md` (date, task id, worker summary, files touched, grader verdicts), records any spec interpretation in `docs/DECISIONS.md` (task id, question, choice, why), and commits as `P1.E03.T02: <title>`. A merge that breaks `main` is reverted and the task goes back to `[~]` with the failure attached.
7. **On worker failure after 3 attempts:** mark `[!]`, write the blocker as an indented note under the task, and continue with the rest of the batch. Never mark `[x]` to move on.
8. **Phase exit:** when every task in the phase is `[x]` and the exit criteria pass, tag the repository `phase-N` and write `docs/PHASE-N-REPORT.md`.

Only the orchestrator edits this file, `docs/PROGRESS.md` and `docs/DECISIONS.md`. Workers report; they do not mark.

### 0.2 Status markers
`[ ]` todo · `[~]` dispatched to a worker · `[R]` under grading or in a revise round (visual) · `[x]` done and merged · `[!]` blocked, or escalated to a human after repeated REVISE

### 0.3 Global rules
- **DESIGN.md is the spec.** Where it is ambiguous, choose the simplest option consistent with the pillars and record it in `docs/DECISIONS.md`. Where this plan and DESIGN.md disagree, this plan's amendments (0.8) win; everything else defers to DESIGN.md.
- **The game runs after every commit.** `pnpm dev` (client) and `pnpm dev:server` start cleanly; `pnpm smoke` passes.
- **No placeholders in shipped content.** No cubes for buildings, no recoloured stand-ins, no "TODO" art or copy. A missing asset blocks the task; it never downgrades it. The only exception: a hull is a valid stand-in for another hull of the same tier until its own model lands, because every hull is real art.
- **Tests.** Every new system has unit tests. Server logic has integration tests against the dockerised Postgres and Redis. Deterministic generation has golden-fixture tests. Content (quests, chapters) has scripted-bot playthrough tests.
- **Shared code** (world generation, data tables, protocol schemas) lives in `packages/shared` and runs in Node and the browser with no DOM and no three.js rendering (three's math classes are allowed).
- **Server authority.** Position (validated), damage, loot, inventory, quests, economy, skills, meter: the server decides. The client predicts for feel and never for truth.
- **Performance budgets.** Client: 60 fps at 1080p on a mid-range GPU with 24 remote players and a capital in view. Server: a zone with 200 entities ticks at 20 Hz under 10 ms p95.
- **Delete the demo as you replace it.** When a replacement lands, remove the demo code the same task (see DESIGN 20.3). Never leave both alive.
- **Keep engine conventions** (DESIGN 19.4): hull material names, `COL_`/`Interact`/`Light_`/`Blink`/`Spin` markers, `_limb`/`_pivot`/`_glow` attributes, flora colour-region masks.
- **Keep the design doc true.** If an implementation forces a design change, edit DESIGN.md in the same commit and log it.

### 0.4 Art track rules
- Blender runs headless: `/Applications/Blender.app/Contents/MacOS/Blender -b -P <script> -- <args>` (Blender 5.x). An agent authors assets through `bpy`, but the result is saved as a **`.blend` source** under `assets/blend/<family>/` and iterated against renders, not regenerated from a fixed generator at export. Export scripts only validate, bake, build missing LODs and write `.glb`.
- Every art task produces: the `.blend` source; a turntable render at `assets/renders/<asset>.png` (8 angles plus a close-up sheet of materials); a passing `tools/blender/validate.py` run (naming, triangle budgets per class, LOD count, material set, scale references); an exported `.glb` in `public/models/`; in-engine review captures under the three lighting cases via the `#review:<asset>` dev scenario, at LOD0 and LOD2, with a wireframe pass. These artifacts are the grader's only input (0.10). The task is then set `[R]` and graded; it is `[x]` only on a PASS.
- The quality bar is DESIGN 19.2 and the rubric in 0.10.2. Use `generate_3d`/library imports only as reference or blockout, never as shipped geometry.
- An art worker iterates with the grader: it receives the REVISE notes verbatim, fixes exactly what was named, re-renders, and resubmits. It does not argue a verdict; if it believes a note is wrong it says so in its report and the orchestrator decides.
- Rebuilt assets replace demo assets; the demo's generator scripts are deleted in P1.E14.T07.

### 0.5 Repository layout (target, reached in P1.E01)
```
astra-nullius/
  packages/
    shared/        deterministic world gen; data tables (skills, hulls, weapons, resources, recipes, mobs, quests, factions); protocol schemas
    client/        the game client (today's src/ moved here)
    server/        gateway, zone actors, world service, economy service, persistence
    tools/         blender export + validation, bots, load tests, review scenes
  assets/blend/    .blend sources (Git LFS)         assets/renders/  review renders (LFS)
  public/models/   exported .glb (build artifact, committed)
  docs/            DESIGN.md, IMPLEMENTATION_PLAN.md, DECISIONS.md, PROGRESS.md, art-bible.md
  infra/           docker-compose, CI, deployment
```

### 0.6 Technology decisions (fixed here so the loop does not re-decide them)
pnpm workspaces · Node 22 · TypeScript for `shared`, `server`, `tools`; the client stays JavaScript with `allowJs` and migrates file by file when touched · vitest · Playwright for client smoke and e2e (headless Chromium, `window.step()` for deterministic frames because hidden tabs throttle rAF) · `ws` WebSocket, binary snapshots (msgpack) with JSON control messages · zod schemas in `shared/protocol` · Postgres 16 via Drizzle · Redis 7 via ioredis · Docker Compose for local infra · GitHub Actions CI · deployment on AWS (ECS Fargate for gateway/world/economy, EC2 for zone hosts, RDS Postgres, ElastiCache Redis, S3 + CloudFront for the client) in Phase 3.

### 0.7 Verification commands (defined in P1.E01, used everywhere)
`pnpm typecheck` · `pnpm lint` · `pnpm test` (unit + golden) · `pnpm test:int` (integration, needs `pnpm db:up`) · `pnpm smoke` (client boots, renders, no console errors) · `pnpm e2e -- <spec>` (scripted multi-client playthroughs) · `pnpm bots -- --count N --system S` (load) · `pnpm art:validate -- <asset>` · `pnpm art:export -- <family>` · `pnpm gate:removed` (greps that demo code listed in DESIGN 20.3 is gone once its replacement task is `[x]`)

### 0.8 Amendments to DESIGN.md's roadmap
- **The Scrapyard moves to Phase 1.** Act I chapter 11 needs it, and Act I is Phase 1 content. (DESIGN 18 listed it under Phase 2.)
- **Tier I–II of the skill web ship in Phase 1; Tier III, capstones and conjunctions in Phase 2.** DESIGN 18 did not split them.
- **Four hulls in Phase 1** (Lark, Swift, Kestrel, Mule), as DESIGN 19.3 already states; pirate wings in Phase 1 fly Kestrels only until the Bulwark lands in Phase 2.
- **Static-by-tier station prices in Phase 1**, dynamic pricing in Phase 2, so Phase 1 can ship buying and selling without the economy service.

### 0.9 Subagents: how the work is parallelised

#### 0.9.1 Roles
| Role | Count | Owns | Never does |
|---|---|---|---|
| **Orchestrator** | 1 | this file, batching, briefing, merging, the logs, escalation | implements anything larger than a one-file fix; grades its own work |
| **Code worker** | up to 4 at once | one task at a time in its own worktree: implementation, tests, verify, report | edits this file; touches files outside its task's `files` without saying so in the report; marks status |
| **Art worker** | up to 2 at once | one `(art)` task at a time: `.blend` source, renders, validation, export, review captures | ships anything that failed validation; edits engine code beyond the asset's loader hooks |
| **Visual grader** | 1 (fresh instance per verdict) | PASS/REVISE verdicts on visual tasks against the rubric (0.10) | edits assets or code; sees the worker's reasoning or chat, only its artifacts |
| **Code reviewer** | 1 (fresh instance per verdict) | PASS/REVISE on diffs against the global rules (0.9.5) | edits code |
| **QA runner** | 1 | long verifications: e2e playthroughs, bot load tests, soak tests; reports regressions | changes code to make a test pass |

#### 0.9.2 Isolation
Each dispatched task gets a branch `task/<id>` (e.g. `task/P1-E03-T02`) and a git worktree. Workers commit to their branch only. The orchestrator merges to `main` after all gates pass and re-verifies on `main`. Two tasks that would touch the same file are never in the same batch; if a worker discovers it must touch a file outside its `files`, it stops and reports, and the orchestrator either widens the task or serialises it.

#### 0.9.3 Concurrency
Default cap: 4 code workers + 2 art workers + graders and QA as needed. The orchestrator fills the batch by dependency readiness, then by phase, then by the longest estimated task first so the critical path stays busy. The art track is kept full whenever an art task is eligible, because art has the longest lead time and gates the most downstream work (bodies before remote players, kits before cities, the Waystation before bays).

#### 0.9.4 Briefing and reporting
Workers are briefed with Appendix C's template and nothing else: the task block, the spec sections, the rules, the files, the verify commands, the report format. A brief that would need to retell this document means the task is too big; split it in the plan first. Reports come back in the fixed format in Appendix C so the orchestrator can merge and log without reading the worker's transcript.

#### 0.9.5 Code review gate
A fresh reviewer subagent receives the diff, the task block and the global rules, and returns PASS or REVISE with findings. REVISE is mandatory for: client-side authority over anything in the server-authority list; a new system without tests; demo code left alive after its replacement; a budget regression in a perf-tagged task; an unlogged spec interpretation. Style findings are advisory and never block.

#### 0.9.6 Long verifications
e2e playthroughs, bot load tests and soaks run in the QA runner in the background; the orchestrator continues dispatching and merges the task only when the QA report arrives green. A red QA report reopens the task to its worker with the report attached.

### 0.10 Visual grading: nothing visual ships ungraded

#### 0.10.1 What counts as visual
Every `(art)` task, and any task whose `done` includes a model, texture, shader, VFX, animation, cutscene, UI screen, HUD element, in-engine scene or screenshot. In Phase 1 that is at least: E04.T05, E05.T01–T05, E06.T03, E07.T12, E07.T14, E08.T02, E08.T08, E09.T03, E09.T04, E09.T07, E09.T08, E09.T10, E10.T01–T03, E10.T05–T08, E11.T01–T03, E12.T02, E12.T03, E13.T02, E14.T04–T06, E14.T08. The orchestrator tags a task visual at dispatch time by this rule, and the worker's report must include the grader's artifacts (0.10.3) for any task so tagged.

#### 0.10.2 The rubric
The grader scores every criterion 1–5. **PASS requires every criterion at 4 or above and a mean of 4.5 or above.** Anything else is REVISE with one note per failing criterion naming what to change, concretely enough that the worker can act without asking.

*Models and environments (art tasks, city and station builds, ships, creatures)*
| Criterion | 5 means |
|---|---|
| Design language | unmistakably Thalune/Ixari/Ulgani/Compact/Reaches/Cartographer/Hollow per the art bible; nothing generic sci-fi |
| Silhouette and read | identifiable at LOD2 from 100 m; a hull's role or a creature's temperament is legible from its shape |
| Proportion and scale | correct against the 1.85 m biped and 1 m grid; doors, pads, seats fit the bodies |
| Materials | PBR responds correctly under all three lighting cases; hand-painted wear where things wear; no visible tiling, no uniform noise as detail, no blown-out metals (the demo's known failure) |
| Surface detail | detail density matches the asset's class and reads at its intended distance; no baked-looking gradients where geometry is expected |
| Topology and LODs | clean shading, no pinching or n-gon artifacts in the wireframe pass; LOD swaps don't pop at their distances |
| Consistency | matches siblings in its family (the other hulls of the yard, the other buildings of the kit) |
| Fitness for play | colliders match the visual; interact points reachable; animation reads at gameplay speed; hardpoints and bays align |
| No placeholder tell | nothing that reads as blockout, primitive or procedural stand-in |
| Performance | within DESIGN 19.2 budgets; the review scene holds 60 fps |

*UI, HUD, VFX, cutscenes*
| Criterion | 5 means |
|---|---|
| Hierarchy and legibility | the eye lands on the right thing first; text readable at 1080p; contrast meets WCAG AA |
| Fit with the HUD language | minimal, out of the way, consistent with the dot crosshair, arc gauges and fading location line |
| Motion | eases, timing and camera moves feel authored; no pops, no linear tweens, no jitter at 60 fps |
| Theme and palette | uses the people's or faction's palette and the glyph alphabet where lore is shown; dark-sky readability |
| Correctness | no overlap, clipping, cut-off text or wrong state; survives 16:9 and 21:9 |
| Spec match | shows what DESIGN.md describes for that screen or beat |
| Performance | VFX within the particle and draw-call budget; UI costs under 1 ms |

#### 0.10.3 What the grader receives
The grader is a fresh subagent with no access to the worker's transcript. It receives only: the task block and its DESIGN.md references; the art bible; the rubric; and the artifacts: for models, the turntable sheet, the material close-up sheet, the three lighting-case captures at LOD0 and LOD2, the wireframe pass, and the `validate.py` report; for UI/VFX/cutscenes, screenshots at 16:9 and 21:9 and a short captured clip (frames at 60 fps from the smoke harness) of the motion; for in-engine scenes, the review-scene captures and the perf readout. It may request one additional angle or capture, once.

#### 0.10.4 The verdict
```
VERDICT: PASS | REVISE
TASK: P1.E12.T02
SCORES: design 5, silhouette 4, proportion 5, materials 3, detail 4, topology 5, consistency 4, fitness 5, placeholder 5, performance 5 (mean 4.5)
NOTES (REVISE only, one per failing criterion):
- materials: the Kestrel's Hull plates read as a flat grey; add directional wear along the leading edges and panel-line grime consistent with the Lark; roughness map currently uniform 0.5.
ARTIFACTS: assets/renders/kestrel_turntable.png, ...
```
The verdict is appended to `docs/VISUAL-REVIEW.md` by the orchestrator with the artifact paths, so the whole history of an asset's grading is auditable. A human may spot-check any PASS and reopen it; the grader, not the human, is the gate, so the loop never waits on a person unless a task is escalated after four REVISE rounds.

#### 0.10.5 Grader calibration
Before the first art task is graded, the orchestrator runs the grader on the demo's existing assets (the ship, the flora library, the box station, the creatures) and commits the verdicts to `docs/VISUAL-REVIEW.md` as the baseline. The demo assets are expected to score REVISE on materials, detail and placeholder tell; if they PASS, the rubric is too lenient and is tightened before any new asset is graded.

---

## Phase 1: online core and RPG layer

**Exit criteria**
- Two clients on separate machines log in, create characters of different peoples, meet in a Waystation bay and on a planet, and complete the Prologue and all of Act I (chapters 1–12) with instanced beats and cutscenes.
- The skill web is live for Tier I and II of all seven branches with heat, charge and 6 + 4 slots.
- Hostile fauna, pirate scouts and wings, outpost drones, the Overseer and the Pack Alpha exist and scale 1–12. Death triggers the Recall; the ship is lost; A Ship of Your Own works from zero units.
- The three capitals are rendered from Blender kits with full anatomy and safe zones. The Waystation is rebuilt as a modular kit with bay phases. Four hulls, two weapons, the ship ladder, boards and a basic fabricator exist.
- Every item in DESIGN 20.3 is removed (`pnpm gate:removed` passes).
- Load: 50 bots in one system at p95 zone tick under 10 ms; client at 60 fps with 24 remote players and a capital in view.
- All art tasks resolved from `[R]` to `[x]`.

### E01 Repository and tooling
- [x] **P1.E01.T01 Initialise the repository and workspace** · deps: none · files: root, `src/` → `packages/client/src/` · done: `git init`, `.gitignore` (node_modules, dist, .DS_Store, *.blend1), Git LFS for `*.blend` and `assets/renders/**`; pnpm workspaces with `packages/{shared,client,server,tools}`; the client moves to `packages/client` with Vite config, `public/`, `index.html`, `.claude/launch.json` updated; root scripts `dev`, `dev:server`, `build`, `test`, `typecheck`, `lint`, `smoke`. · verify: `pnpm i && pnpm -r build` succeeds; `pnpm dev` serves the unchanged demo at 5173.
- [x] **P1.E01.T02 TypeScript, lint and format baseline** · deps: T01 · done: `tsconfig.base.json`; `shared`/`server`/`tools` strict TS; client `allowJs: true, checkJs: false`; eslint flat config + prettier; `pnpm typecheck`, `pnpm lint` scripts. · verify: both commands pass on the moved demo.
- [x] **P1.E01.T03 Test harness: vitest, Playwright smoke** · deps: T02 · files: `packages/client/src/main.js` (`window.step`, `dev.boot`) · done: vitest configured per package; Playwright smoke test that opens the client, calls `dev.boot()`, runs `window.step(180)`, asserts zero console errors and a non-black rendered frame; `pnpm test`, `pnpm smoke`. · verify: `pnpm test && pnpm smoke` pass.
- [x] **P1.E01.T04 Local infrastructure** · deps: T01 · files: `infra/docker-compose.yml`, `.env.example` · done: Postgres 16 and Redis 7 services with health checks; `pnpm db:up`, `pnpm db:down`, `pnpm db:migrate` scripts. · verify: `pnpm db:up` reports both healthy.
- [!] **P1.E01.T05 Continuous integration** · deps: T03, T04 · files: `.github/workflows/ci.yml` · done: on push: typecheck, lint, unit, integration (service containers), smoke (headless Chromium with SwiftShader), `art:validate` on changed `.blend`. · verify: workflow passes on a push to a branch.
  - *Blocked (2026-10-26): the workflow is written and passes actionlint, but the repository has no GitHub remote, so "passes on a push to a branch" cannot be checked. Needs the owner to choose a remote (e.g. a private GitHub repo) and push.*
- [x] **P1.E01.T06 Documentation scaffolding** · deps: T01 · files: `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/art-bible.md` · done: files exist with headers and the first PROGRESS entry (this task); README updated for the monorepo. · verify: files present; `pnpm lint` on markdown if configured.
- [x] **P1.E01.T07 Gate scripts** · deps: T02 · files: `tools/gates/removed.ts` · done: `pnpm gate:removed` reads a list of symbols/files from DESIGN 20.3 paired with the task ids that replace them, and fails if a replacement task is `[x]` in this plan while the demo code still exists. · verify: `pnpm gate:removed` passes (nothing replaced yet).

### E02 Shared deterministic world
- [x] **P1.E02.T01 Extract world generation into `shared`** · deps: E01.T02 · spec: DESIGN 17 "World from seeds" · files: `src/math/rng.js`, `src/math/noise.js`, `src/terrain/planetgen.js`, `src/terrain/sites.js`, `src/terrain/cities.js`, `src/universe/Galaxy.js`, `src/universe/Cosmos.js` → `packages/shared/src/world/*` (TS) · done: no DOM or renderer imports; the client imports from `@astra/shared`; golden fixtures for seed 424242: system names, classes, planet types and radii for systems 0–9, 20 sampled terrain heights per home planet, site counts. · verify: `pnpm test` golden suite; `pnpm smoke` renders identically (pixel-diff of the title shot under 1%).
- [x] **P1.E02.T02 Pure system description** · deps: T01 · files: `src/universe/SolarSystem.js` · done: `describeSystem(seed, opts)` in shared returns bodies, orbits, params, belt and station spec as data; the client's `SolarSystem` builds meshes from it; the server can call it. · verify: fixture equality for 10 systems; smoke.
- [x] **P1.E02.T03 Body kinematics in shared** · deps: T02 · files: `src/universe/Body.js` · done: `bodyPose(bodySpec, t)` gives position and quaternion; client `Body.update` uses it; server uses it for frames. · verify: unit tests compare client and shared poses for 1,000 random times.
- [x] **P1.E02.T04 Three home systems** · deps: T02 · spec: DESIGN 5.1 · done: `homeSystems()` returns system 0 plus its two nearest neighbours; archetypes forced to lush, exotic, toxic-mild (new mild variant: breathable lowlands, hazard above the mist line, no ship hazard); each home world gets a forced capital city plan; the three Waystations exist. · verify: golden test prints the three ids and types; unit test for the mild variant's hazard function.
- [x] **P1.E02.T05 Dens as a site type** · deps: T01 · spec: DESIGN 12.2 "Spawning" · files: `shared/world/sites.ts` · done: burrow, nest and roost sites planned with footprints and counts by tier; levelled pads; serialised with the planet. · verify: golden counts per tier; smoke shows levelled den pads.
- [x] **P1.E02.T06 Tier function** · deps: T04 · spec: DESIGN 11 · done: `tierOf(system, edgeX)` from distance to the nearest home system and Edge-ward position; a default Edge position; table of all 70 systems with tiers committed as a fixture. The client starts planning dens by tier only after P1.E14.T10 (den art) is `[x]`; before that it plans without dens, so no bare den pads appear. · verify: unit tests for band edges; fixture shows each tier populated.
- [x] **P1.E02.T07 Data tables and schemas** · deps: E01.T02 · spec: DESIGN 9, 10, 12, 15 · files: `packages/shared/src/data/*` · done: typed tables with zod schemas: resources (19), hulls (13), weapons (8), skill nodes (132: 18 per branch as DESIGN 9.2–9.8 list them, plus 6 conjunctions; with branch, tier, type, cost, unlock rule, effect params), recipes, mob archetypes, factions and ranks; a test validates every table and cross-references (e.g., every recipe's inputs are resources). · verify: `pnpm test` data suite; counts match DESIGN's tables (7 × 18 + 6 = 132 nodes, 7 × 20 + 6 × 2 = 152 points to own the web).
- [x] **P1.E02.T08 Protocol schemas** · deps: T07 · files: `packages/shared/src/protocol/*` · done: zod-typed messages for auth, character, zone join, input, snapshot, events (combat, quest, chat), with msgpack codecs for snapshots; versioned. · verify: round-trip tests for every message type.
- [x] **P1.E02.T09 Deterministic world math (added by the orchestrator)** · deps: T03, T04, T05 · spec: DESIGN 17 "World from seeds" · files: `packages/shared/src/world/*` · done: world generation gives bit-identical results in Node and every browser engine: the transcendental functions it uses (sin, cos, atan2, exp, pow, log, sqrt where not IEEE-exact) come from a deterministic implementation in shared, and no generation path calls `Math` for them; the demo's belt choice by position in the planets-plus-moons list is fixed to pick between two planets (found in P1.E02.T02); the golden fixtures are regenerated deliberately, once, with the diff explained. · verify: a test runs the generator in Node and in headless Chromium (and Firefox/WebKit if Playwright has them) and compares site lists, den lists, pads and 20 heights per home planet for systems 0–9 bit for bit; `pnpm test`; smoke; title shot reviewed. *(Added 2026-10-26: P1.E02.T05 found Node's and Chromium's Math.sin/cos differ in the last bit, so a rare threshold could give the server a different site list from the client's.)*

### E03 Server core
- [x] **P1.E03.T01 Server skeleton and accounts** · deps: E02.T08, E01.T04 · spec: DESIGN 17 · files: `packages/server/src/*` · done: HTTP gateway (register, login with argon2, JWT sessions, health), WebSocket upgrade, Drizzle schema and migrations for accounts and characters. · verify: `pnpm test:int` registers, logs in, creates a character, rejects a bad password.
- [x] **P1.E03.T02 Zone actor per star system** · deps: T01, E02.T03 · done: a zone hosts one system's entities; 20 Hz tick; entity registry; spatial hash; interest management by class radius; delta snapshots; many zones per process. · verify: unit tests for interest sets; bench 200 entities under 10 ms p95.
- [x] **P1.E03.T03 Frames of reference over the wire** · deps: T02 · files: `src/universe/Body.js` (`FrameState`) · done: entity poses travel as (frame id, local position, quaternion, velocity); the server tracks frame changes with the shared `setFrame`/`setFrameInto` (P1.E02.T03), the same rule the client's `FrameState` now uses. · verify: round-trip tests across frame changes keep world position within 1 cm.
- [x] **P1.E03.T04 Movement authority** · deps: T03 · done: clients send inputs and predicted poses; the server validates against per-hull and walker speed caps, terrain and station collision (shared sampler), and corrects; anti-teleport. · verify: integration test with a scripted client; a cheating client is snapped back and logged.
- [x] **P1.E03.T05 Character persistence** · deps: T01, T03 · done: pose, frame, inventory, skills, quests, ship persist every 30 s and on logout; loaded on login; schema migrations. · verify: integration test restarts the server and resumes state.
- [x] **P1.E03.T06 World service stub** · deps: T02 · spec: DESIGN 16 · done: a world service publishes season, Count (constant 500 in Phase 1), Edge position, tier map and server clock; zones and clients subscribe. · verify: unit tests; a client receives world state on join.
- [x] **P1.E03.T07 Developer tooling** · deps: T05 · done: dev-only login bypass, a server CLI (teleport, grant, spawn, set quest step, set skill points, mute/unmute), structured logging with per-zone metrics; persistence gains load–modify–save for a character out of play (refused while the character is held, holding its joins until written), which the CLI uses for offline characters (ARCHITECTURE §8). · verify: CLI tests; `pnpm dev:server` logs tick metrics.

### E04 Client networking
- [x] **P1.E04.T01 Client net layer and server-held state** · deps: E03.T05 · files: `src/gameplay/Save.js`, `src/Game.js` (`startGame`, `save`), `src/ui/Menus.js` · done: connect, authenticate, pick a character, join the home zone; `Save.js` and every localStorage save path deleted; autosave now means server sync. · verify: smoke with a local server: login → spawn; `pnpm gate:removed` (Save.js).
- [R] **P1.E04.T02 Remote entities** · deps: T01, E03.T02 · done: remote players and NPC ships rendered from snapshots with interpolation and extrapolation, frame-aware; remote walkers use the body rig once E05.T04 lands (until then they render as their ship when aboard and are hidden on foot, with no stand-in body). · verify: e2e with two headless clients: each sees the other's ship move.
- [ ] **P1.E04.T03 Prediction and reconciliation** · deps: T02, E03.T04 · files: `src/entities/Ship.js`, `src/entities/Player.js` · done: local ship and walker predict; server corrections blended; smoothing tuned. · verify: e2e under 100 ms latency and 2% loss keeps the local/server error under 0.5 m.
- [ ] **P1.E04.T04 Zone handoff** · deps: T03 · files: `src/universe/Universe.js` · done: the client reads the world service's tier map (the `world` message) and rebuilds a system whose tier changed, so the client's dens and node layers follow the server's Edge (added by the orchestrator, from P1.E04.T02); leaving a system (`LEAVE`/`ENTER`) hands the client to the next zone or a "deep space" zone without a loading screen; the warp sequence hands off too. · verify: e2e flies between two systems and warps; no entity duplication.
- [x] **P1.E04.T05 Login and character screens** · deps: T01 · files: `src/ui/Menus.js` (title) · done: title → login → character list → create (people picked in E05.T05) → enter; dev scenarios (`#foot`, `#fly`, …) keep working through dev login. · verify: smoke through the flow.

### E05 Characters and the three peoples
- [R] **P1.E05.T01 (art) Shared skeleton and three base bodies** · deps: E14.T02 · spec: DESIGN 5, 19.2 · done: `assets/blend/characters/` with one skeleton, Thalune, Ixari and Ulgani bodies (LOD0 60–150k tris, 4 LODs, 4k PBR), facial blendshapes, six head or crest variants each, four suit sets each. · verify: `pnpm art:validate -- characters`; turntables; review scene. → `[R]`
- [ ] **P1.E05.T02 (art) Animation set** · deps: T01 · done: ~40 clips on the shared skeleton: idle, walk, run, sprint, jump, jet, swim, mine, three cast archetypes, hit, Recall, emotes. · verify: validate; clip list fixture. → `[R]`
- [ ] **P1.E05.T03 (art) First-person arms and tools per people** · deps: T01 · files: `src/entities/Multitool.js` · done: three first-person arm rigs with a tool each, replacing `multitool.glb`. · verify: validate; review scene. → `[R]`
- [ ] **P1.E05.T04 Skinned body pipeline in the client** · deps: T01, T02, E04.T02 · done: glTF skins loaded, an animation state machine (locomotion blend, jet, swim, mine, cast, hit, Recall), remote bodies, own body in third person for cutscenes; first-person arms from T03. · verify: smoke renders a remote walker; unit tests on the state machine transitions.
- [ ] **P1.E05.T05 Character creation** · deps: T04, E03.T05 · spec: DESIGN 5.1 · done: people, name, look (colour cells, crystal pattern, spore-frond colour via material parameters), server validation, perk flags and the pre-unlocked node applied, home system set. · verify: integration creates each people and checks perks; smoke screenshots of the creator.
- [ ] **P1.E05.T06 Crowd rig for city NPCs** · deps: E08.T02 · files: `src/gameplay/Fauna.js` (vertex rig) · done: the instanced creature rig extended to bipeds with arms on channels 7/8, used for city walkers. · verify: perf test: 200 walkers under 1 ms CPU per frame.

### E06 Combat model and death
- [x] **P1.E06.T01 Combat math in shared** · deps: E02.T07 · spec: DESIGN 12.1 · done: level scaling, threat ratings, resistances by branch, hit shapes (ray, cone, sphere) with tests. · verify: unit tests.
- [x] **P1.E06.T02 Server combat resolution** · deps: T01, E03.T04 · done: abilities and weapons resolve on the server; clients show cosmetic prediction; damage, death and loot events replicated. · verify: integration: a player kills a test mob; client-reported damage is rejected.
- [ ] **P1.E06.T03 The Recall** · deps: T02, E05.T04 · spec: DESIGN 7 · files: `src/Game.js` (`playerDied`, `shipDestroyed`), `src/entities/Pirates.js` (`playerDefeated`) · done: at zero health the server flags Recall; the client plays the glyph-dissolve-flash sequence (Blender VFX from E07.T14); respawn at the home anchor; the ship entity is destroyed and its cargo drops as a pod with a 10-minute owner lock; the demo's suit failure, ship rebuild and tow paths are deleted along with both death taxes. · verify: integration; smoke captures the Recall; `pnpm gate:removed`.
- [x] **P1.E06.T04 Suit inventory and cargo pods** · deps: E02.T07 · spec: DESIGN 10.1 · files: `src/gameplay/Inventory.js` · done: inventory split into suit stacks and ship cargo pods (per hull); UI; server-authoritative. · verify: unit + integration.

### E07 Skill web (Tier I and II)
- [x] **P1.E07.T01 Skill state on the server** · deps: E02.T07, E03.T05 · spec: DESIGN 9.1 · done: points, unlocked set, bought set, slots, fragment ledger, respec; prerequisite and tier-level validation. · verify: unit and integration.
- [x] **P1.E07.T02 Heat and Charge** · deps: T01 · files: `src/entities/Multitool.js` (heat), `src/entities/Ship.js` (pulseFuel) · done: server-authoritative meters with the world modifiers (planet type, day, underwater), overheat lockout, Charge regen in sunlight; HUD readouts. · verify: unit tests of the cooling table; smoke HUD.
- [~] **P1.E07.T03 Ability runtime** · deps: T02, E06.T02 · done: cast request → validation → effect → replication → client VFX; cooldowns; keys 1–6 on foot, 1–4 in flight; LMB stays tool/gun. · verify: integration casts a test ability from each slot.
- [ ] **P1.E07.T04 Gravitic I–II** · deps: T03 · done: Pull, Heavy Footing, Tractor Beam, Slam, Well, Dense Bones, Mass Sense, Inertial Brake, Pull Many per DESIGN 9.2. · verify: one integration test per node (Pull moves a mob 25 m; Well slows 60%; Slam knocks down in radius).
- [ ] **P1.E07.T05 Thermal I–II** · deps: T03 · done: Lance (the beam as damage), Tempered Core, Focused Lasers, Flare, Sear, Vent, Hot Hands, Ablative Plating, Chain. · verify: per-node tests.
- [ ] **P1.E07.T06 Resonance I–II** · deps: T03 · files: `src/Game.js` (`scan`) · done: Pulse (scan + stun), Long Ear, Deep Sweep, Harmonic, Shatter, Veil, Choir, Jammer, Echo. · verify: per-node tests.
- [ ] **P1.E07.T07 Symbiotic I–II** · deps: T03, E08.T04 · done: Bond (companion AI from analysed species), Second Lung, Repair Drones, Regrow, Spore, Call, Thick Hide, Symbiont Hull, Big Game. · verify: per-node tests including companion follow and attack.
- [ ] **P1.E07.T08 Void I–II** · deps: T03 · done: Phase, Edge Sense, Micro-jump, Drain, Rift, Eclipse, Hollowed, Cloak, Blink Strike; gated on a Reaches standing flag (the flag exists; the chain that grants it is Phase 2). · verify: per-node tests; gate test.
- [ ] **P1.E07.T09 Pilot I–II** · deps: T03, E12.T01 · files: `src/ui/Menus.js` (`SHOP`), `src/gameplay/Save.js` (`applyUpgrade`) · done: Throttle Tuning, Soft Landing, Reserve Tank, Photon Thrusters, Shield Capacitor, Hull Plating, Thermal Plating, Pressure Hull, Hazard Coating as nodes; the SHOP list and `applyUpgrade` deleted. · verify: per-node tests; `pnpm gate:removed`.
- [ ] **P1.E07.T10 Exo-suit I–II** · deps: T03 · done: Cartridge Recycler, Long Jump, Efficient Jetpack, Hazard Weave, Cold Blood, Heat Shroud, Optical Drill, Scanner Lens, Sprint Stride. · verify: per-node tests.
- [ ] **P1.E07.T11 Monolith fragments** · deps: T01, E09.T05 · spec: DESIGN 9.1 "Unlocks" · files: `src/gameplay/Structures.js` (`interact` monolith) · done: touching a monolith grants a fragment keyed to the world's branch; unlock evaluation; the demo's units + warp-cell payout replaced by fragments + a tier-scaled unit reward. · verify: integration.
- [ ] **P1.E07.T12 Skill web UI** · deps: T01–T11 · done: a web screen (seven branches, node states, buy, slotting), the ability bar on the HUD, heat glow on the tool and remote players' tools. · verify: smoke screenshots; UI unit tests.
- [ ] **P1.E07.T13 Trainers and unlock sources** · deps: T12, E09.T05 · done: Chorus listener, city master, Waystation outfitter NPC roles unlock their branches' Tier II given standing flags (standing itself is Phase 2; Phase 1 uses story flags). · verify: integration.
- [ ] **P1.E07.T14 (art) Ability and Recall effects** · deps: E14.T02 · done: effect meshes and particle sheets per branch palette for Tier I–II, the Recall glyph set. · verify: validate; review scene. → `[R]`
- [x] **P1.E07.T15 Skill state survives data changes (added by the orchestrator)** · deps: T01 · files: `packages/server/src/skills/**`, `packages/shared/src/skills/**`, `packages/server/src/persistence/**` · done: stored skills carry a skill-web data version; at decode, a stored state from an older web is reconciled instead of refusing the join: unknown node ids dropped, owned nodes that lost a prerequisite refunded deepest first, slot arrays resized to the hulls, fragments returned for unlocks of removed nodes (the state records what each unlock paid), a warning logged per character; only bad structure or a newer version refuses. · verify: unit tests renaming, re-tiering and removing nodes in a fixture web; integration: a character saved under the old web joins under the new one.

### E08 Mobs, Phase 1 set
- [x] **P1.E08.T01 Server-side fauna simulation** · deps: E03.T02, E02.T05 · spec: DESIGN 12.2 · files: `src/gameplay/Fauna.js` (read: species and behaviour to port), `packages/server/src/fauna/**`, shared species data · done: species generated per planet from shared data; the server owns herd state and AI (idle, wander, flee, territorial, predator, ambusher, apex); creatures replicate to clients as zone entities (species, state, attack phase). The client side moves to T09 (amended by the orchestrator: rendering from replicated state needs the client net layer, E04.T02). · verify: integration: a predator chases a bot; two bot clients see the same herd in their snapshots.
- [ ] **P1.E08.T09 Client fauna from replicated state** · deps: T01, E04.T02 · files: `src/gameplay/Fauna.js` · done: the client renders herds from snapshots with the instanced rig (interpolated, frame-aware); its own herd AI and spawning deleted; dev scenarios keep showing fauna through the dev server. (Added by the orchestrator, split from T01.) Also graded here (amended by the orchestrator, from P1.E06.T02 and P1.E08.T04): the combat HUD damage numbers, damage flash and XP/loot toasts on drawn server creatures, and analysing a drawn creature (codex banner), since both had no visible target before this task. · verify: e2e: two headless clients see the same herd; `pnpm gate:removed`.
- [ ] **P1.E08.T02 Attacks and attack animation** · deps: T01, T09 · done: fauna ignores players the cutscene service marks `watching` (as it ignores players phases hide; added by the orchestrator from the P1.E09.T04 review, due before creatures deal damage); per-body-plan attacks (charge, stomp, bite swarm, leap, claw, dive, screech, kick) with vertex-rig attack states driven by a per-instance attack phase. · verify: smoke captures each attack; unit tests on timings and damage.
- [x] **P1.E08.T03 Dens, spawning and night** · deps: T01 · done: predators spawn around the camera from the herd spawner (DESIGN 12.2) and also from den sites, which anchor packs, respawn them on timers and host the apex; ambushers wait at their burrows; night doubles predator spawns. *(Amended 2026-10-26: dens are lairs scaled to land area, not the only spawn source; see DECISIONS, P1.E02.T05.)* · verify: integration with a forced clock.
- [x] **P1.E08.T04 Analysis and codex** · deps: T01, E03.T05 · files: `src/Game.js` (analyze) · done: analysis records a server codex entry (temperament, threat, body plan), grants XP, marks Bond eligibility; the demo's unit reward replaced. · verify: integration.
- [ ] **P1.E08.T05 Pirate faction AI** · deps: E12.T03, E03.T02 · spec: DESIGN 12.7 · files: `src/entities/Pirates.js` · done: scouts (2 Darts stand-in: Swifts until the Dart lands) and wings (3 Kestrels) with flanking, break-off at 30% hull and retreat; spawns driven by system tier and signature, not a random timer; the demo raid timer deleted. · verify: integration; `pnpm gate:removed`.
- [ ] **P1.E08.T06 Outpost drones and the Overseer** · deps: T01, E09.T05 · spec: DESIGN 12.5, 13 · done: drones patrol outposts; the Overseer mini-boss with its three phases at designated outposts. · verify: integration kills both with a bot.
- [ ] **P1.E08.T07 Pack Alpha** · deps: T02, T03 · spec: DESIGN 13 · done: the apex world boss with charge, pack call and enrage, scaled 1–12 by players in range. · verify: integration with 1 and 6 bots; scaling asserted.
- [ ] **P1.E08.T08 (art) Creatures at the new bar** · deps: E14.T02 · done: the five body plans rebuilt (two variants each) with attack poses, hand-weighted limbs; predator variants; outpost drone; Overseer. · verify: validate; review scene. → `[R]`

### E09 Quest engine, Prologue and Act I
- [x] **P1.E09.T01 Quest schema and runtime** · deps: E02.T07, E03.T05 · spec: DESIGN 14.1 · files: `src/gameplay/Objectives.js` · done: quest definitions as data; every step type (travel, interact, collect, mine, analyze, scan, kill, defend, escort, deliver, survive, touch, dialogue, cutscene, choice); server runtime evaluating predicates from events; persistence; `Objectives.js` deleted. · verify: unit test per step type; integration with a sample quest; `pnpm gate:removed`.
- [x] **P1.E09.T02 Phases** · deps: E03.T02 · spec: DESIGN 17 "Phases are first class" · done: a phase manager opens private layers at shared locations with caps; party membership; phase-local entities replicated only to members. · verify: integration: two players in different phases at one spot do not see each other's actors.
- [ ] **P1.E09.T03 Dialogue bar, journal, quest markers** · deps: T01, E05.T04 · files: `src/ui/HUD.js` (markers), `src/ui/style.css` · done: dialogue bar with speaker bust (rendered from the people's model), choices; journal screen; marker kind `quest`; objective line kept. · verify: smoke screenshots.
- [x] **P1.E09.T04 Cutscene tooling** · deps: T02, E14.T03 · files: `src/Game.js` (pose blends, dips, banners) · done: camera curve playback from Blender-exported curves, letterbox, dialogue timing, skip, banner hooks; always phased. · verify: smoke plays a test cutscene end to end.
- [ ] **P1.E09.T05 NPC framework** · deps: T03, E05.T06 · files: `src/universe/Station.js` (hologram) · done: NPC entities with dialogue trees, vendor, trainer and board roles; the Quartermaster replaces the decorative hologram. · verify: integration talks, buys, accepts a job.
- [ ] **P1.E09.T06 Boards** · deps: T05, E13.T04 · spec: DESIGN 14.3 · done: bounty, delivery, survey, salvage, escort and patrol jobs generated from live zone state; refresh every 30 min; city civic jobs. · verify: unit tests on generation; integration accept and complete each kind.
- [ ] **P1.E09.T07 Prologue content (chapters 1–5)** · deps: T04, T05, E10.T02, E11.T04, E07.T11 · spec: DESIGN 8 · done: Cold Open cutscene, First Jobs, The Capital, The Touch cutscene, Leaving Home; stake ship on credit; the Quartermaster's debt chain begins. · verify: `pnpm e2e -- prologue` with a scripted bot completes all five.
- [ ] **P1.E09.T08 Act I content (chapters 6–12)** · deps: T07, E08.T05, E11.T05 · done: all seven chapters with their beats, the Hollow drifter and Sanctuary cutscenes, the Scrapyard instance in chapter 11, the registry handoff in chapter 8. · verify: `pnpm e2e -- act1`.
- [ ] **P1.E09.T09 Mystery scaffolding** · deps: T08 · spec: DESIGN 14.7 · done: the Forty Names registry data, the first ten crash logs placed in Tier 1–2 systems, one glyph-stone puzzle, the crash-log collection step. · verify: integration.
- [ ] **P1.E09.T10 (art) Prologue and Act I cutscene cameras** · deps: T04 · done: camera paths authored in Blender for every Prologue and Act I cutscene. · verify: validate; smoke plays each. → `[R]`

### E10 Cities and capitals
- [ ] **P1.E10.T01 City renderer** · deps: E02.T04, E14.T02, T05 · spec: DESIGN 5.1 · files: `src/terrain/cities.js` (`layoutCity`, `streetPlan`, `cityFrame`, unused today) · done: cities built from the planner with instanced kit pieces, street ground shader, colliders, streaming and LOD per city, night lighting. · verify: smoke renders a capital at 60 fps from the gate and from orbit.
- [ ] **P1.E10.T02 Capital anatomy and safe zones** · deps: T01, E09.T05 · done: plaza with anchor stone (Recall point), market hall, skill master, Compact office with board, listening house, shipyard pads, salvage yard, gate districts; server-side 5 km safe-zone volume flag. · verify: integration: entering the zone sets the flag; interact points reachable.
- [ ] **P1.E10.T03 City life** · deps: T02, E05.T06 · done: crowd walkers on the street plan, ambient vendors, lights by time of day. · verify: perf test.
- [ ] **P1.E10.T04 A Ship of Your Own** · deps: T02, E12.T05, E09.T01 · spec: DESIGN 7 · done: the home quest per capital: wreck outside the city, salvage, repair, a Lark; available whenever shipless and below the Lark's price. · verify: `pnpm e2e -- ship-of-your-own` from zero units.
- [ ] **P1.E10.T05 (art) Thalune kit and Sarelun landmarks** · deps: E14.T02 · done: low/mid/tall × 4 variants, plaza, halls, yards, gates, walls, bridges, lamps, props; shell-ribbed language. · verify: validate; review. → `[R]`
- [ ] **P1.E10.T06 (art) Ixari kit and Quavel landmarks** · deps: E14.T02 · done: the crystal language kit. → `[R]`
- [ ] **P1.E10.T07 (art) Ulgani kit and Belost landmarks** · deps: E14.T02 · done: the lattice and cap language kit. → `[R]`
- [ ] **P1.E10.T08 (art) Anchor stones and monoliths** · deps: E14.T02 · done: three anchor stones as landmarks; the three monolith variants rebuilt; glyph alphabet applied. → `[R]`

### E11 Stations and the Scrapyard
- [ ] **P1.E11.T01 (art) Waystation and Scrapyard kits** · deps: E14.T02 · spec: DESIGN 19.3 · done: hangar bay module, trade deck, fabricator, spine, ring, habitat, bay door, props; the Scrapyard's hollowed-asteroid kit. · verify: validate; review. → `[R]`
- [ ] **P1.E11.T02 Station builder from kits** · deps: T01, E02.T02 · files: `src/universe/Station.js` · done: stations assembled from kit modules per seed with colliders from `COL_` meshes; the box-geometry builder deleted. The fabricator terminal stays at shared `STATION_FABRICATOR`, which the server checks (amended by the orchestrator from P1.E13.T05). · verify: smoke; collision tests; `pnpm gate:removed`.
- [ ] **P1.E11.T03 Bays as phases** · deps: T02, E09.T02 · spec: DESIGN 16.6 "Hubs" · files: `src/entities/Ship.js` (docking), `src/entities/Traffic.js` · done: the hangar interior is a phase of 24 with a pad each; docking autopilot targets your bay; exterior shared; traffic NPCs per bay. · verify: integration: 30 bots dock into two bays.
- [ ] **P1.E11.T04 Trade deck services** · deps: T03, E09.T05, E12.T05, E13.T05 · files: `src/ui/Menus.js` (trade panel) · done: Quartermaster, outfitter (ship ladder), fabricator terminal, board; the sell-only trade panel deleted. · verify: integration buys a hull and crafts a cell; `pnpm gate:removed`.
- [ ] **P1.E11.T05 The Scrapyard instance** · deps: T02, E09.T02, E08.T05 · spec: DESIGN 13 · done: the chapter 11 dungeon: wing at the mouth, docking, deck fight through crews, the Singer captain; scaled 1–12. · verify: `pnpm e2e -- scrapyard`.

### E12 Ships, Phase 1 hulls
- [x] **P1.E12.T01 Hull and module model** · deps: E02.T07 · spec: DESIGN 10 · files: `src/entities/Ship.js` · done: a ship is a hull id plus fitted modules; stats, hardpoints, ability slots, signature from data; server-authoritative flight caps per hull. · verify: unit tests.
- [R] **P1.E12.T02 (art) Lark, Swift, Kestrel, Mule** · deps: E14.T02 · done: four hulls with gear, canopy, cockpit interior, hardpoint mounts, damage state, husked variant, three liveries each; the Lark rebuilds today's ship at the new bar. · verify: validate; review. → `[R]`
- [ ] **P1.E12.T03 Client ship system on hull data** · deps: T01, T02 · files: `src/entities/Ship.js`, `src/entities/Cockpit.js`, `src/entities/Traffic.js`, `src/entities/Pirates.js` · done: model, cockpit, stats and camera per hull; traffic and pirates draw from the roster. · verify: smoke flies each hull; e2e sees mixed traffic.
- [ ] **P1.E12.T04 Weapons: Pulse Lasers and Mining Laser** · deps: T03, E06.T02 · done: hardpoint modules, mounting, server hit resolution; the demo lasers become the Pulse Lasers module. · verify: integration.
- [ ] **P1.E12.T05 Ship ladder and ownership** · deps: T03, E03.T05 · done: buy at stations, garage of owned hulls, active hull, loss on Recall, stake credit for the Lark. · verify: integration.
- [x] **P1.E12.T06 Signature and detection** · deps: T01 · done: detection distance = sensor range × signature, modifiers for belts, boosting, pulsing; used by pirates and markers. · verify: unit tests.

### E13 Economy, Phase 1
- [x] **P1.E13.T01 Server-side resource nodes** · deps: E03.T02, E02.T01, T02 · spec: DESIGN 16.6 "Resources" · files: `packages/server/src/resources/**`, the shared node scatter · done: harvestable nodes are shared per cell with minute-scale respawn, placed by the shared scatter both ends compute; mining hits resolve on the server (range, line of sight, rate) and grant into the inventory service. The client side moves to T06 (amended by the orchestrator: hiding harvested nodes from state needs the client net layer; T02 first because both edit the deposit scatter). · verify: integration: two players mine the same node; respawn timer.
- [ ] **P1.E13.T06 Client resource nodes from state** · deps: T01, E04.T02 · files: `src/gameplay/Flora.js`, `src/entities/Multitool.js` · done: the client keeps rendering flora from the deterministic scatter, hides harvested nodes from zone state and sends mining hits as requests; the local `mined` sets deleted. (Added by the orchestrator, split from T01.) · verify: e2e: two clients mine the same node and both see it vanish and respawn.
- [ ] **P1.E13.T07 Shared asteroid field and server asteroid mining (added by the orchestrator)** · deps: T01, E12.T04 · files: `src/universe/Asteroids.js`, `packages/shared/src/world/**`, `packages/server/src/resources/**` · done: the asteroid field (cells, counts, sizes, rich rocks) moves to shared det math so both ends compute it; iridium appears in rich asteroids of Tier 3+ belts; asteroid mining by ship weapons resolves on the server like node mining (range, sight, rate) and grants into the inventory service; the client's local asteroid grants deleted. Found by P1.E13.T01 (the client's Asteroids.js is client-only and feeds loot). · verify: golden asteroid fixture identical across engines; integration: a ship mines a rich asteroid for iridium in a Tier 3 belt.
- [x] **P1.E13.T02 Nineteen resources** · deps: E02.T07 · files: `src/gameplay/Flora.js` (`DEPOSITS`, resource plants) · done: inventory, icons and node types for the ten new resources placed on their worlds by the shared scatter spec. · verify: golden scatter counts per world type; smoke.
- [ ] **P1.E13.T03 Station prices, buy and sell** · deps: T02, E11.T04 · files: `src/gameplay/Inventory.js` (`RESOURCES`) · done: per-station prices from base × tier factor (static in Phase 1), buy at 1.25×; the flat price table deleted. · verify: integration; `pnpm gate:removed`.
- [ ] **P1.E13.T04 Payout rebalance** · deps: T03 · spec: DESIGN 15.6 · files: `src/gameplay/Structures.js`, `src/Game.js` (discoveries) · done: site and discovery payouts cut to a third at Tier 0 and scaled by tier; XP added. · verify: unit table test.
- [x] **P1.E13.T05 Basic fabricator** · deps: T02 · spec: DESIGN 15.7 · done: consumable recipes (warp cell, pulse fuel cell, cartridges, flak ammo), recipe items, station and ship fabricators. · verify: integration.

### E14 Art pipeline (parallel track)
- [x] **P1.E14.T01 Validation and export tooling** · deps: E01.T02 · spec: DESIGN 19.1, 19.4 · files: `tools/blender/validate.py`, `tools/blender/export_<family>.py`, `pnpm art:*` · done: validation of naming, triangle budgets by class, LOD count, material set, scale references; export scripts per family that bake and write `.glb`; CI hook. · verify: run against the demo's exported `.glb` files reports the expected failures.
- [x] **P1.E14.T02 Sources, LFS and the art bible** · deps: T01 · files: `assets/blend/`, `docs/art-bible.md` · done: family folders; LFS tracking; the art bible with the three design languages, the Cartographer glyph alphabet, palettes, the shared material library (`assets/blend/_library.blend`), scale references. · verify: validate passes on the library; bible reviewed in PROGRESS.
- [x] **P1.E14.T03 Review scene and grader artifacts** · deps: T02 · spec: 0.10.3 · files: `src/dev/*`, `tools/blender/turntable.py`, `tools/capture/*` · done: `#review:<asset>` dev scenario loads an asset under noon-lush, night-exotic and open-space lighting at LOD0 and LOD2 with a wireframe pass and a perf readout; `turntable.py` renders the 8-angle sheet and the material close-up sheet; `pnpm capture -- --ui <screen>` grabs 16:9 and 21:9 screenshots and a 60 fps frame clip from the smoke harness. These are the only inputs the visual grader receives. · verify: artifacts produced for the material library and for the title screen.
- [x] **P1.E14.T09 Visual grader calibration** · deps: T03 · spec: 0.10.5 · files: `docs/VISUAL-REVIEW.md` · done: a fresh grader scores the demo's ship, flora library, box station and creatures with the C.3 brief; verdicts committed as the baseline; the rubric is tightened and re-run if any demo asset passes. · verify: `docs/VISUAL-REVIEW.md` holds a baseline verdict per demo asset, all REVISE.
- [ ] **P1.E14.T04 (art) Flora rebuild: trees** · deps: T02 · files: `blender/build_flora.py` (reference only) · done: round, conifer, palm, mushroom, spiral, coral, blob, cactus at the new bar, two models each, colour-region masks kept. → `[R]`
- [ ] **P1.E14.T05 (art) Flora rebuild: plants, grass, rocks, deposits, crystals** · deps: T02 · done: bush, fern, plant, grass, rock, boulder, crystal, deposits (copper, cobalt, gold, di-hydrogen), sodium plant, oxygen flower. → `[R]`
- [ ] **P1.E14.T06 (art) New resource formations** · deps: T05, E13.T02 · done: frostglass, acidsalt, cinderglass, iridium, stormquartz, gamma crystal, murkpearl nodes; Count residue, husk alloy and glyphstone as loot meshes. → `[R]`
- [ ] **P1.E14.T07 Delete the generators and fallbacks** · deps: every Phase 1 `(art)` task `[x]`, E11.T02, E08.T08 · spec: DESIGN 20.3 · files: `blender/build_*.py`, `src/gameplay/Structures.js` (`buildOutpost`, `buildMonolith`, `buildCrash`, `buildBeacon`), `src/gameplay/Fauna.js` (`buildQuadruped`, `buildFlyer`), `src/gameplay/floraModels.js` · done: generators and procedural fallbacks removed; a missing library asset throws at load. · verify: `pnpm gate:removed`; smoke.
- [ ] **P1.E14.T08 (art) Props** · deps: T02 · done: cargo and loot pods, terminals, market stalls, ammo, catalyst vials, beacons rebuilt, outposts rebuilt (3), crash-site debris kit. → `[R]`
- [ ] **P1.E14.T10 (art) Dens: burrow, nest, roost, apex lair (added by the orchestrator)** · deps: T02, E02.T05 · spec: DESIGN 12.2, 19.3 ("Sites … dens (burrow, nest, roost)") · done: two variants of each den kind and the apex lair, sized to the planner's footprints (burrow 4 m, nest 6 m, roost 5 m, lair 10 m), dressed for living worlds, with colliders and a spawn marker; the client draws dens only once this lands (until then the client plans worlds without dens). → `[R]`
- [x] **P1.E14.T11 Review scene: far view, overlays, paired perf (added by the orchestrator)** · deps: T03, T09 · spec: 0.10.3 · files: `src/dev/review.js`, `tools/capture/*` · done: every `--review` capture adds a 100 m view of the asset at LOD2 under noon-lush (the rubric's silhouette distance) and a collider and marker overlay pass (`COL_*` volumes translucent, `Interact`/`HP_*`/`BAY_*`/`Gear*` markers labelled); the perf readout takes interleaved shown/hidden frames and reports the median of the paired differences, so load noise cancels; a `--family` option renders a grid turntable of a file's siblings for the consistency criterion. Found by the calibration graders, whose requests the scene could not meet. · verify: unit tests; a capture of the demo ship and of structures shows the new views; two perf runs on a loaded machine agree within 0.5 ms.
- [x] **P1.E14.T12 Compressed textures in exported models (added by the orchestrator)** · deps: T01 · spec: DESIGN 19.2 · files: `tools/blender/artlib/export.py`, `src/core/Engine.js` (loaders), `src/gameplay/modelLibrary.js` · done: the exporter writes KTX2 (Basis Universal: UASTC for normal maps, ETC1S for colour) through `KHR_texture_basisu`, with mipmaps; the client loads them through three's KTX2Loader with the transcoder served from `public/`; a 4k hero hull with three variants downloads under 110 MB (amended by the orchestrator from 60 MB after measuring: 106.7 MB with KTX2 and meshopt geometry; normal maps at UASTC quality dominate; see DECISIONS) and fits the GPU-memory budget the perf readout reports; the validator checks exported textures are compressed. Found when a 4k Lark with three variants exported at about 650 MB. · verify: `pnpm art:test`; a review capture of a hull at 4k loads and looks the same as the uncompressed export (pixel diff under 2% at 16/255); smoke.

### E15 Social
- [x] **P1.E15.T01 Chat and parties** · deps: E03.T02, E09.T02 · done: (server and protocol; the UI is T03) shard, system and party channels; invite, leave, leader; party members share quest phases. · verify: integration.
- [x] **P1.E15.T03 Chat and party UI** · deps: T01, E04.T01 · done: a chat panel (shard, system, party tabs; fades out of the way like the HUD's location line), a party frame with members' names, health and leader mark, invite/leave/promote from the frame and by `/invite`, `/leave`; rate-limited input with the server's refusals shown. (Added by the orchestrator: P1.E15.T01 is the server half and no task drew the UI.) Also the call-for-aid beacon list from P1.E15.T02 (list, answer with refusals shown, raise and lower; amended by the orchestrator). · verify: smoke with two clients chatting and partying; visual.
- [x] **P1.E15.T02 Call-for-aid beacon** · deps: T01 · spec: DESIGN 16.6 "Social" · done: a player in an instance with open slots broadcasts; others join from the beacon list. · verify: integration.
- [ ] **P1.E15.T04 Chat and party UI motion follow-ups** · deps: T03 · files: `packages/client/src/ui/social/*` · done: (added by the orchestrator from P1.E15.T03's fifth visual grade, merged under the owner's rule) an overflowing beacon list keeps its scrollbar thumb's opacity and its edge masks across redraws, so neither blinks (the thumb fades only when the list starts or stops overflowing), and the list redraws only when its rows change; a cleared unread badge fades its opacity to zero over the same 6 frames its slot collapses; the beacon scroll eases below 1 px a frame instead of crawling at a 1 px floor; the smallest caps tags (YOU, OFFLINE, LEAD, KICK, the ENTER SEND hint) gain contrast margin above 4.5:1; `party-invite` 21:9 retaken at rest; the UI's frame cost shown in a readout. · verify: smoke; visual (UI rubric) on the `beacons`, `beacons-many`, `social-tabs` and `party-invite` captures with a frame-time readout.

### E16 Vertical slice, performance and QA
- [ ] **P1.E16.T01 Bot framework** · deps: E04.T03 · files: `packages/tools/src/bots/*` · done: headless scripted clients (fly, land, walk, mine, fight, dock, accept quests) for e2e and load. · verify: `pnpm bots -- --count 10` runs 10 minutes without errors.
- [ ] **P1.E16.T02 Load test** · deps: T01, E08.T01 · done: 50 bots in one system with fauna and pirates active. · verify: p95 zone tick under 10 ms; report committed.
- [ ] **P1.E16.T03 Client performance pass** · deps: E10.T03, E05.T04 · done: 24 remote players plus a capital in view at 60 fps on the reference GPU; profiling notes in `docs/perf.md`. Includes remote-hull texture streaming (amended by the orchestrator from P1.E14.T12): remote ships load only lower mips of their KTX2 textures by screen size (512 px default, 1k past ~300 px, 2k past ~700 px; full 4k for the own ship and close views), one upload per hull and livery shared by every ship, under a global budget that evicts to the next level down. · verify: perf test in CI on a GPU runner or recorded locally with the report committed.
- [ ] **P1.E16.T04 End-to-end playthrough** · deps: E09.T08, E15.T01 · done: two-client automated Prologue + Act I with a party; manual QA checklist in `docs/qa-phase1.md`. · verify: `pnpm e2e -- phase1`.
- [~] **P1.E16.T06 Load-proof timing tests (added by the orchestrator)** · deps: none · files: `packages/server/test/movement.int.test.ts`, `packages/server/src/fauna/terrain.test.ts`, `packages/tools/src/smoke/movement-online.spec.ts`, `packages/server/bench/*` · done: tests that judge timing pass at any machine load: "snaps back a client that teleports and speeds" (fails most full runs at load 80+, its speed bound taken from a 50 ms wall-clock timer) and "never corrects a client flying out of the Waystation's sphere" in movement.int, "backs off a world whose plan throws" in fauna/terrain (a 2.5 s wall-clock loop), movement-online.spec.ts:116 ("flies on through page stalls", failed once at its 9 s stall) and :123 drive a fake or stepped clock, or assert on credited time rather than wall time, so they still fail when the rule they guard breaks; the server bench prints the load average beside its p95s and refuses to judge a budget above a stated load. · verify: each test passes 20 runs in a row while `pnpm test` runs in parallel twice; each fails when its rule is removed (show the mutation).
- [ ] **P1.E16.T05 Phase 1 exit review** · deps: all Phase 1 tasks · done: exit criteria checked one by one in `docs/PHASE-1-REPORT.md`; DESIGN.md updated for anything learned; tag `phase-1`. · verify: `pnpm gate:removed`, `pnpm test`, `pnpm test:int`, `pnpm smoke`, `pnpm e2e -- phase1`.

---

## Phase 2: the living world

**Exit criteria**
- PvP is live outside safe zones with patrols and bounties in lawful tiers; convoy runs and anchor control bars have NPC sides.
- Four factions and three cities carry rep with ranks and chains; trainers, hulls and markets gate on rank.
- Prices move per station; the player market and all three crafting lines work; the Scrapyard black market exists.
- World events (station raid, Hollow tide, superstorm rescue, convoy run) scale 1–12 and instance above 12.
- The Count meter runs on lean and burn; the Edge moves; tiers and dark stations follow it; seasons are four or eight weeks.
- Acts II and III complete, including the three memory worlds, the Descent, the three anchor chains and the Quiet Table.
- Skill web complete: Tier III, capstones, conjunctions. All hulls but the Husk; all eight weapons.
- Stone-touched, horrors, sentinels, the Hollow in space, convoys and raiders exist. Discovery naming and the codex are live.
- Load: 300 bots across ten systems; p95 tick under 10 ms per zone.

### E17 PvP and law
- [ ] **P2.E17.T01 PvP damage and flags** · deps: P1 exit · spec: DESIGN 11, 16.6 "PvP" · done: players damage players outside safe zones; safe zones block; kill events; killer and victim records. · verify: integration.
- [ ] **P2.E17.T02 Bounties and patrols** · deps: T01 · done: a kill in Tiers 0–2 posts a bounty (double if the victim is 10+ levels below) redeemable at Compact boards; Compact patrol ships respond to kills in lawful tiers and hunt the killer in-system for 10 minutes. · verify: integration.
- [ ] **P2.E17.T03 Cargo pod rules** · deps: P1.E06.T03 · done: pod loot by anyone after the owner lock; Recall Lattice extends the lock. · verify: integration.
- [ ] **P2.E17.T04 War zones** · deps: E28.T04 · done: war-zone volumes around the three anchors with no bounty and faction flagging. · verify: integration.

### E18 Factions and reputation
- [x] **P2.E18.T01 Rep model** · deps: P1.E03.T05 · spec: DESIGN 14.4 · done: per-faction rep 0–1000, ranks at 200/500/800, gains and losses from events, titles. · verify: unit and integration.
- [ ] **P2.E18.T02 Compact chain** · deps: T01, P1.E09.T01 · done: Hand, Factor, Lanewarden chains and unlocks (double bounties, Tier 2 hulls at Waystations, Hangar Rights, the Warden-breaker gate). · verify: e2e.
- [ ] **P2.E18.T03 Free Reaches chain** · deps: T01, P1.E11.T05 · done: Deckhand, Cutter, Captain's Ear; the Scrapyard market and Void quartermaster; the Void branch gate flips from a story flag to Reaches standing. · verify: e2e.
- [ ] **P2.E18.T04 Chorus chain** · deps: T01 · done: Listener, Reader, Voice; sanctuary at B/E stars built from the station kit variant; respec discount; Resonance Tier II–III. · verify: e2e.
- [ ] **P2.E18.T05 City chains** · deps: T01, P1.E10.T02 · done: Guest, Neighbour, Claimant for each capital; market fee halving; liveries; the Claimant glyph. · verify: e2e.
- [ ] **P2.E18.T06 Trainers on rank** · deps: T02–T05, P1.E07.T13 · done: every trainer gates on rank instead of story flags. · verify: integration.

### E19 Dynamic economy and the player market
- [ ] **P2.E19.T01 Economy service** · deps: P1.E13.T03 · spec: DESIGN 15.4 · done: per-station price state with tier, local supply (from the system's generated deposits and archetypes), sell pressure with decay, event factors, clamps; published to zones and clients. · verify: unit tests of the formula; integration: dumping lowers one station only.
- [ ] **P2.E19.T02 Shortages drive boards** · deps: T01, P1.E09.T06 · done: delivery jobs generated from shortages; reward = gap + fee. · verify: integration.
- [ ] **P2.E19.T03 Regional order books** · deps: T01 · spec: DESIGN 15.5 · done: buy and sell orders per system at Waystations and capitals, fees, expiry, Neighbour discount, size-scaled fees; the UI. · verify: integration; smoke.
- [ ] **P2.E19.T04 The Scrapyard market** · deps: T03, E18.T03 · done: black-market stock gated by Reaches rank, wide spreads, stolen convoy cargo listings. · verify: integration.
- [ ] **P2.E19.T05 Income tuning** · deps: T01, E21.T01 · spec: DESIGN 15.6 · done: bot-measured income per tier within the table's bands; ladder prices adjusted. · verify: `pnpm bots -- --economy` report.

### E20 Crafting
- [ ] **P2.E20.T01 Fabricator tiers and recipe items** · deps: P1.E13.T05 · spec: DESIGN 15.7 · done: station tiers gate recipes; recipes as items from vendors, chains, drops, vaults; learned forever. Also capital, sanctuary and Scrapyard fabricators, and a version guard so a rolled-back recipe table cannot drop learned recipes (amended by the orchestrator from P1.E13.T05). · verify: integration.
- [ ] **P2.E20.T02 Module recipes and salvage** · deps: T01, E24.T03 · done: all module recipes; hazard platings as modules; salvage to a third of materials. · verify: integration.
- [ ] **P2.E20.T03 Catalysts and cosmetics** · deps: T01 · done: sanctuary catalyst recipes with timed buffs; glyph cosmetics from Count residue with boss-drop patterns; liveries from city chains. · verify: integration; smoke.

### E21 World events
- [R] **P2.E21.T01 Event framework** · deps: P1.E09.T02 · spec: DESIGN 14.6, 16.6 · done: server-scheduled events with presence scaling 1–12, instancing above 12, contribution tracking, banner announcements, rewards. · verify: unit tests on scaling; integration with 1 and 15 bots.
- [ ] **P2.E21.T02 Station raid event** · deps: T01, P1.E11.T05 · done: the repeatable shared version of chapter 11. · verify: e2e.
- [ ] **P2.E21.T03 Hollow tide** · deps: T01, E25.T05 · done: twenty-minute waves from the Edge-ward side; stones turn herds stone-touched for the duration. · verify: e2e.
- [ ] **P2.E21.T04 Superstorm rescue** · deps: T01 · files: `src/render/Weather.js`, `src/Game.js` (lightning) · done: a downed pilot under the ceiling with a lightning countdown. · verify: e2e.
- [ ] **P2.E21.T05 Convoy run** · deps: T01, E25.T06 · done: scheduled Compact convoys with NPC escorts and NPC raiders; escort or raid; rep both ways; Passage convoys flagged for the meter. · verify: e2e both sides.

### E22 The Count meter and the Edge
- [x] **P2.E22.T01 Lean and burn** · deps: P1.E03.T06 · spec: DESIGN 16.2 · done: counted actions tagged Feed/Break, one vote per account per action type per day, daily lean, target, drift up to 25/day, burn 5/day, underdog bonus. · verify: unit tests with synthetic action logs at 3 and 3,000 accounts give the same drift for the same lean.
- [ ] **P2.E22.T02 The Edge moves** · deps: T01, P1.E02.T06 · files: `src/ui/map/EdgeOfSpace.js`, `src/universe/Cosmos.js` (`edgeX`) · done: Edge position and system tiers as functions of the meter; dark stations flagged; the galaxy map and sky show the current Edge. · verify: unit tests; smoke at three meter values.
- [R] **P2.E22.T03 Seasons** · deps: T01 · spec: DESIGN 16.4 · done: season start at 500, length 4 or 8 weeks from daily actives, end-of-season bucket, next-season map state, titles and glyphs for the leading philosophy, the chronicle record. · verify: integration with an accelerated clock.
- [ ] **P2.E22.T04 Where players see it** · deps: T02 · done: the sanctuary glyph wall, Edge Sense HUD readout, weekly server message, per-account measures in the chronicle. · verify: smoke.

### E23 Skill web completion
- [ ] **P2.E23.T01 Tier III for all seven branches** · deps: P1.E07.T12 · spec: DESIGN 9.2–9.8 · done: every Tier III active, passive, ship form and augment. · verify: per-node tests.
- [ ] **P2.E23.T02 Capstones** · deps: T01, E27.T01, E28.T02 · done: Singularity, Corona, Nullsong, Symbiosis, Unremembered, Ace, Second Skin, unlocked by their chapters. · verify: per-node tests; chapter gate tests.
- [ ] **P2.E23.T03 Conjunctions** · deps: T01 · spec: DESIGN 9.9 · done: six conjunction nodes with their discovery unlocks. · verify: per-node tests.
- [ ] **P2.E23.T04 PvP tuning pass** · deps: T01–T03, E17.T01 · done: Dissonance, Null, Nullsong, Veil/Cloak, Drain, Anchor balanced against bot duels; heat glow readable on remote players. · verify: `pnpm bots -- --duels` report.
- [ ] **P2.E23.T05 (art) Tier III and capstone effects** · deps: P1.E07.T14 · done: effect sets for Tier III and capstones. → `[R]`

### E24 Hulls Tier 2–3 and weapons
- [ ] **P2.E24.T01 (art) Dart, Wayfarer, Bulwark, Caravel** · deps: P1.E12.T02 · done: four Tier 2 hulls complete per 10.4. → `[R]`
- [ ] **P2.E24.T02 (art) Ghost, Listener, Warden-breaker, Longhaul** · deps: T01 · done: four Tier 3 hulls complete; built-in Cloak and Deep Sweep hooks. → `[R]`
- [ ] **P2.E24.T03 (art) Weapon modules** · deps: P1.E12.T02 · done: Tractor Mount, Beam Lance, Flak Cannon, EMP Pod, Railgun, Torpedo Rack as mountable meshes with effects. → `[R]`
- [ ] **P2.E24.T04 Weapons implementation** · deps: T03, P1.E12.T04 · done: all six remaining weapons with ammo and Charge costs; Gunnery and Thermal scaling applied. · verify: integration per weapon.
- [ ] **P2.E24.T05 Hull stock and faction gates** · deps: T01, T02, E18.T01 · done: Tier 2 at capitals by people's yard; Tier 3 by faction rank; built-in abilities for Ghost and Listener. · verify: integration.

### E25 Mobs, Phase 2 set
- [ ] **P2.E25.T01 Stone-touched herds and the Herd Mother** · deps: P1.E08.T01 · spec: DESIGN 12.3, 13 · done: herds within 500 m of fed stones at Tier 3+ turn stone-touched (glow channel, no fear, mind-seeking); Count residue drops; the Herd Mother boss with the draw mechanic. · verify: e2e.
- [ ] **P2.E25.T02 Lifeless-world horrors** · deps: P1.E08.T02, E31.T02 · spec: DESIGN 12.4 · done: shamblers, crystal stalkers, acid swimmers, murk-things, cinder wings with hazard immunity and their behaviours. · verify: integration per horror.
- [ ] **P2.E25.T03 Monolith sentinels** · deps: P1.E08.T01, E31.T02 · done: three rise on Attune, tide touch or memory taking; gravity-immune; Dissonance stall. · verify: integration.
- [ ] **P2.E25.T04 Pirate raiders and the Bulwark wing** · deps: E24.T01, P1.E08.T05 · done: wings add the Bulwark; raiders (2 Ghosts) cloak and strike haulers. · verify: integration.
- [ ] **P2.E25.T05 The Hollow in space** · deps: P1.E12.T03 · spec: DESIGN 12.7 · done: drifters (husked hulls on old courses), swarms (latch, eat shield; Flak counter), husks (ram, heavy); husked material variant. · verify: integration per grade.
- [ ] **P2.E25.T06 Convoys and traffic schedules** · deps: P1.E12.T03 · done: Compact convoy routes between stations with escorts; schedule service. · verify: integration.
- [ ] **P2.E25.T07 Quiet Table agents and crews** · deps: P1.E05.T04 · done: agents with Resonance/Gravitic builds that Recall when beaten; crews use the full Tier I–II web. · verify: integration.
- [ ] **P2.E25.T08 Belt lurkers and ring grazers** · deps: P1.E12.T06 · done: lurkers drain Charge from asteroid cover; grazers in rings analysable with Deep Sweep. · verify: integration.

### E26 Bosses, Phase 2 set
- [ ] **P2.E26.T01 Sentinel Primes** · deps: E25.T03 · spec: DESIGN 13 · done: three dungeon bosses with hazard arenas (heat, acid pools, static) and the memory take. · verify: e2e each.
- [ ] **P2.E26.T02 The Dreadnought** · deps: E24.T02, E25.T05 · done: fighter screen, wing generators, torpedo volleys, exposed core, ram; fought beside the NPC Reaches fleet scaled inversely to players. · verify: e2e with 1 and 8 bots.
- [ ] **P2.E26.T03 The Descent and the Patient** · deps: E25.T02, E31.T03 · done: the crushing-world raid: pressure descent, murk-things, brood, the conversation phases with copy attempts countered by Veil/Nullsong; no kill. · verify: e2e.

### E27 Act II content
- [ ] **P2.E27.T01 Chapters 13–18** · deps: E26.T01–T03, E18.T03, P1.E09.T04 · spec: DESIGN 8 · done: Reading the Number, The Burned Road (fork), The Dark Systems (a dark system with a dead Waystation and Hollow), The Dreadnought, What the Number Says, Descent; the three Cartographer memory cutscenes and the survivors' sky cutscene. · verify: `pnpm e2e -- act2`.
- [ ] **P2.E27.T02 (art) Act II cutscene cameras and sets** · deps: P1.E09.T10 · done: camera paths and set dressing for Act II cutscenes. → `[R]`

### E28 Act III content and anchors
- [ ] **P2.E28.T01 Chapter 19, The Quiet Table** · deps: E27.T01, E25.T07, E18.T02 · done: exposure or joining; the faction choice; PvP faction flag. · verify: e2e both branches.
- [ ] **P2.E28.T02 Chapter 20, The Settled Rise** · deps: T01, E18.T05 · done: three city chains with the player's home chain longest; the Claimants naming scene. · verify: e2e per people.
- [ ] **P2.E28.T03 Chapter 21, the first Warden (instanced)** · deps: P3.E33.T02 (the Warden fight is built in Phase 3's raid epic; chapter 21 uses its instanced, party-scaled version) · done: the chapter wires the instanced Warden. · verify: e2e. *(This task waits on P3.E33.T02; mark `[!] waiting on P3.E33.T02` rather than blocking Phase 2 exit; Phase 2 exit accepts this single carry-over.)*
- [ ] **P2.E28.T04 Chapter 22 and the three anchor chains** · deps: T02 · spec: DESIGN 5.2–5.4 · done: The Tide Comes In (defence across three tides), The Memory Dive (playable fragments), The Root Network (descent); anchor control bars with NPC attackers and defenders; weekly tick into the meter. · verify: e2e per chain; control-bar integration.
- [ ] **P2.E28.T05 (art) Act III cutscene cameras and sets** · deps: E27.T02 · done: cameras and dressing. → `[R]`

### E29 Discovery and the codex
- [~] **P2.E29.T01 First-finder naming** · deps: P1.E08.T04 · spec: DESIGN 14.5 · done: first analysis, landing or site visit names it server-wide with a moderation filter; procedural names as fallback; codex plates. · verify: integration with two clients racing.
- [ ] **P2.E29.T02 Surveys and ship discovery** · deps: T01, E25.T08 · done: full-survey completion grants XP and a fragment; Deep Sweep analysis of grazers. · verify: integration.
- [ ] **P2.E29.T03 Codex UI** · deps: T01 · done: species, worlds, sites, lore, Hollow sightings; Bond eligibility shown. · verify: smoke.

### E30 Mysteries
- [ ] **P2.E30.T01 Forty Names complete** · deps: P1.E09.T09, E27.T01 · done: all forty logs placed across Tiers 1–4, the twenty and forty beats, the wiped-log cutscene, the Unlisted title. · verify: e2e.
- [ ] **P2.E30.T02 Glyph stones, triangulation vaults, crash-log courses, the Quartermaster's debt** · deps: T01 · done: puzzle stones with two fragments; beacon networks revealing vaults with unique modules; ten-log courses to a drifter origin; the debt chain's ending. · verify: e2e each.

### E31 Art, Phase 2
- [ ] **P2.E31.T01 (art) Stone-touched overlays and horrors** · deps: P1.E08.T08 · done: glyph overlays for every body plan; five horrors. → `[R]`
- [ ] **P2.E31.T02 (art) Sentinels, drones, sentinel ship, crews and agents** · deps: P1.E05.T01 · done: monolith sentinel, Sentinel Primes (3), sentinel ship; three crew armour sets per people; Quiet Table agent dress. → `[R]`
- [ ] **P2.E31.T03 (art) The Patient, murk-things, brood** · deps: T01 · done: the Patient as a hero asset with the murk shader; brood creatures. → `[R]`
- [ ] **P2.E31.T04 (art) Sanctuary and dark-station variants** · deps: P1.E11.T01 · done: the Chorus sanctuary kit variant; the dead Waystation dressing for dark systems. → `[R]`
- [ ] **P2.E31.T05 (art) Civilised-world city kits** · deps: P1.E10.T05–T07 · done: smaller city variants of the three kits for the Settled's other worlds. → `[R]`
- [ ] **P2.E31.T06 (art) Cosmetics set 1** · deps: E20.T03 · done: suit and hull glyph patterns, city liveries. → `[R]`

### E32 Scale and QA, Phase 2
- [ ] **P2.E32.T01 Multi-zone load** · deps: E21.T01 · done: 300 bots across ten systems with events running. · verify: p95 tick under 10 ms per zone; report.
- [ ] **P2.E32.T02 Economy soak** · deps: E19.T05 · done: a 48-hour bot economy soak shows prices within clamps and no runaway inflation. · verify: report.
- [ ] **P2.E32.T03 Full Acts I–III playthrough** · deps: E28.T04, E30.T02 · verify: `pnpm e2e -- phase2`.
- [ ] **P2.E32.T04 Phase 2 exit review** · deps: all Phase 2 tasks · done: `docs/PHASE-2-REPORT.md`; tag `phase-2`.

---

## Phase 3: seasons and scale

**Exit criteria**
- Wardens and the Hive Heart run as raids with persistent progress and weekly resets; Act IV and the Reckoning are live; seasons roll with drift content and the chronicle.
- The Husk hull, the Husk Admiral and the Brood Mother rotations, depth leviathans and the full cosmetics set exist.
- Hangar bays and capital phasing hold 3,000 bots in one home system; shards merge; production deployment with monitoring, backups and rollbacks.
- Launch QA complete.

### E33 Raids and persistent objectives
- [ ] **P3.E33.T01 Persistent objective state** · deps: P2 exit · spec: DESIGN 16.6 "Raids and bosses" · done: boss shells and defences persist damage between attempts with weekly reset; NPC role fill when a required role is absent; respawn cadence from clear rate. · verify: integration across simulated days.
- [ ] **P3.E33.T02 The Wardens** · deps: T01, E39.T01 · spec: DESIGN 13 · done: Tide, Spire and Root Wardens plus lesser Wardens: rise, gravity pulses, the glyph count copy attempt every 30 s, sentinel waves, the open shell; instanced party version for chapter 21. · verify: e2e with 3 and 12 bots over multiple attempts; P2.E28.T03 unblocked.
- [ ] **P3.E33.T03 The Hollow Hive Heart** · deps: T01, E39.T02 · done: space approach, boarding of the husked station, husked crews, the wired monolith; Husk hull core drop. · verify: e2e.

### E34 Act IV and the Reckoning
- [ ] **P3.E34.T01 Chapter 23, The Long Flight** · deps: P2.E22.T02 · spec: DESIGN 8 · done: warp disabled near the wall; the cruise set piece with tides and both NPC fleets. · verify: e2e.
- [ ] **P3.E34.T02 Chapters 24–26** · deps: T01 · done: At the Wall cutscene, the three choices with epilogues and alignment, the endgame unlock. · verify: e2e each ending.
- [ ] **P3.E34.T03 The Reckoning** · deps: T02, P2.E22.T03 · done: final-week event at the wall in 1–12 instances, NPC fleets always fighting, choices counted as lean, season bucket decided. · verify: integration with an accelerated season.
- [ ] **P3.E34.T04 (art) Act IV cameras, the wall, the three endings** · deps: P2.E28.T05 · done: cameras, the Edge wall set, three ending sequences. → `[R]`

### E35 Seasons and drift content
- [ ] **P3.E35.T01 Drift content** · deps: P2.E22.T03 · spec: DESIGN 14.5 · done: server-seeded belts, vaults and dens added each season as the Edge moves; first-finder naming on them. · verify: integration across two simulated seasons.
- [ ] **P3.E35.T02 Season transitions** · deps: T01 · done: next-season opening map (Edge, dark systems, tiers), titles and glyphs awarded, the chronicle published. · verify: integration.
- [ ] **P3.E35.T03 The chronicle** · deps: T02 · done: a per-season record of the world's events, names and each account's measures, readable in-game and exported. · verify: smoke; integration.

### E36 Endgame rotations and cosmetics
- [ ] **P3.E36.T01 Husk Admiral and Brood Mother** · deps: E33.T01, E39.T03 · done: the two rotating endgame bosses with their mechanics. · verify: e2e.
- [ ] **P3.E36.T02 The Husk hull** · deps: E33.T03, P2.E20.T02 · done: assembled at the Scrapyard from the core, husk alloy and glyphstone; its odd stats and Hollow signature. · verify: integration.
- [ ] **P3.E36.T03 Depth leviathans and Edge expeditions** · deps: P2.E25.T08 · done: leviathans below gas-giant ceilings, scannable; Edge expedition events at Tier 5. · verify: e2e.
- [ ] **P3.E36.T04 (art) Cosmetics set 2, Husk hull, leviathan** · deps: P2.E31.T06 · done: boss-pattern glyphs, season glyphs, the Husk, the leviathan. → `[R]`

### E37 Scale and phasing
- [ ] **P3.E37.T01 Hangar bays at scale** · deps: P1.E11.T03 · done: unlimited bay phases per station; bay assignment under load. · verify: 500 bots dock at one station.
- [ ] **P3.E37.T02 Capital and starter phasing** · deps: P1.E10.T02 · spec: DESIGN 16.6 "Hubs", "Starter flow" · done: plaza and market phase above 200 present; starter regions phase above 60; phases merge as players leave. · verify: 3,000 bots in one home system; p95 tick under 10 ms per zone process.
- [ ] **P3.E37.T03 Zone processes and sleeping zones** · deps: T02 · spec: DESIGN 17 · done: zones split across processes; empty zones sleep with coarse NPC simulation in the world service and resume in detail on arrival. · verify: integration; load report.
- [ ] **P3.E37.T04 Shard merging** · deps: T03 · done: one shard per region until overflow; merge path for characters, discoveries and the meter. · verify: integration merges two test shards.

### E38 Operations and deployment
- [ ] **P3.E38.T01 Infrastructure as code** · deps: P2 exit · spec: 0.6 · files: `infra/` · done: AWS stack (ECS Fargate for gateway, world and economy; EC2 autoscaling for zone hosts; RDS Postgres with backups; ElastiCache Redis; S3 + CloudFront for the client) as CDK. · verify: `cdk synth` and a deploy to a staging account.
- [ ] **P3.E38.T02 Observability** · deps: T01 · done: metrics per zone (tick, entities, players), logs, traces, alerts on tick p95, error rates and meter anomalies; dashboards. · verify: alerts fire in a staged failure.
- [ ] **P3.E38.T03 Release pipeline** · deps: T01 · done: CI builds, staging deploy, smoke and e2e against staging, production deploy with rollback; client cache busting. · verify: a tagged release reaches staging automatically.
- [ ] **P3.E38.T04 Backups, migrations and incident runbook** · deps: T01 · done: nightly backups with restore drill, zero-downtime migrations, `docs/runbook.md`. · verify: restore drill documented with timings.

### E39 Art, Phase 3
- [ ] **P3.E39.T01 (art) Wardens** · deps: P2.E31.T02 · done: Tide, Spire and Root Wardens and the lesser Warden as hero assets with phase states. → `[R]`
- [ ] **P3.E39.T02 (art) The Hive** · deps: P2.E31.T04 · done: the husked Waystation Hive kit, the Heart, husked crews. → `[R]`
- [ ] **P3.E39.T03 (art) Husk Admiral, Brood Mother, brood nest** · deps: T01 · done: the hollowed dreadnought dressing, the Brood Mother, the nest set. → `[R]`

### E40 Launch QA
- [ ] **P3.E40.T01 Full game playthrough** · deps: E34.T02, E36.T01 · verify: `pnpm e2e -- full` (Prologue through all three endings with a party of two).
- [ ] **P3.E40.T02 Scale rehearsal** · deps: E37.T04, E38.T03 · done: 3,000 bots on staging for 24 hours with events, raids and a season rollover. · verify: report; no p95 regressions.
- [ ] **P3.E40.T03 Security review** · deps: E38.T01 · done: authority audit (every mutation server-side), rate limits, input validation fuzzing, dependency audit. · verify: `docs/security-review.md` with findings closed.
- [ ] **P3.E40.T04 Phase 3 exit review and launch readiness** · deps: all Phase 3 tasks · done: `docs/PHASE-3-REPORT.md`; tag `phase-3`.

---

## Appendix A: task count
Phase 1: 109 tasks (16 art). Phase 2: 70 tasks (12 art). Phase 3: 29 tasks (5 art). Total 208. (Counted by `grep -c '^- \[ \] \*\*P1\.' docs/IMPLEMENTATION_PLAN.md` and so on; the loop should recount rather than trust this line.)

## Appendix B: the first batches the orchestrator will dispatch
Batch 1 (serial, one worker: everything depends on it): P1.E01.T01.
Batch 2 (parallel): P1.E01.T02, P1.E01.T04, P1.E01.T06.
Batch 3 (parallel): P1.E01.T03, P1.E01.T07, P1.E02.T01 (after T02), P1.E14.T01 (art track opens).
Batch 4 (parallel): P1.E01.T05, P1.E02.T02, P1.E02.T05, P1.E02.T07, P1.E14.T02, then P1.E14.T03 and the grader calibration P1.E14.T09 before any art task is graded.
From batch 5 the art track stays full: P1.E05.T01 (bodies) and P1.E14.T04 (trees) go to the two art workers while code workers take E02.T03, E02.T04, E02.T06, E02.T08.

## Appendix C: briefing and report templates

### C.1 Worker brief (code or art)
```
You are implementing one task of docs/IMPLEMENTATION_PLAN.md in the worktree at <path> on branch task/<id>.

TASK (verbatim):
<the task line, including deps, spec, files, done, verify>

SPEC: read these sections of docs/DESIGN.md before anything else: <section numbers>.
RULES: docs/IMPLEMENTATION_PLAN.md section 0.3 (and 0.4 if this is an art task). Read them.
FILES: read every file listed in the task in full before editing. Do not edit files outside this list; if you must, stop and report why.
VERIFY: run every command listed under verify from the repo root in your worktree. All must pass.
<if visual> GRADING: this task is visual (0.10). Produce the grader's artifacts listed in 0.10.3 and put their paths in your report.
<if revise round> REVISE NOTES from the grader (fix exactly these, then resubmit):
<notes>
Report in the format of Appendix C.2. Commit to your branch with message "<id>: <title>". Do not edit docs/IMPLEMENTATION_PLAN.md, PROGRESS.md or DECISIONS.md.
```

### C.2 Worker report
```
TASK: <id>
STATUS: DONE | FAILED | BLOCKED
SUMMARY: <one paragraph, what was built and how>
FILES CHANGED: <list>
VERIFY: <each command and its result, with the last 20 lines of any failure>
DECISIONS: <any spec interpretation, as "question → choice → why">
OUT OF SCOPE FOUND: <anything noticed that belongs to another task, with the task id if known>
ARTIFACTS: <paths to renders, captures, reports; required for visual tasks>
```

### C.3 Grader brief (visual)
```
You are grading one visual deliverable against docs/IMPLEMENTATION_PLAN.md section 0.10 and docs/DESIGN.md 19.2. You have not seen how it was made and you must not ask. You may not edit anything.
TASK (verbatim): <task line>
SPEC: <DESIGN.md sections>
ART BIBLE: docs/art-bible.md
ARTIFACTS: <paths>
Score every criterion of the relevant rubric 1–5. PASS only if every criterion is 4 or above and the mean is 4.5 or above. For each failing criterion write one concrete, actionable note. Respond in the verdict format of 0.10.4 and nothing else.
```

### C.4 Code reviewer brief
```
You are reviewing the diff for one task against docs/IMPLEMENTATION_PLAN.md 0.3 and 0.9.5. You may not edit anything.
TASK (verbatim): <task line>
DIFF: <path or inline>
Return PASS or REVISE. REVISE is mandatory for the five conditions in 0.9.5; list each finding with file:line and the rule it breaks. Style findings go under ADVISORY and never block.
```
