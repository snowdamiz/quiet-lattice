# Architecture: server, protocol and client networking

How the online game is put together. DESIGN 17 is the sketch; this file fixes the conventions the Phase 1 server and
networking tasks (P1.E02.T08, E03, E04, E06–E09) build on, so no task re-decides them. Where a task finds a convention
wrong, it changes this file in the same commit and logs the change in DECISIONS.md.

## 1. Packages and processes

| Package | Runs in | Owns |
|---|---|---|
| `@astra/shared` | Node and the browser | deterministic world (`/world`), data tables (`/data`), protocol schemas and codecs (`/protocol`), combat math, quests (`/quests`, §17), the codex (`/codex`, §22), reputation (`/reputation`, §24), first finds and the name filter (`/discovery`, §25), glyphs (`/art`) |
| `@astra/server` | Node 22 under tsx | the gateway, zones, the world service, persistence |
| `@astra/client` | the browser | rendering, input, prediction, UI |
| `@astra/tools` | Node, Blender | gates, bots, smoke/e2e, capture, art export |

One server process in Phase 1 hosts the gateway, every zone and the world service; the code keeps them behind interfaces so
P3.E37 can split them across processes. Shared state that must survive a restart lives in Postgres; hot state that other
processes will read (presence, zone membership, the server clock) is mirrored to Redis.

## 2. Server layout (`packages/server/src`)

```
index.ts            boot: config → db → redis → world service → zone manager → quest runtime → character persistence → gateway → tooling
config.ts           env (DATABASE_URL, REDIS_URL, JWT_SECRET, PORT=8787, TICK_HZ=20), validated with zod
db/                 Drizzle schema (schema.ts), client, migrate.ts; SQL migrations in packages/server/drizzle/
gateway/http.ts     HTTP: POST /auth/register, POST /auth/login, GET /health, GET/POST /characters
gateway/devLogin.ts POST /auth/dev, the dev-only login bypass (§16)
gateway/ws.ts       WebSocket upgrade (token in the first message), one Session per socket
session/            Session: the account, the character in play, the zone it is in, its outbound queue
zones/              Zone (one star system), ZoneManager, spatial hash, interest sets, snapshot encoder
phases/             PhaseManager (one per zone): private layers at shared places, their caps and visibility rule
social/             SocialService: chat channels, parties and invites, and their limits (§13); call-for-aid beacons (§21)
cutscenes/          CutsceneService: cutscenes played in story phases, their catalog and actors (§15)
world/              WorldService: server clock, season, Count, Edge position, tier map
count/              the Count meter (§11): lean, target, drift, burn and underdog arithmetic; the day ledger; its store
fauna/              herds in cells round players on a world's surface, their AI, creatures as zone entities (§6.2)
resources/          ResourceService: mining hits, resource nodes' shared state per cell, what each player is sent (§18)
combat/             each zone's health, damage path, deaths and combat events; CombatService: shots, kills' rewards (§20)
persistence/        character state: the component registry, Phase 1's components, the save queue and its store (§8)
skills/             SkillService: each character's place on the skill web, its requests, and its persistence component (§14)
quests/             QuestRuntime: every character in play's quests, moved by world events, rewards, quest phases (§17)
codex/              AnalysisService and CodexService: analyses checked, each character's codex and its component (§22)
crafting/           CraftingService and RecipeBook: fabricator requests checked, each character's recipes and its component (§23)
discovery/          DiscoveryService: first finds seen, claimed, paid and named, and the shard's store; codex plates' component (§25)
reputation/         ReputationService: each character's standing by faction, ranks and titles, its component, the quest hooks (§24)
sim/                server-side systems added by later tasks: movement validation, combat…
admin/              developer tooling (§16): its ASTRA_* config, the admin commands and service, the loopback admin channel
cli/                the developer CLI (`pnpm --filter @astra/server cli -- <command>`): over the admin channel, or --direct
```

Libraries: `fastify` for HTTP, `ws` for sockets (attached to Fastify's server in `noServer` mode), `drizzle-orm` with
`postgres` (postgres.js), `ioredis`, `@node-rs/argon2` for password hashes (argon2id, prebuilt binaries, no native build),
`jose` for JWTs (HS256, 7-day session tokens), `@msgpack/msgpack` for binary snapshots, `zod` for every message.

## 3. Time

The server owns the clock. World time `t` is seconds since the shard's epoch (stored in Postgres, so it survives restarts).
Every body pose comes from `t` (`bodyPose(spec, t)` in shared, P1.E02.T03), so client and server agree on where every planet
and station is without streaming them. The client keeps `game.time = serverTime + offset`, estimating the offset from the
`welcome` message and periodic `ping`/`pong` round trips (half the round trip), and slews it rather than jumping. The
server pushes no periodic time of its own: a pong is the better sample because the client can halve its round trip, and
`world` carries a `serverTime` too.

The shard's row (`shards`, created on the shard's first boot) holds its epoch (2026-01-01Z for a new shard), its season
(number, start in world time, length; DESIGN 16.4) and `last_time`, the latest world time its server saved (every minute and
on shutdown). At boot the world service (`world/service.ts`) starts the clock at the wall time since the epoch, but never
below `last_time` nor below the time of any stored Count-meter vote not yet rolled (§11; a vote can land after the last
time save), and advances it with the monotonic clock; so `t` carries on across a restart and never steps backwards, even
when the host's wall clock has. The world service mirrors its state to Redis under `astra:shard:<id>:world` (JSON,
with a clock sync point `{time, at}`: world time `time` at wall time `at` ms) for the processes P3.E37 splits off.

## 4. Frames of reference on the wire

An entity's pose travels as `(frame, pos, quat, vel)` where `frame` is a **frame id**: a string naming the body in its system,
`"<systemSeed>:<bodyIndex>"` for planets and moons as `describeSystem` orders them, `"<systemSeed>:station"` for the
Waystation, or `null` for the system's inertial frame. Positions are float64 metres in the frame's local (rotating)
coordinates, exactly like the client's `FrameState`. The server changes an entity's frame with the same rule as
`FrameState.setFrame` (DESIGN 20.1 keeps frames of reference), so a pose re-expressed across a frame change keeps its world
position (P1.E03.T03 tests this to 1 cm).

Which frame an entity belongs in is one rule, `selectFrame` in `@astra/shared/world` (`frames.ts`), which the client's
`Game.chooseFrame` and the server's zones both call: inside the Waystation's sphere of influence, the Waystation's frame;
else the planet or moon with the smallest sphere that holds it; else the inertial frame. An entity stays in its frame until
it is 5% beyond that frame's sphere (`FRAME_HYSTERESIS`), unless a smaller sphere inside it holds the entity (the
Waystation's in its world's, a moon's in its planet's). Every tick a zone takes each entity's world position at the tick's
time, picks its frame by this rule and, when it changed, re-expresses its pose with `setFrame` (velocity turned, never
boosted), so its next snapshot carries the new frame id. A client sending its pose in the frame it picked by the same rule
is never re-expressed but at the edge of a sphere, where its clock and the tick's differ. `frames.ts` also converts between
wire poses and the kinematics' shapes (`frameKeyOf`/`frameIdOf`, `framePose`, `reframe`, `settleFrame`, `localPoseInto`/
`framedPose` for the client's `FrameState`).

## 5. Protocol (`@astra/shared/protocol`)

- **Control messages are JSON**, one object per WebSocket text frame, shaped `{ "t": "<type>", ... }` and validated with a
  zod discriminated union on both ends. Decoding never throws: unknown or invalid messages are dropped and counted.
  Encoding validates and throws `InvalidMessageError`, so a NaN or out-of-range field fails at the sender instead of
  arriving as `null`.
- **Client → server schemas are the trust boundary:** every string has a length cap (ids 64, tokens 4096, chat 280 without
  control or bidi-override characters), positions and velocities are finite and bounded, quaternions must be unit length,
  directions non-zero, frame ids `\d{1,10}:(\d{1,3}|station)`, the button mask 8 bits.
- **Snapshots are binary**: a WebSocket binary frame whose first byte is the message kind and whose rest is msgpack
  (float64 numbers). Kind `1` is a zone snapshot `{ tick, time, ack, full, base?, entities, removed }`. A delta names its
  baseline `base`, the tick of the snapshot the client last acknowledged; the client keeps the states it was sent per tick,
  applies the delta onto `base` and stores the result as `tick`. An entity delta carries its changed fields and `clear`, the
  fields it no longer has. `ack` echoes the client's last applied input `seq` for reconciliation; clients number inputs
  from 1, so `ack` 0 means no input applied yet. The client acknowledges the newest snapshot it has applied with
  `ack {tick}`, at most every 50 ms (a backlog after a stall is acknowledged once); the server diffs against the latest
  acknowledged tick it still holds (64 ticks, about 3 s) and sends a full snapshot when it holds none. The server diffs against the state it last *sent*, not its true state, so
  slow motion under the epsilon still goes out. The encoder sends only the listed fields, validates each against its
  schema, clamps unit fields, and drops and reports any field that fails, so a client never rejects what the server sent. The decoder still drops a malformed entity on its own; a client that sees
  one must not store or acknowledge that tick. Control-message encoders send the validated copy, so keys a schema does
  not define (server-only state on a wider object) never leave the server.
- **Versioning:** `PROTOCOL_VERSION` in shared; the client sends it in `hello`, whose shape is frozen across versions;
  the server reads it with `peekVersion` before full validation and refuses a mismatch with `refused {code: 'version'}`.
  A branch that changes a message takes the next number and adds its line to the history under the constant (1 the
  first protocol, 2 inventory, 3 social, 4 creatures, 5 skills, 6 cutscenes, 7 quests, 8 mining, 9 meters, 10 combat,
  11 beacons, 12 analysis, 13 crafting, 14 reputation, 15 first finders); a unit test pins the number and checks the
  history, so two branches bumping to the same number conflict at merge rather than share it.
- **Client → server:** `hello {version, token}`, `join {characterId}`, `input {seq, time, mode, pose: {frame, pos, quat,
  vel}, buttons, aim?}` at 20 Hz (`time`, because `t` is the type tag, is the client's estimate of server time when it
  sampled the pose: movement authority judges the pose and its speed at that time, crediting no more of it than really
  passed, §7, so the client must stamp it and step it forward, never back, when it falls more than a second behind; an
  input without one, 0, is judged on its arrival; `mode` is a prediction validated like the pose; `seq` counts from 1),
  `cast {seq, slot, aim, target?}`, `interact {target}`, `chat {channel, text}`, `party {op}` (§13), `ack {tick}` (only
  for the newest applied tick, at most every 50 ms, so a backlog is acknowledged once), `ping {id, clientTime}`,
  `inventory {seq, op}`, `skills {seq, op}`, `cutscene {op, id, skipped?}` (§15), `quest {seq, op}` (§17), `mine {seq,
  frame, node | flora, tool, time}` (§18), `fire {seq, time, frame, aim}` (§20), `beacon {op}` (§21), `analyze {seq,
  time, target}` (§22), `craft {seq, op}` (§23), `name {kind, key, name}` (§25). Each socket's message budget is 60 a second with a burst of 120: input
  and acks take 40, leaving room for pings, casts, interactions, chat, party, inventory, skill, cutscene, quest and
  beacon requests, mining hits (an honest client sends 4 a second, and 8 is the most a character may), shots (the base
  gun's 8 a second at most, never while mining), analyses, fabricator and name requests, and the burst absorbs the
  backlog of a stall. Chat, invites, raising beacons, mining hits, shots, analyses, fabricator and name requests have
  smaller limits of their own (§13, §18, §20, §21, §22, §23, §25).
- **Server → client:** `welcome {accountId, character, entityId, serverTime, zone, pose, mode}`, `refused {code, reason}`,
  `correction {seq, pose, mode}`, `zone {zone, pose}` (handoff), `event {event}` with kinds `combat`, `quest`, `chat`,
  `loot`, `xp` (§20), `notice` (toasts), `party` (party news), `rank` and `title` (§24), `world {season, count, edgeX, tiers, serverTime}` (sent right after
  `welcome` and to every joined session whenever the world service's state changes; `tiers` is each galaxy system's tier
  by index), `pong`, `inventory {seq, inventory, error?}`, `skills {seq, skills, error?}` (§14), `party {party}` (the
  character's party, or null, §13), `denied {of, code, retryS?, name?}` (a chat message, party request or beacon request
  not carried out, to its sender only, §13, §21), `cutscene {op, id, phase, reason?}` (§15), `quests {seq, quests,
  error?}` (§17), `mine {seq, frame, node | flora, result, hp?, reason?, item?, count?, added?}` and `nodes {frame,
  reset?, cells}` (§18), `fire {seq, result, target?, reason?}` (§20), `beacons {reset?, beacons, gone}` and `beacon {op,
  id, beacon? | name? | phase? | why?}` (§21), `analyze {seq, target, result, reason?, species?, xp?}` (§22), `craft
  {seq, op, recipe, result, item?, count?, reason?}` and `recipes {known}` (§23), `reputation {reputation}` (§24),
  `discoveries {system, reset?, entries}` and `named {kind, key, result, name?, reason?}` (§25), and snapshots.
- **Inventory** (`@astra/shared/inventory`, protocol 2): the value is `{stackMax, units, suit, pods}`, the suit's slots and
  each cargo pod's slots holding `{item, count}` stacks or null; only resources, items and units, never fragments, skill
  points or reputation (the schema is strict). A client asks only for stack moves: `op` is `move {from, to, count?}`,
  `split {from, count, to?}`, `merge {from, to}`, `transfer {from, count?}` (across to the other side) or `compact {c}`,
  with slots `{c: 'suit', i}` or `{c: 'pod', p, i}` bounded to 64 suit slots, 32 pods and 64 slots a pod. `seq` counts the
  session's requests from 1 and must increase. The client applies the same shared op at once to predict; the server
  applies it through the inventory service and answers every request with `inventory` state, where `seq` is the last
  request it handled this session and `error` the code it refused that one with (`stale_seq` for a replayed number).
  The server also sends the state after `welcome` (`seq` 0) and pushes it whenever server-side systems change it (loot,
  mining, trade, the Recall's cargo drop); the client keeps its unanswered requests and replays those above `seq` on
  top, drops any left unanswered for 5 s (the gateway drops an over-budget message without a reply), never sends an op
  that fails the schema, and starts over (no pending requests, `seq` from 1) on the state sent after `welcome`. The pods
  are the ship's: one per pod its `ShipLoadout` carries, checked against the bays `shipStats` gives (P1.E12.T01).
  Adding, taking and units are never requests. `inventory`, `party` and `cutscene` are the types both directions use;
  `encodeMessage` picks the union whose schema accepts the message.
- **Creatures** (protocol 4): a `mob` entity names its `species` by index in its world's `faunaSpecies` list (its frame
  names the world), and carries `level`, `hp`, its behaviour state as `mode` and, only while it attacks, `attack`: its
  progress through the attack, 0–1, clamped like the other unit fields and cleared when the attack ends (§6.2).
- **Skills** (`@astra/shared/skills`, protocol 5): a client asks `skills {seq, op}` with `op` one of `unlock {node}`
  (spend fragments), `buy {node}`, `slot {bar, index, node}`, `unslot {bar, index}` (`bar` is `ground` or `ship`, `index`
  0–5) or `respec {nodes}`; node ids are id-shaped strings of at most 48 characters, and one the web lacks is answered
  `unknown_node` rather than dropped. The server answers every request with `skills {seq, skills, error?}`, where
  `skills` is the view `{state, level, shipSlots, met, maxTier}` (§14) and `seq`, `error` and `stale_seq` work as the inventory's
  do; it sends the view after `inventory` on join (`seq` 0) and pushes it whenever server-side calls change it. The client
  predicts with the same shared rules (`applySkillOp(state, contextOf(view), op)`), replays its unanswered requests on top
  and starts over on the view sent after join. Points, fragments and world unlocks are never requests.
- **Cutscenes** (protocol 6, §15): the client sends `cutscene {op: 'request', id}` to play one where its player is and
  `cutscene {op: 'done', id, skipped?, reason?}` when it ends (`skipped` and `reason` only on done; protocol 7's
  `reason` says how: `finished`, `skipped`, or `returned`, given back unplayed because another cutscene was on screen or
  the play came too late; absent, `skipped` says finished or skipped); the server answers `cutscene {op: 'play'
  | 'ended' | 'refused', id, phase, reason?}`, `phase` being the story phase the player is in while it plays (snapshots
  do not say), `reason` one of `unknown`, `denied`, `cooldown`, `busy`, `place`, `phase`, `zone`. Ids are a-z, 0-9 and
  `_`.
- **Mining** (protocol 8, §18): a client sends `mine {seq, frame, node, tool: 'multitool', time}` (a resource node of the
  world `frame`, the spec's `face_i_j_type_k`) or `mine {…, flora: {kind, ref, at}}` (a plant or rock of its own flora:
  its kind, its own key for it, where it stands) about every quarter second while its beam stays on; `seq` counts from
  1 and increases, `time` is never trusted for speed. The server answers each with `mine {seq, frame, node | flora,
  result}`: `hit` with `hp` (the fraction left), `depleted` with `item`, `count` (this character's share) and `added`
  (what of it fitted), or `refused` with `reason` (`stale_seq`, `rate`, `stale`, `zone`, `mode`, `world`, `unknown`,
  `busy`, `harvested`, `range`, `los`, `heat`). `seq` 0 is a share of a node another player broke. `nodes {frame, reset?,
  cells: [{cell, gone, hurt}]}` keeps a player on a world up to date with the touched nodes round it (`cell` is
  `face_i_j`, nodes in it `type_k`; `hurt` pairs a node with the fraction left); a cell with neither list is as the
  scatter places it, and `reset` replaces everything the client held for that world.
- **Combat** (protocol 10, §20): a client sends `fire {seq, time, frame, aim}` for each shot of its ship's base gun, a
  strict shape (a shot carrying any other field, an amount above all, is refused whole); the server answers each with
  `fire {seq, result}`: `hit` with `target`, `miss`, `blocked` (behind the ground) or `refused` with `reason`
  (`stale_seq`, `zone`, `weapon`, `rate`, `stale`, `mode`, `down`, `frame`, `aim`, `busy`). What hits did arrives as
  `combat` events (now with `hp`, the fraction the target has left; `damageType` is what dealt it, `weapon`, `ability`,
  `attack` or `hazard`, and `ability` its id), a kill's rewards as `xp {amount, from, level}` and `loot {item, count, from}`
  events (`item` `units` for money). No client message carries an amount of damage; no event is ever taken from a client.
- **Beacons** (protocol 11, §21): a client sends `beacon {op}`, `op` one of `raise`, `lower`, `watch`, `unwatch` and
  `answer {id}`; the server sends a watcher the shard's list (`beacons`: `reset` and the whole list as it starts
  watching, then new or changed beacons and the ids `gone`), the beacon's caller and answerer their news (`beacon {op:
  'raised' | 'answered' | 'joined' | 'ended', id, …}`, one field per op), and refusals as `denied {of: 'raise' | 'lower'
  | 'answer' | 'watch', code}` with the codes `no_phase`, `kind`, `raised`, `unknown`, `elsewhere`, `far`, `in_phase`,
  `full` beside the social ones (`rate`, `busy`, `self`, `in_party`, `gone`). One `beacon` type serves both directions.
- **Analysis** (protocol 12, §22): a client sends `analyze {seq, time, target}`, `target` a creature's entity id; the
  server answers each with `analyze {seq, target, result}`: `new` with `species` (the codex entry, `CodexSpecies`: key,
  world, index, name, temperament, threat, body plan, Bond eligibility, when first analyzed) and `xp`, `known` with
  `species`, or `refused` with `reason` (`stale_seq`, `rate`, `stale`, `zone`, `mode`, `unknown`, `dead`, `world`,
  `range`, `busy`, `los`, `full`). `seq` counts from 1 and increases; `time` is checked only for staleness.
- **Crafting** (protocol 13, §23): a client sends `craft {seq, op}`, `op` one of `make {recipe, count, at}` (`count`
  1–100 crafts at `at`, the `station`'s fabricator or the `ship`'s) and `learn {recipe}` (from its recipe item), a
  strict shape: no client says what a craft uses or makes. The server answers each with `craft {seq, op, recipe,
  result}`: `made` with `item` and `count` (what reached the inventory; the inventory itself goes out as `inventory`
  state, before the answer), `learned`, or `refused` with `reason` (`stale_seq`, `rate`, `zone`, `unknown`, `not_known`,
  `known`, `no_item`, `place`, `fabricator`, `materials`, `no_room`). `recipes {known}` (recipe ids, each once, at most
  256) is sent after `skills` on join and whenever a recipe is learned, before the answer that learned it. Recipe ids
  are table-id shaped (48 characters); one the table lacks is answered `unknown`, not dropped. `seq` counts from 1 and
  increases.
- **Reputation** (protocol 14, §24): no client message. The server sends `reputation {reputation}`, the view `{factions:
  [{faction, rep, rank}], titles: [{title, faction?, rank?, quest?}]}` (every faction of the table in its order, standing
  0–1000, the rank's id or null; the titles earned by name, a rank's with its faction and rank, a quest's with its quest),
  after `recipes` on join and whenever the server changes it, after that change's events: `rank {faction, rank, from}`
  (one per faction whose rank a change moved, from the rank before to the rank after; ids or null) and `title {title}`
  (a title earned).
- **First finders** (protocol 15, §25): a client sends `name {kind, key, name}` to name a find of its own, a strict
  shape whose `name` keeps chat's text rules (not blank, no control, invisible or direction-changing characters) and at
  most 64 units, so a name the filter refuses is answered rather than dropped; `key` must be one of `kind`'s (a species
  key, a body's frame id, a site key `<seed>:<body>#<index>`). The server answers each with `named {kind, key, result}`:
  `named` with the name as recorded (tidied), or `refused` with `reason` (`length`, `characters`, `blocked`, `reserved`,
  `unknown`, `not_finder`, `named`, `lapsed`, `closed`, `rate`, `busy`). `discoveries {system, reset?, entries}` carries
  a star system's finds (`{kind, key, finder, at, name?, until?}`, at most 512 a message): `reset` and the whole system
  after `welcome` and whenever the player's zone becomes another system's, then new finds and names as they happen.
- **HTTP bodies** use the same module: `Credentials`, `AuthResponse`, `CharacterCreate`, `CharacterSummary`,
  `CharacterList`. Usernames starting with `dev-` in any case (`isDevUsername`) belong to the dev login (§16):
  `POST /auth/register` refuses them, `400 {error: 'reserved_username'}`.

## 6. Zones

A zone hosts one star system: every entity in it, a 20 Hz tick, a spatial hash over world positions at the tick's time,
interest sets per session (entities within the class radius of the session's own entity: ships 50 km, walkers 2 km, mobs
1.5 km, loot 500 m; always the session's own entity, and its party wherever they are; then its phase may hide some of
them, §6.1), and per-session delta snapshots. Ticks are fixed-step; a tick that overruns is logged with its duration (the
budget is 10 ms p95 at 200 entities), and every ASTRA_METRICS_S (10 s) the manager logs the loop (`tick loop`: ticks run
and skipped since the last report, zones loaded and awake, sessions) and each awake zone (`zone metrics`, with its zone
id: tick p50/p95/max over the last 400 ticks, entities, sessions, overruns, its fauna's worlds, creatures and cells) at
info, as the server's other logs are: pino JSON lines that carry a `zone` id wherever a zone is concerned. Entities in deep space between systems belong to a deep-space zone keyed by the
nearest system (P1.E04.T04).

The radius is the class of the entity seen, not of the viewer: a ship, or a player in any mode but `foot` (docked and
landed players sit in their ships), is a ship; a player on foot, an NPC or a prop is a walker; a mob is a mob; loot and
loot pods are loot. An entity already in view stays in it until it is 5% beyond its radius, so one at the edge does not
enter and leave every tick. A player's mode is the one movement authority believes (§7): a client claiming `foot` while it
flies is corrected and stays a ship. A zone opens on its first join, stops ticking after 30 s empty and unloads after 5
minutes empty.

### 6.1 Phases

DESIGN 17's phases (story chapters and instanced quest steps, hangar bays, event and raid instances) are private layers
inside a zone, kept by its `PhaseManager` (`zone.phases`, `phases/manager.ts`). A phase is opened at a **location**: a key
naming the place (a quest step's site, a Waystation's hangar) and a sphere in one of the system's frames, which moves with
the frame. Every entity is in one phase or none (the shared world): **members** are sessions' players, placed by
`phaseFor(session, kind, location, partyId?)`; a phase's **own entities** (its actors) are spawned through `spawn(phase,
init)`. Kinds and caps (`phases/kinds.ts`): `story` holds one party (a player in no party is a party of one), `bay` 24
players, `event` and `raid` 12.

- **Placement** reuses the phase the player is already in at that place (or kept for its character, below), else a
  party member's that has room, else the fullest that has room (the oldest of equals), else opens one. A player is in one
  phase at a time; placing it elsewhere takes it out of the old one. A member's party is the `partyId` it was placed
  under, which it keeps; without one, its entity's party tag as it stands (which the party service keeps, §13). A story
  phase never holds two parties: re-asked, or coming back, under a party its others are not in, a
  player goes to another phase. `enter(viewer, phaseId, partyId?)` puts a player in one phase by name instead (a
  call-for-aid beacon's answer, §21): under the same cap and party rule (`full`, changing nothing), a place kept for its
  character there taken back as `phaseFor` takes it back, any other phase left; a member asked under a new party takes
  it when the phase's others are all of it. It never moves the entity, so movement authority's judging goes on as before.
  `release(characterId)` gives up a place kept for a character whose connection is down, as its grace running out would
  (a beacon's helper no longer of the party, §21).
- **Visibility** filters every interest set after the distance and party rules (the phase rule wins over the party
  rule): a session sees the shared world and its own phase; never another phase's own entities; and another phase's
  players unless either is **sealed**, a member inside its phase's volume (5% hysteresis) in a kind that isolates
  players (`bay`, `event`, `raid`). A sealed member sees no player outside its phase, the shared world's included, and
  none sees it; the shared world's other entities stay in its sight. A `story` phase hides only its actors (DESIGN 14.1:
  everyone else sees the ordinary world there). With nothing in a phase the filter is skipped.
- **Presence**: a member outside the volume goes back to the shared world after the kind's grace (15 s), keeping its
  phase if it returns in time. A member whose connection drops (`ZoneManager.leave(session, 'disconnected')`: every
  socket close, and the old connection kicked when its character enters again) keeps its place for the same grace, by
  character id, with its party, counting towards the cap; its character's next `phaseFor` at that place returns it to
  the phase if it comes back under that party (the `partyId` given, else its new entity's tag, which the party service
  sets as it joins): one that left or was kicked from the party meanwhile, or comes back in none, gives the place up and
  is placed afresh. A member already outside the volume keeps only what is left of its grace, and comes back still outside, so
  dropping and reconnecting never extends it. One that leaves the zone any other way (a handoff, a logout) goes at once. A phase with no members and no
  kept places closes, and its own entities are despawned; `close(phase)` does the same on demand. Opening and closing
  are logged (info).

### 6.2 Fauna

DESIGN 12.2, P1.E08.T01 and T03; `fauna/`. A world's species come from shared `faunaSpecies(params, tier)`: its own
docile and skittish species, then the hostile ones each tier pass appends on a random stream of its own, so the list
only grows with the tier and an index names the same species at every tier. The zone ticks a `FaunaSim` at the start of
each step, at the zone's tier: the zone manager passes the world service's tier when it opens the zone and calls
`setTier` when the Edge moves it.

- **Cells.** Herds live in cells of about 250 m (an equal-angle cube map) round players within 1,500 m of a world's
  ground: a cell wakes when a player comes within 400 m of its centre and spawns the herd planned for it from the world's
  seed and the cell alone, so everyone meets the same herd there; with no player within 500 m it sleeps (its creatures
  stand still, unsimulated), and after 30 s asleep its creatures are despawned. Ambushers and the apex come only from
  dens (below).
- **Bounds** (a pose is a client's claim until movement authority, and fauna holds its own limits anyway): a player
  wakes at most 4 new cells a second (40 at once, on arrival; one allowance per player across the zone's worlds), a
  world keeps at most 256 cells and a zone at most 150 creatures, so 50 players on foot stay within the 200-entity
  budget. The oldest asleep cells unload first to make room; past that, waiting cells load nearest first as room is
  made. New cells load under a 1.5 ms budget per tick.
- **Ground.** The drawn ground (§12, `drawnGround`'s pads), its heights cached per cell on a 1 m lattice. Planning a
  world's surface takes 5–100 ms, so it runs in a worker thread (`fauna/planner.worker.ts`) from the moment a player
  enters the world's frame; its cells load once it is ready. The 16 worlds most recently asked for keep their ground.
  The plan also carries the sites' clearance, so the same ground serves the resource nodes (§18): one plan per world.
  The planner never stops fauna server-wide: a worker that dies (an error, or an exit without one) is restarted once
  with its plans, and after a second death planning moves to the main thread (one warning); a plan that hangs 10 s
  restarts the worker and goes again, and is given up if it hangs twice; a world whose plan fails is retried after 30 s,
  doubling each time, with one warning each time. A world's dens at the zone's tier come from the same worker and the
  same plan: shared `worldSurface` plans the whole surface once (`planWorld`: the drawn ground's pads and sites'
  clearance, to the bit, and every den of the tier, each naming which of the world's species lives in it, §12). The
  dens cost 50–600 ms more on a large world at Tier 3, so they are asked for with the ground but as a request of their
  own, kept per world and tier: the ground (`planGround`) comes back first, without them, and the dens' reply carries
  the ground of its plan too, kept with its clearance (`Ground.nodes`) when no ground is kept yet. Tests hold the pads,
  the nodes' clearance and the dens to one plan.
- **Night** (`fauna/sky.ts`) is the meters' rule from the shared kinematics: night at a point when its star is on or
  below the horizon of the point's own up. At night a cell may also send out its night herd, always one of the herd
  spawner's predators, planned from the world's seed and the cell on a stream of its own with
  (`FAUNA_SPAWNING.nightPredatorSpawnMult` − 1) times the chance its day herd is a predator's, so night doubles the
  predators the herd spawner places (DESIGN 12.2, 12.8). It comes out once a night, when night falls on an active cell
  or the cell wakes at night, and stays until the cell unloads.
- **Dens** (DESIGN 12.2, `fauna/dens.ts`) live in the cells they stand in: while its cell is active a den keeps its
  occupants out, as herds of the cell homed on the den. A predator den keeps its pack out, and at night a second, once a
  night; an ambusher's burrow beside a site keeps its one or two ambushers lurking on it until a player comes within 8 m;
  the apex's lair, in the landmark grove (the most wooded of the places a lair could go, `planDens`), sends out the apex
  and its pack at night only, and at dawn the apex heads home once it has no one to fight and goes into its lair. A
  den's herd that loses its occupant (a pack wiped out; the apex killed, its pack then hunting on as an ordinary herd of
  the cell) is replaced after 300 s (the apex after 1,800 s, at night), a timer the zone's fauna keeps while the zone
  runs, beyond the cell's life; a pack that only unloads with its cell comes back when the cell next loads. A
  once-a-night spawn (a cell's night herd, a den's night pack) is due again from the first day after it, its cell awake
  or asleep.
  Night herds and dens' occupants spawn at each scan under the cells' load budget, never within 70 m of a player (the
  herd spawner's nearest), and only when the zone has room (they try again at the next scan). Dens spawn whether or not
  they are drawn: a den is a spawn anchor, not geometry. `FaunaOptions.dens` (as `spawner` by default) turns them off.
- **Phases.** A player the shared world cannot see (`phases.hiddenFromShared`: sealed in a bay, event or raid phase, §6.1) still keeps the herds
  round it awake, since it sees them, but is no creature's prey, intruder or threat.
- **On the wire**, creatures are seen from 500 m when under a metre, 2 km for the apex and 1.5 km otherwise
  (`EntityInit.interest`, kept through every update). Their `mode` is one of idle, wander, flee, fly, alert, charge,
  return, stalk, rush, attack, feint, lurk, circle, dive, climb, follow, and `dead` for a corpse (§20). Hostile creatures
  pick targets from a threat table (`@astra/shared/combat`): sensing a player on foot adds threat by nearness, and every
  hit combat deals adds its damage (`FaunaSim.hurt`), so a creature turns on whoever hurts it most (and a grazer bolts);
  only a player on foot is one it can go for. The zone's metrics carry its fauna's worlds, creatures, cells by state and
  herds out at dens.
- **Death** (P1.E06.T02, §20): combat reads a creature's species, herd level and size (`FaunaSim.creature`,
  `creaturesIn`), and one it kills leaves its herd at once (`FaunaSim.kill`): the AI forgets it, and its herd and den see
  the loss as they see a despawn (a pack wiped out starts its den's 300 s timer then, an apex its 1,800 s one, its pack
  hunting on), while its entity stays a corpse for the death beat before combat despawns it.
  return, stalk, rush, attack, feint, lurk, circle, dive, climb, follow. Hostile creatures pick targets from a threat
  table (`@astra/shared/combat`): sensing a player on foot adds threat by nearness, `FaunaSim.hurt` adds damage. The
  zone's metrics carry its fauna's worlds, creatures, cells by state and herds out at dens.
- **Analysis** (§22) reads a creature as its entity has it (kind `mob`, `species`, `frame`, `pos`, `hp`: a corpse, hp 0,
  is refused `dead`) and its species from the world's whole list (`faunaSpecies` at `FAUNA_MAX_TIER`, so an index is the same species at every
  tier); line of sight is over the ground this zone's fauna walks on (`FaunaSim.grounds` at its tier).

## 7. Authority

Following IMPLEMENTATION_PLAN 0.3: the client sends inputs and its predicted pose; the server validates pose against per-hull
and walker speed caps and the shared terrain sampler, corrects with `correction` when the error exceeds tolerance, and
decides damage, loot, inventory, quests, economy, skills and the meter. Client-reported outcomes (damage dealt, items
picked up, quest steps done) are never trusted; they are requests the server re-evaluates.

**Movement** (`packages/server/src/sim/movement`, P1.E03.T04). Every zone the ZoneManager opens checks each player input
before applying it.

- *Time.* Speed is judged on the client's own clock: a pose is judged at the time its client stamped it (`input.time`),
  an honest client's poses and times being its own trajectory. (This reverses the flight contract as P1.E12.T01 first
  wrote it, where the server measured elapsed time itself.) The network's delays cancel within these bounds
  (`MOVEMENT.time`), which keep the time credited between two inputs from running ahead of the real time that passed by
  more than a small fixed slack:
  - an input is credited with the time its client says passed since the one before, never less than none (a clock
    stepped back costs that one input's time);
  - and no more than its arrival gap, plus 0.05 s out of a 0.5 s bank that only real time no input claimed refills, plus
    0.05 s of what is owed: the real time its running clock left unclaimed in the last 10 s, as its inputs fell behind
    (a latency rise, a stall). So jitter of up to half a second cancels outright, a backlog drains however it arrives,
    bunched or over seconds, and a latency spike falls back; a clock standing still while time passes is owed nothing
    and banks half a second at most; one run fast is held to real time once the bank is spent;
  - and never more than 0.3 s ahead of arrival.
  - The envelope, as measured: the total time credited is at most the real time elapsed, plus the 0.5 s bank, plus
    0.3 s ahead of arrival, and what is owed expires 10 s after it accrued. Within that, a client sending at 60 Hz
    (inside its message budget) can be credited up to 3.9 times real time for 3.4 s; and one that stood still for 6 to
    10 s with a trickling clock can claim about 6 s of allowance in one tick (some 10 km at the boost cap). That is the
    envelope of an honest stall's backlog arriving at once after a silence, which is accepted: nothing beyond it is open.
  - A clock stepped forward past what it can be credited (the client steps a clock that has fallen more than a second
    behind, as after a hidden tab's pause) is not cashed in: the credited time re-syncs to it with no movement credit for
    the step, and judging starts a fresh window there (at most once in 10 s).
  - The bodies are placed at the credited time (to within 10 ms), so the pose's frame, clearance and air are the
    client's; but never trailing the input's arrival by more than a second plus what is still owed. A stamp lagging its
    arrival by more than a second is a backlog only while that lag drains (by half a second within every 3 s); one that
    does not is stale, and placed at its arrival (the client never keeps such a lag: it steps its clock forward).
  - A client that sends no time (0) is judged and placed on its arrival times: no jitter is cancelled for it. The game's
    client stamps `time`.

- *The pose* must be in a frame the shared rule (`selectFrame`) allows there, and change frame only where the rule does
  (out of a sphere 5% beyond it, into one inside it; the last pose in the old frame is taken as carried by that frame to
  the new pose's time, so a page that stalled for seconds and changes frame on its way back is judged on its own
  movement, the frames' drift allowed over a tenth of a second at most); a ship may not be below the ground (the shared
  terrain sampler, levelled under cities and sites exactly as the client levels it, sampled only below a ceiling no terrain reaches: the
  ground fauna walks on, `drawnGround` at the system's tier, planned in the server's worker thread once a player is in
  the world's frame; a pose that needs it before it is ready is let through provisionally and judged again, with every
  input after it, as soon as it is, and refused back to where that began if it is not ready within 5 s), in a gas
  giant's depths, or with its centre inside the
  Waystation's hangar shell grown by its 6 m collision sphere (`STATION_LAYOUT` in `@astra/shared/data`; the rest of the
  station's colliders arrive with P1.E11.T02); a walker may not be below the ground, outside the hangar (Grav Boots
  aside), or more than 400 m over the ground for longer than 45 s.
- *The mode* must be legal there: the pulse drive only out of the air, clear of what is ahead (`PULSE_DRIVE.engageClearM`
  to engage, `dropOutM` while cruising, `pulseClearance` computed by the server from the pose) and, engaging over a world,
  2 km over its ground; `landed` only on a world's dry ground; `docked` only on a Waystation pad no other ship holds (a
  joining ship docks on a free pad, or waits in the hangar's mouth in mode `ship` when all four are held); `foot` only on
  a world's ground or in a hangar, and only out of a landed or docked ship, which it can board again only from beside it.
  In mode `ship` the `boost` button bit raises the caps to the boost cap, and air thicker than `AIR.flightModelFrom` to
  the `atmo` cap: a client must send the bit while it boosts.
- *The move* from the last valid pose: no further than its allowance covers in the time since (at most a second of it,
  whatever silence came before: the client moves its ship a clamped 66 ms frame at a time), plus a tenth of a second's
  worth and 25 m (anti-teleport); and not through the ground, nor a flying ship's centre through the hangar's
  shell, further than the client's own once-a-frame collisions could miss (one 66 ms frame at its speed, the speed no
  more than its allowance; steps are sampled against the terrain only when that long).
- *Speed* follows the flight contract (`FLIGHT_TOLERANCE` in `@astra/shared/ships`): displacement over windows of at
  least 1 s, judged against the larger allowance at the window's two end poses; a window not yet 1 s long is judged from
  its start. A window carries on across a change of frame (its earlier poses re-expressed in the new frame as of the
  change, since the client turns its velocity into the new frame without the frames' relative motion, which is allowed
  for over the crossing step) and across changes among `space`, `boost` and `atmo` (each end pose its own allowance, with
  the contract's decay). Between the engines, the pulse drive and rest a new stretch starts from the old one's last pose,
  taken in the new mode's terms. Getting out and boarding carry the accounting too: the walker's first pose is judged as
  a walker's move from where the client sets it down (`Game.exitShip`: 11 m left and 3 m ahead on the ground, or 8 m left
  in a hangar), and a boarded ship's first pose as a ship's move from where it was left. A walker's windows are judged
  across the ground (`walkerCaps`: the sprint, Sprint Stride's 11.5 m/s, the jetpack's push), upward (its climb plus the
  highest ground along its path, which lifts it) and downward (`walkerFall`: no faster than a fall from where it last
  touched the ground).
- *Refused*, an input is not applied (its `seq` still counts for `ack`): the server sends `correction {seq, pose, mode}`,
  `seq` being the refused input's and `pose` the last pose it can vouch for (for a window that was too fast, the
  window's start), puts the entity there, and logs the account, character, rule and the measured and allowed values.
  Inputs from the old trajectory are refused quietly for a second, or until one fits the corrected pose, so corrections
  come at most once a second; 8 corrections within 30 s and the session is refused with `kicked`. An accepted input's
  reported velocity is held to its allowance.
- A pose the server did not watch arrive (a saved one, restored at login) is checked by `poseProblem` against the same
  pose and mode rules; a character saved on foot also needs the ship it left (`parked`, saved with it) where a ship can
  rest. The gateway has the planner plan the saved pose's world's ground before the check (`groundForRestore`), so it
  never plans on the main thread; one it still cannot judge is not vouched for. Persistence restores any other docked at
  home (§8).
- *Combat* (§20) reads only what movement authority believes: a shot is fired from the zone entity's accepted pose
  (carried on along its accepted velocity to the shot's time, a tenth of a second at most) and only in mode `ship`, its
  aim held to the believed nose, and a hit's damage lands on the pool the believed mode says (the suit on foot, the
  ship's shield and hull aboard).
- A pose the server gives a character in play (an admin teleport within its zone, P1.E03.T07) re-seats its mover as a
  join does (`MovementAuthority.remove`, then `add` at that pose; a docked one on whichever pad is free, `freePad`), so
  its client's next input is judged from there.

## 8. Persistence

Postgres tables (Drizzle): `accounts`, `shards` (§3) and `characters` (people, name, look, level, xp, home system, and
`state`, `revision`, `saved_at`). The shard's row also holds the Count and how far its meter has run; the meter's votes
and daily rolls are in `count_votes` and `count_days` (§11); a shard's first finds in `discoveries` (§25). Migrations are generated with drizzle-kit and applied with
`pnpm db:migrate`.

**Character state** (`src/persistence`, P1.E03.T05). Every subsystem that owns part of a character registers one
component in the registry (`registry.ts`): `{key, v, schema, migrations?, columns?, onInvalid, default(ctx),
reconcile?(value, ctx), check?(value, ctx), load?(value, ctx), save(ctx), unload?(id)}`. A component is stored as an entry
`{"v": <schema version>, "data": <value>}` of the row's `state` jsonb under its key, or, with `columns`, in the row's own
columns. Components load in registration order, so a later one reads an earlier one's value (`ctx.get`). Phase 1 registers
(`components.ts`, `coreRegistry`): `progress` (level, xp, home system: the columns), `skills` (§14; the owned nodes the
ship and inventory read; reconciled with the skill web on load), `ship` (`ShipLoadout | null`, the Lark by default,
checked with `shipStats` under the owned nodes, so Pack Mule's second pod loads; pods beyond its bays, which only a data
change makes, are given back on load, logged), `inventory` (its layout re-derived from the ship and the owned nodes on
load, `applyLayout(saved, layoutFor({ship, skills}))`; kept as saved, and logged, when the ship cannot hold it), `pose`
(`{system, pose, mode, parked?}`, read from the character's zone entity, `parked` being where a character on foot left its
ship; version 2; its `check` is movement authority's `poseProblem` (§7), so a saved pose inside the ground, in the
hangar's shell, docked off a pad or on foot with no ship to board is not restored), `codex` (§22: the species analyzed,
per world, `v` 1, held by the codex service; reconciled with the species data on load; refused, never replaced, when
unreadable), `recipes` (§23: the recipes the character knows, `v` 1, held by the recipe book; the starting recipes by
default; reconciled with the recipe table on load; refused, never replaced, when unreadable), `reputation` (§24: standing
by faction and the titles earned, `v` 1, held by the reputation service; none by default; reconciled with the faction
table on load; refused, never replaced, when unreadable), `plates` (§25: the codex plates of the character's first finds,
`v` 1, held by the plate book; refused, never replaced, when unreadable) and, when the server has a quest runtime,
`quests` (§17: held by the runtime; refused, never replaced, when unreadable).

- **Load** on `join`, from what persistence still holds for the character (it left moments ago and that save may not have
  landed) or else from its row; the join pins the character while it reads the row. A missing component gets its default;
  an older `v` is migrated one version at a time and written back at the next save. A value the game's data has moved on
  from (the skill web changed) is brought in line by the component's `reconcile`, after the schema and before `check`, so
  every later component reads the result; it logs what it changed and the result is written back at the next save (a live
  capture and an edit's values are never reconciled: they are this build's). A value that cannot be read (a newer
  `v`, no migration, the schema or `check` fails) follows `onInvalid`: the pose falls back to docked at the home
  Waystation, logged (so does a saved frame the zone does not have: `ZoneManager.join` with a placement); every other
  component refuses the join (`refused {code: 'full'}`, logged) rather than silently replace progress. `welcome` carries
  the loaded pose.
- **Save** every 30 s per character in play, staggered (the interval split into 30 slots, each character in the
  least-loaded, one slot captured per second); on leave (logout, disconnect, the older connection of a duplicate join),
  captured before the entity leaves its zone; on zone handoff (P1.E04.T04 calls `persistence.saveNow(id, 'handoff')`);
  and on graceful shutdown (`server.close()`, which SIGINT and SIGTERM run: sessions close and save, everyone still in play
  is captured, and the queue is written within 5 s). While writes succeed, a crash loses at most the last interval; while
  they fail (the database down, retries backing off, a backlog) it loses everything not yet written.
- A capture is synchronous and small: each component's live value, checked against its schema (a value whose `save`
  throws or that fails is logged and its stored one kept), and only the components whose value changed since the last
  capture, at a revision one above it. The components a capture takes go in one row update, but a component it cannot
  take does not stop the others, so a change spanning two components is written whole only when both are taken. A
  component that must never be written without another names it in `writtenWith` (either side naming the other is
  enough): when a capture cannot take one of them, it holds the others back too (logged at error, their stored values
  kept, their changes left for the next capture). The reputation is written with the quest log (§24), so owed quest
  reputation settled into it lands with the owed list it leaves, or neither does: a crash, or a quest log that cannot be
  saved, leaves the row as it was, and the next join settles it again. While one of them cannot be saved, neither is,
  and leaving play then loses the changes of both. Writes never block a tick: the queue holds at most one save per
  character (a newer capture merges into the waiting one), one writer drains it in batches of up to 64, one
  `UPDATE … FROM (VALUES …)` statement each, which merges the entries into `state` (`state || new`, so keys this server does not know survive), sets the columns it carries and
  raises `revision`, only where the row's revision is lower, so a save older than what the row holds is skipped (and
  logged as an error). A failed write is logged and retried with backoff (0.5 s doubling to 30 s), merged under anything
  captured since; a failed batch retries one character per statement, so one bad row holds back no other.
- **One process holds a character at a time.** Revisions are counted by the process holding the character, from its
  row's revision on join, so the guard orders that process's saves but does not fence two processes holding one
  character: each would count from the same row and could overwrite the other. A real fence (a per-join epoch or a
  presence lock) comes with P3.E37's split into several processes. The gateway reads a joining character's row under its
  canonical id (lower case, the spelling Postgres returns and persistence keys by) while persistence pins it.
- A character that has left stays held until its save is written, then every component forgets it (the inventory service
  included). The in-memory services refuse a character they do not hold (`InventoryNotHeldError`), so nothing changes a
  character out of play behind persistence's back.
- **Out of play: load, modify, save** (`persistence.edit(id, modify)`, P1.E03.T07; the CLI's grant, teleport, skill
  points and quest step use it, §16). The character's row is read (`store.read`) and decoded as a join would decode it;
  `modify` reads each component's value (a copy; the default when none is stored) and sets new ones, or returns why it
  refuses; each value set is checked against its component (schema, then `check` with the components before it reading
  the edited values) and the changed entries are written in one save at the row's revision + 1, which the store's guard
  turns into a compare-and-set: a row written meanwhile is a `conflict`, and nothing is written. An edit is refused
  (`held`) while the character is held (in play, or left and its save not yet written) or pinned (a join is reading its
  row), and (`busy`) while another edit of it runs. A join of a character being edited waits before reading its row
  (`persistence.afterEdit`, which the gateway's row read goes through, under the join's pin) until the edit's write
  has landed or failed, so it loads the edited state; `close()` lets a running edit finish. An edit may take the
  character out of play first (`{leaving: session}`, the CLI's teleport to another system, §16): the leave is captured
  at once and written (within `flushTimeoutMs`, else nothing is edited), what was held for it is dropped (the row has
  it), then the edit is made, the character's joins held throughout. Like a save, an edit assumes one process holds the
  character (the CLI's direct mode is refused while a server answers).

**Adding a component** (quests P1.E09.T01, reputation P2.E18.T01, flags): export `xComponent(service)` returning a
`CharacterComponent` with its key, `v: 1`, the zod schema of the stored value, `default`, `load`, `save` and `unload`
(`onInvalid: 'refuse'` for anything a player earned), and register it in `coreRegistry` after the components it reads and
before those that read it (skills, P1.E07.T01, go before the ship and the inventory, which pass the owned nodes to
`shipStats` and `layoutFor`). No SQL migration: it is a new key in `state`. To change a stored shape later, raise `v`
and add `migrations[oldV]`; when the game data a stored value reads changes instead (ids renamed or removed), give the
component a `reconcile` that brings the value in line on load (skills, §14; quests reconcile in their runtime's `open`,
§17). State that must be queried across characters, or outgrows one jsonb entry, gets a child table and a
store of its own.

## 9. Client networking (`packages/client/src/net`)

The client is online only (DESIGN 16.6, 20.3): the title's Play signs in over HTTP, lists or makes characters, and enters
the world over the WebSocket. Nothing of the game is kept in the browser (P1.E04.T01).

- **Origin.** The client calls the gateway on its own origin: `/auth/*`, `/characters`, `/health`, and the socket at `/ws`
  (`api.js`, `gameSocketUrl`). In development Vite proxies those paths to `pnpm dev:server` (`vite.config.js`;
  `ASTRA_SERVER` points them at another server), as whatever serves the client in production will.
- **Sign-in.** `api.js` wraps register, login, the dev login and the characters API, checking bodies with the shared
  schemas (a refusal keeps the server's code and words, and a rate limit's `Retry-After`). The session token is kept in
  `sessionStorage` (`session.js`: Play in a tab already signed in goes straight to the character list, closing the tab
  signs out), beside a one-shot notice for the title. There is no refresh: a token runs 7 days, the client reads its
  `exp` claim and asks for a new sign-in a minute before it runs out, and a `401` from `/characters` or an `auth`
  refusal on the socket forgets it and goes back to the sign-in. `localStorage` holds only `next-horizon-settings` (look,
  sound, graphics); the demo's old save (`next-horizon-save-v2`, `astra-nullius-save-v2`) is removed at boot wherever a
  browser still has it.
- **The account screens** (`ui/Account.js`, P1.E04.T05) take the title's left column when Play is pressed, over the
  title shot: sign in or create an account; the account's characters (people, level, home; a new account's list is
  empty, a new character offered); a new character (a name and a people; the full creator is P1.E05.T05's); entering.
  `AccountFlow` holds the steps without a DOM (unit tested): one request at a time, an answer that comes after the
  player moved on is dropped (Esc from a character still being made reads the list again once the server has answered),
  a refusal is shown on the field it is about (the server's words: wrong password, taken or reserved name, limits, rate
  limits), and a typed password leaves the page once sent, with its step, or on closing. Entering calls
  `Game.enterWorld` and shows Net's states; a failure before the welcome goes back to the list with why, and Esc lets the
  socket go. The first welcome, and everything the server says after it, is held (`holdFirstWelcome`) while Enter is
  ticked and the title and its screens fade to black (at once in a hidden tab, whose animations do not run; at most
  10 s); the game then places the character, takes what came meanwhile in order (a listener that throws is reported
  and the rest still go), and its place fades up. Once the welcome is held Esc no longer cancels, and the title keeps
  its own clock until the welcome is taken. By keyboard: Play has the focus once the title
  is ready, Enter submits, Esc goes back a step, the arrows walk the characters and the peoples, N makes a new
  character. The dev login's call is compiled out of production builds.
- **`Net`** (`Net.js`) owns the socket. `connect()` sends `hello {version: PROTOCOL_VERSION, token}` and `join` together
  as the socket opens (the gateway handles a socket's messages in order). States: idle → connecting → joining → joined →
  closed. A connection that drops after a welcome goes to reconnecting and tries again after 0.5 s doubling to 30 s (each
  delay scaled by a random 50–100%), then joins again; a refusal another try would repeat (`version`, `auth`,
  `character`, `kicked`), a second `invalid` within a minute (the first may be an honest client's flood after a stall,
  so it is retried), a failure before the first welcome, and `close()` end in closed. Messages are routed with
  `on(type, fn)`: `welcome` (with `first`, false on a reconnect), `world`, `inventory` (with `first` for the state sent
  after welcome), `correction`, `zone`, `event`, `refused`, `pong`, and the connection's `state`, `lost`, `closed`; types
  nobody listens for are dropped quietly, and so are snapshot fields and entity kinds nothing reads yet (a `mob`'s
  `attack` is kept in the store for P1.E04.T02); `net.beacons` (`beacons.js`, §21) keeps the call-for-aid beacons it is
  sent, `net.reputation` (`reputation.js`, §24) the character's reputation, and the chat and party UI (§13) listens for
  `party`, `denied`, `beacon` and the chat and party events. While the connection is down after a welcome, a line at the
  top of the screen says so.
- **Snapshots** decode into `net.store` (`snapshots.js`): the states it was sent for the last 64 ticks, deltas applied
  onto their `base`; `entities` is the latest state and `ack` the last input `seq` the server applied. The store starts
  over on every welcome (a restarted server counts its ticks from 0 again). Acknowledgements go out at most once a tick
  (50 ms), always for the newest applied tick, so the backlog a stalled page catches up on is acknowledged once rather
  than snapshot by snapshot (which would spend the socket's budget in one burst). A tick that cannot be applied (its
  baseline is not held, the decoder refused one of its entities, it names an entity never sent whole) is neither stored
  nor acknowledged, so the server keeps diffing against the last good one. Snapshots before the welcome are ignored.
  Gameplay reads remote state from the store, never from the socket.
- **Input** goes out at 20 Hz of real time (`update()` each frame, never faster however fast frames are stepped: the
  gateway's budget counts real seconds): `seq` from 1 on each connection, `time` the world time the pose was sampled at
  (the clock the client placed the bodies and picked the frame with; never going back), and the game's sample
  (`Game.inputSample`): the predicted pose of the ship or, on foot, of the walker (its quaternion built from its
  heading), in the frame the client picked; the mode (`foot`; `pulse`; set down on a Waystation pad `docked`, elsewhere
  `landed`; anything else a ship does `ship`: flying, taking off, landing, the docking autopilot); and the buttons (`boost`
  while boosting, which movement authority reads). There is no input while the client is outside its zone's system or
  between the stars, until zone handoff (P1.E04.T04).
- **Time.** `ClockSync` (`clock.js`) estimates the server's clock from `welcome` and a `ping` every 2 s: the offset of the
  shortest round trip of the last eight. World time (`game.time`, §3) starts at it on the first welcome, before any input;
  from then it never goes back (`Game.advanceClock`), because movement authority judges each input at the time it
  carries: each frame it advances by the frame's time eased toward the estimate (at most twice as fast), stands still
  rather than going back, and is never more than 0.25 s ahead; more than 1 s behind (the frame loop stopped, as in a
  hidden tab, or a long stall) it steps forward to the estimate at once and that frame places the bodies at the new time
  (movement authority starts a new judging window at such a forward jump, at its arrival). Shaders animate on
  `game.renderTime` instead, which advances by exactly the frames' time and stays small: at the server's 10^7 s a float32
  uniform moves in 2 s steps.
- **Welcome** places the character where the server holds it (`Game.placeFromServer`), loading the zone's system first
  when it is not the current one: `docked` on the Waystation's pad nearest the pose; `landed`, `ship` and `pulse` at the
  pose (the pulse drive is not resumed); `foot` with the walker at the pose and the ship on the nearest pad, or landed
  beside it on a world. On the first join only the zone's system is marked visited. On a reconnect the client keeps its
  own pose (it kept flying) and its next input reports it, while it is still in the zone's system and one of its frames;
  otherwise (it warped away, the server put the character elsewhere, it is between the stars) it is placed from the
  welcome as on a first join. The inventory sent after welcome replaces the client's (`Inventory.reset`); later states
  reconcile its requests (§5). The mouse is captured only from a user gesture: entering the world leaves the pause
  screen up, whose Resume captures it.
- **Saving is the server's** (§8). `Game.save()` sends the input at once at moments worth holding (docked, a system
  reached, a site visited). Leaving (the pause menu, or a refusal after joining) closes the socket and reloads the page,
  so nothing of one character's client state carries into the next.
- **Corrections** are taken as they come until prediction and reconciliation (P1.E04.T03): the pose, re-expressed into the
  frame the client is in (DECISIONS P1.E03.T03).
- **Dev sandbox.** In dev builds only, a scenario hash (`#sandbox`, `#foot`, `#fly`, `#land`, `#station`, `#dock`,
  `#space`, `#review:…`) or `window.dev.boot()` starts `Game.startSandbox`: offline, a new pilot by the home Waystation,
  no persistence of any kind, so the smoke specs, captures and asset reviews stay hermetic. The game itself always goes
  through the server. With `?dev` (`?dev=<name>`, `&people=<id>`) a scenario goes through the server instead, signed in
  by the dev login (§16) as `dev-<name>` (the scenario's name by default) and entered at once: it starts where the
  server holds the character (movement authority refuses a client that puts itself elsewhere), `#foot` and `#dock`
  getting out of a docked or landed ship; the dev CLI's `teleport` puts it anywhere else. `#review` and `#cutscene`
  stay offline.
- **Remote entities** (P1.E04.T02) render from the store with 100 ms interpolation delay and up to 250 ms extrapolation,
  frame-aware (interpolate in the entity's frame; on a frame change, re-express the buffered poses).

## 10. Tests

Unit tests (`*.test.ts`) next to the code or in the package's `test/` folder; integration tests (`*.int.test.ts`) start a real server on a random port against
the dockerised Postgres and Redis (`pnpm db:up && pnpm test:int`) and drive it with scripted clients from
`packages/tools/src/bots`. Each integration test creates its own accounts with unique names and cleans nothing up; the
database is disposable. The online smoke specs (`packages/tools/src/smoke/online.spec.ts`, part of `pnpm smoke`, needing
`pnpm db:up`) run the server against a scratch database they create and drop, and a client through Vite's proxies.

## 11. The Count meter (`packages/server/src/count`)

DESIGN 16.1–16.2, lean not volume. Gameplay reports each counted action to the world service with
`world.countAction(accountId, action, tag)`: `action` is one of `COUNTED_ACTIONS` in `count/meter.ts` (convoy escorted or
raided, the wall choice, an anchor held, a Hive Heart shattered, a Warden killed, a monolith touched), `tag` is `feed`,
`hold` or `break`. The account id is lower-cased (as Postgres returns uuids), and the open day's ledger keeps one vote per
account per action type (the first cast; the call returns false for a repeat).

Two clocks move the Count, both on shard world time from the epoch (§3), never wall time. The burn takes one measure
every 17,280 s (tick k at k × 17,280 s, so 5 a day). A meter day is 86,400 s; at its end the day's lean is Feed's share of
its vote weight (a Hold is a full vote of which a third is Feed; a monolith touch weighs a tenth of a vote), the target
is `round(150 + 700 × lean)` and the Count drifts toward it by at most 25, never past it; a day with no votes does not
drift. The midnight burn tick belongs to the ending day and falls first, so the drift reads the Count after it; on a
steady lean the Count is back on the target at each day's end, having burned 5 below it. The Count stays in whole measures
in 0–1,000. `runMeter` plays both clocks forward in time order; the service runs it every second and before every
counted action, publishes the new Count as one ordinary world change (`world` to clients, the Redis mirror) and logs
one line.

Persistence: the shard's row holds `count`, `count_day` (the last day rolled) and `burn_step` (the last burn tick
applied); votes go to `count_votes`, rolls to `count_days`. The service gathers new votes, rolls and the meter's position
and writes them in one transaction per save: a burst of votes is one batched INSERT and a boot catch-up is one write.
A save that fails is kept and written again by the next (the next vote, burn or roll, the minute's time save, or
shutdown). On boot the service reloads the votes of every day after `count_day` and plays every burn and day end that
passed while it was down, in time order, then takes the open day's ledger back, so a restart keeps the day's votes and
its one-vote rule; the clock never starts below a stored vote's time (§3). The underdog side (`underdogSide(count)`:
Break above 700, Feed below 300) and its rep multiplier (`underdogRepMultiplier(count, tag)`, 1.5, Hold included on
either side) are pure functions for the rep model to apply. All the arithmetic is pure and integer-exact (votes are
summed in thirtieths), so the same lean gives the same Count bit for bit at three accounts and at three thousand.

## 12. The ground both ends draw (`@astra/shared/world`)

Every machine regenerates a world from its seeds (DESIGN 17), and what the server decides on a world's surface, such as
which resource node a player mines, must stand where every client draws it. So both ends plan a rocky world's surface
with one function, `drawnGround(params, tier)` (`world/ground.ts`): its cities and the sites clear of them, planned as
`planSurface` plans them on the natural ground, at the system's tier; the ground levelled under them (`params.pads`, set
on the terrain sampler the workers and the server sample); and each site's clearance. Dens join it, with their levelled
pads, only once dens are drawn (`DENS_DRAWN`, which P1.E14.T10 turns on with the den art); until then no machine plans
them into the drawn ground. The client's `Planet` plans with it at the tier its `SolarSystem` was built for, its `Flora`
scatters on that planet's ground, and the server's resource nodes (P1.E13.T01) call the same function.

A den's place depends on who lives in it (P1.E08.T03): `planDens` houses each den with one of the world's own species,
its whole list (`faunaSpecies(params, FAUNA_MAX_TIER)`, worked out inside the shared planner, so no caller passes it or
can leave it out; the list at any tier is a prefix of it, so a den's occupant never changes with the tier and a den
whose species the world does not carry yet stands empty), and a predator den is the kind its predator lives in (burrow,
nest or roost), whose footprint sets where it fits and the pad it levels. `worldSurface(params, tier)` is that whole
plan at once: the drawn ground (exactly `drawnGround`'s: the same code makes both) and every den of the tier, drawn or
not. The dens the server's fauna spawns at, the pads its ground and the client level and the sites' clearance the
resource nodes keep off all come from it (`planWorld`, §6.2): one plan, tested to agree.

Resource nodes (P1.E13.T02, `world/resourceNodes.ts`) are the spec's to place: `planetNodeLayers(params, tier)` says which
node types a world carries, and `scatterNodes(ground, layers, cell)` places the nodes of one ~64 m cell (`nodeCellLevel`,
`nodeCellsNear`) on the drawn ground, off the pads and outside every site's clearance, in deterministic math only, so the
server and every browser engine place the same nodes bit for bit (the cross-engine smoke compares them). A node's id is
`face_i_j_type_k` (`nodeKey`; `parseNodeKey` reads it back). The client clears its own flora round sites and landed
ships, but never a node: the nodes it hides are the ones mined (locally until P1.E13.T06 hides harvested nodes, and any
under a landed ship, from the server's `nodes` state, §18).

## 13. Social: chat and parties

DESIGN 16.6's "Social" row and DESIGN 17: shard-wide chat and parties, for three players or three thousand. `social/`
holds it (`SocialService`, made by the gateway): the gateway tells it which character joined (with its name) and which
connection closed, and hands it `chat` and `party` requests from joined sessions. A timer of its own runs every 100 ms:
it lapses invites and refreshes the parties due, each party once a second (`refreshMs`) with the round spread over the
ticks between, so a thousand parties cost a tenth of their round per tick; one party whose refresh fails is logged and
skipped. Nothing social is persisted in Phase 1: parties, invites and mutes live in memory and end with the process;
every chat line, mute and party change goes to the server log for moderation.

- **Who is online** is the joined session holding each character, by id and by name ignoring case (names are unique
  ignoring case). A character entering again from a new connection replaces its old session, so the old one's close
  changes nothing.
- **Chat** (`chat {channel, text}`, protocol 3): `shard` reaches everyone online, `system` everyone whose entity is in
  the sender's star system's zone, `party` the sender's party wherever its members are; the sender hears its own line
  back. The schema refuses blank, over-long (280 UTF-16 units) and control-laden text (§5); the server trims it and
  relays `event {kind: 'chat', channel, from, text, at}` with its own name for the sender and world time, encoded once
  and written to every recipient (`Session.sendText`; never serialised per recipient). A system line goes through an
  index of who is online in each zone (kept on join, `moved` and close, checked as it is read and against the roster
  once a second), never a scan of the shard. Limits (`social/limits.ts`), all per account so its sockets share them: 5
  messages at once, then 1 a second; past that, 10 refused messages (refilled at one per 3 s) and the account is muted
  for 60 s. The shard channel has one limit for the whole shard (20 at once, then 10 a second), so a crowded shard stays
  readable and its fan-out bounded. `SocialService.mute(account, seconds, reason)` mutes by hand. Refusals go to the
  sender only as `denied {of: 'chat', code}`: `rate`, `busy` (shard limit) and `muted` with `retryS`, `no_party`,
  `no_zone`.
- **Parties** (`party {op}`, protocol 3; `op` is `invite {name}`, `accept {name}`, `decline {name}`, `leave`, `kick
  {name}`, `promote {name}`, naming characters as typed): up to `PARTY_MAX` (6) characters with a leader. Any member
  invites an online character in no party; the invite lapses after 60 s (both hear `expired`), and an account sends 5 at
  once, then one per 10 s; a character holds at most 8. Accepting joins the inviter's party as it is then (refused while
  it is full; the invite stands until it lapses), or a new party the inviter leads; joining spends the other invites a
  character held. Only the leader kicks and promotes, and it promotes only a member who is online. When the leader
  leaves, the longest-standing member online leads (the longest-standing of all when none is); a party left with one
  member disbands. A member whose connection drops is shown offline and keeps its place for the grace (15 s, the phases'
  grace, checked at its party's next refresh, so within a second after); its character entering again in time takes it
  back, and past the grace it leaves the party (the lead handed on if it led). A zone handoff changes nothing:
  membership is the character's. A member kicked or gone from the party while its connection was down comes back in
  none, so its kept place in the party's story phase is given up (§6.1).
- **Party tags**: every member's zone entity carries its party's id (`zone.setParty`), set on every change and on
  joining and checked at each refresh, so a new entity (a handoff, a respawn) gets it within a second, or at once when
  the handoff calls `SocialService.moved(session)`. That is what puts members in each other's interest sets anywhere in
  a zone (§6) and in one story phase through `phaseFor` (§6.1); `SocialService.partyIdOf(character)` gives the id to
  pass as `partyId`.
- **Call-for-aid beacons** are the social service's too (`social/beacons.ts`, §21): an instance's open slots listed to
  the shard, and answering one joins it (a story instance's answer joins the caller's party, `Parties.joinWith`).
- **Party state** `party {party: {leader, members: [{name, online, system, health}]} | null}`: members in join order,
  each one's galaxy system and health in tenths (null while offline); sent after `welcome`, to every online member
  whenever it changes, and null to one who leaves. At each refresh it is rebuilt, compared as plain JSON and encoded
  once only when it changed. An hp that is not a finite number shows as whole and is logged once. Party news, `event
  {kind: 'party', what, name?}`, goes to whom it concerns: `invite`, `invited`, `declined`, `expired`, `joined`, `left`,
  `kicked`, `leader`, `disbanded`. Refusals, `denied {of: <op>, code, name?}`: `no_party`, `not_leader`, `not_found`,
  `self`, `in_party`, `party_full`, `pending`, `no_invite`, `not_member`, `offline` (promote names a member whose
  connection is down), `gone` (the inviter is offline in no party), `busy` (the invitee holds 8 invites), `rate` with
  `retryS`.
- **The client** (P1.E15.T03, `packages/client/src/ui/social/`): `SocialModel` (`model.js`) keeps what the server sent
  (the log of chat lines, party and beacon news and refusals, the party, the invites waiting, a mute) and makes the
  requests; `SocialUI` draws it into the HUD. The chat panel sits bottom left: closed, each new line (of any channel)
  rises in on a plate of its own, the lines above easing up to make room, and fades out of the way 10 s later (4 s after
  the panel closes), as the location line's objective settles; Enter (or `/`) opens it as the HUD overlay `chat` (Esc
  closes it like any menu, and the mouse is freed so the party frame's and the beacon list's buttons take clicks), with
  tabs for shard, system, party and the beacons (§21), the tab's log and an input that Enter sends from, closing the
  panel; the feed cross-fades into the log where its lines stand. Slash commands carry only what the server does: `/s`,
  `/sys`, `/p` (switch channel, sending what follows), `/invite`, `/accept` and `/decline` (the newest invite when no
  name is given), `/leave`, `/promote`, `/kick`, and `/help`; a line the protocol would refuse (ChatText, CharacterName)
  is refused there with a reason. Chat is paced as the server paces it (5 at once, then 1 a second; a line that did not
  go spends nothing), so a fast typist is told to slow down, the text kept, before the server would count it towards a
  mute. A refused chat line or party request is a line in words in the log; a beacon request's refusal shows under its
  beacon, or under the player's own (§21), and a watch refused for its rate is asked again quietly; a mute is held for
  its `retryS`, the input's hint counting it down. The party frame sits under the location line: members in join order,
  the leader's amber mark, health (the entity's `hp` while it is in view, else the state's tenths), and where an absent
  member is (offline, another system); while the panel is open, invite by name and leave, and for the leader promote and
  remove per member. Invites waiting are cards there with their minute running down. Each change moves one box
  (`motion.js`, stepped every frame on the HUD clock: a whole pixel, at least one a frame, landing where it lays out);
  what goes fades out before anything moves over where it was, and what comes fades in as it grows. World markers are
  hidden under (or left of) the party frame, the invite cards and the open panel, but for hostiles and the player's own
  ship (`hud.social.covers(x, y, kind)`); `covers()` with no arguments gives those panels' boxes, which remote entities'
  pilot markers keep out of (P1.E04.T02). Whatever a player or the server wrote goes into the page as text, never as
  markup.

## 14. Skills (`packages/server/src/skills`, `@astra/shared/skills`)

DESIGN 9.1's web, held by the server (P1.E07.T01). The node table (132 nodes, 152 points to own them all) is
`@astra/shared/data`; the per-character value and its rules are `@astra/shared/skills`, pure functions both ends run.

- **State** (`SkillState`): `granted` (points beyond levels: story chapters, faction chains,
  grants), `unlocked` and `bought` (node ids in the order it happened; bought ⊆ unlocked), `fragments` (per fragment branch,
  Gravitic, Thermal, Resonance, Symbiotic and Void, `{earned, spent}`; never inventory items, DESIGN 15.2) and `slots`
  (`ground`: 6, keys 1–6; `ship`: 5, the roomiest hull's ability slots). The level is never stored: progress owns it, and
  points are `level × 1 + granted − Σ pointCost(bought)`. Nor is the hull: the ship bar works as many slots as the flown
  hull's `abilitySlots` (Lark 2). The schema refuses unknown or repeated ids, a bought node not unlocked, a slotted node not
  owned or on the wrong bar, and a ledger that spent more than it earned; `skillStateProblem(state, web)` refuses, for a
  web (this build's unless given), an unknown node, a bar not the web's size or holding another bar's node, and an owned
  node whose prerequisites are not owned. A new character (or one saved before skills existed) starts with its people's
  node unlocked (DESIGN 5.1), still bought with a point; a load adds it if missing.
- **Stored** (`StoredSkills`, the `skills` component, `v` 2, `stored.ts`; P1.E07.T15): the state plus `web`, the skill
  web's data version it was stored under (`SKILL_WEB_VERSION`, raised with any change to a node's id, branch, tier, bar or
  prerequisites or to a bar's size; a test pins the web each version names), and `paid`, what each unlock bought with
  fragments paid (`{node: {branch, count}}`; other routes pay nothing). Neither is sent to the client. The service keeps
  `paid` beside the state (the `unlock` request records it) and `stored(id)` is what the component saves. v1 values (the
  state alone) migrate to web 0 with `paid` read from the ledger: each fragment-routed unlock, in order, credited its
  tier's fragments while its branch's `spent` lasts, a people's free node (Second Lung, Pulse) only after every other
  node. The schema checks structure only (`structureProblems`, and `paid` ⊆ unlocked with no more paid per branch than
  spent). An admin edit reads and writes this stored form (`skillStateOf`, `storedSkills`), reconciled as a join reads it.
- **Reconcile** (`reconcileSkills(stored, web)`, the component's `reconcile`, at decode, so the ship, the inventory and an
  edit read the result): a value stored under this web or an older one is brought in line with this build's web; one
  already in line comes back unchanged. A node the web does not have (renamed to a new id, or removed) is dropped from
  the unlocks, the owned nodes and the bars, and the fragments its unlock paid go back to its branch (`spent` less
  them); an owned node left without a prerequisite (re-tiered, moved branch, its support gone) is refunded, repeatedly
  until every kept node has its own, listed deepest first (capstones, Tier III and conjunctions, II, I; the later bought
  first among equals); the unlock and what it paid stay. Each bar is resized to the web's (padded or cut) and loses a
  node no longer owned, on the other bar now, or past its end. Points need nothing: they count owned nodes. One warning
  per character lists the changes (`{from, to, changes}`), and the result is written back at the next save. Only a value
  whose structure no web explains, or one stored under a newer web (a server rolled back must not strip nodes it does
  not know), refuses the join. A refunded Pack Mule leaves the ship a pod without a bay: the ship component gives it
  back (§8), and the inventory re-lays out, or keeps its saved layout and every item, logged.
- **The view** sent to the client, `{state, level, shipSlots, met, maxTier}`: `met` is the web's standing gates the
  character meets (`WEB_REQUIREMENTS`: Void's Free Reaches rank) and `maxTier` the server's phase ceiling, so
  `contextOf(view)` lets the client predict every rule.
- **Phase ceiling** (`SKILL_PHASE.maxTier`, 2 in Phase 1; IMPLEMENTATION_PLAN 0.8): `phaseTierOf` ranks Tier I–III by
  number, conjunctions with Tier III and capstones at 4. Nothing above the ceiling is unlocked (by any route, the
  developer's included) or bought: `phase`. The data stays whole; what is owned stays owned, slotted and refundable. The
  service's `maxTier` raises it (Phase 2, tests of Tier III such as Pack Mule).
- **Rules** (`rules.ts`): `unlockWithFragments` spends the node's tier's fragments of its branch (I 1, II 3, III 6; Pilot,
  Exo-suit, capstones and conjunctions have no fragment route); `unlockVia(source)` unlocks from the world only by a route
  the node lists (a trainer that teaches it, a chapter at or past a capstone's, a discovery for a conjunction, its quest,
  its people; `dev` for the CLI); `buyNode` needs the node unlocked and not owned, the tier's level (I 1, II 15, III 30,
  capstone 45, conjunction 15), one owned node of the tier below in the branch (any; Tier II of both branches for a
  conjunction; a Tier III for a capstone), an augment's target, the standing gate and the points; `slotNode` puts an owned
  active on its own bar (`node.slot`: heat and resource costs on the ground bar, Charge on the ship bar; passives and
  augments are always on) at a working slot, swapping a node already on the bar; `unslotNode` empties any slot;
  `respecNodes` refunds owned nodes when every node kept keeps its prerequisites, clears them off the bars, and names its
  price (500 units a point) and trainers (a Chorus listener; for Void nodes a Free Reaches quartermaster). Unlocks and
  spent fragments stay spent.
- **SkillService** (`service.ts`) holds the characters in play (persistence opens, saves and closes them as it does the
  inventory) and answers `request(id, seq, op)` with the shared rule plus what only it knows, through `hooks` that later
  tasks answer: `trainerAtHand` (NPC trainers, P1.E09.T05/P1.E07.T13; none until then), `inCombat` (P1.E06.T02; slots swap
  only out of combat) and `meets` (Void's flag, P1.E07.T08; reputation in Phase 2). A buy or respec that changes the
  inventory's layout (Pack Mule: `suit.stack_max` 15000 and one more cargo bay, which takes a pod aboard the ship or gives
  back only a pod the ship no longer has a bay for) re-lays the inventory out through `InventoryService.setLoadout` and
  sets the ship's `cargoPods`. The layout and a respec's charge are one transaction: both are tried on the inventory as it
  stands with the shared `applyLayout` and `spendUnits`, and made only when both pass, so `no_room` (as a hull change
  is) and `units` change nothing. Server-side calls: `grantPoints`, `setPoints` (the CLI's "set skill points": never below what levels give less
  what is spent), `grantFragments` (P1.E07.T11 decides the count: Listener, Uncounted), `unlock(id, node, source)`,
  `buy`, `respec`, and `refresh` when the level or the hull changes. `owned(id)` is what `shipStats`, movement authority's
  profile, abilities and meters read; `subscribe` hears every change (`request` or `server`), and the gateway pushes the
  `server` ones.
- **Wiring**: `coreRegistry` makes the service over the same inventory, ship and progress holders unless one is given, and
  registers its component after `progress` and before `ship`; the gateway takes the one in persistence's registry
  (`skillServiceIn`) unless given one, and exposes it as `ws.skills`.

## 15. Cutscenes

DESIGN 8's cutscenes play in-engine, always in a phase (DESIGN 14.1, 17), on the camera-glide system (19.2). The server
decides when one plays; the client presents it.

- **Authoring** (`assets/blend/cutscenes/<name>.blend`, one cutscene a file): scene custom properties `cutscene` (its
  id, a-z, 0-9 and `_`), `frame` (`station`, `home`, `body:<n>`, `inertial` or `player`), `anchor` (`origin`: the
  frame's coordinates; `player`: relative to the player's pose when it starts, the ship at the origin nose along +Y;
  the inertial and player frames anchor on the player) and `radius` (the phase's volume, 3000 m by default); cameras
  `CAM_<cutscene>_<shot>`, each moved however the artist likes (a Follow Path on its curve `CAM_<cutscene>_<shot>_path`,
  a Track To, keyed lenses), cut between by timeline markers bound to them; markers `line:<key>`, `end:<key>` and
  `event:<name>`, their words in a Text block `CUT_<cutscene>` (JSON: lines' speaker, voice and text; banners' title
  and sub); actors as empties `ACTOR_<name>` (`kind` npc, ship or prop, `label`, optional `hull`); an optional empty
  `STAGE_player` where the dev scenario puts the player's ship. The render resolution is the framing (2.39:1 for the
  letterbox); the frame range at the scene's rate is its length.
- **Checks and export** (`packages/tools/blender/export_cutscene.py`, headless; `-- --selftest`): every rule the
  client's `parseCutscene` applies, and the marker grammar, are checked first, and every problem is listed (an unknown
  or wrong-case marker kind, an `end:` with no line, a key or name used twice or empty, a banner with no title or no
  event, a marker outside the frame range, an id or frame the client refuses, a bad actor). `pnpm art:validate` runs
  the same checks on the family `cutscenes` (families.json kind `cutscene`; the mesh checks do not apply), and a change
  to the exporter re-validates only that family. The export writes `packages/client/public/cutscenes/<id>.json` (format
  `astra.cutscene` 1: each shot the evaluated camera at every frame, in the engine's axes, with the vertical field of
  view of the render framing; lines with times and lengths, a line without an end marker running its reading time cut
  short by the next; events with optional banners; the space; the stage) and, from the same source, the server's
  `packages/server/src/cutscenes/placements/<id>.json` (`astra.cutscene.place` 1: the space, the length, the radius and
  the actors' poses). It never writes outside its output folders.
- **Who and when (the server):** `CutsceneService` (`packages/server/src/cutscenes/`, built by server.ts, reached by the
  gateway's `cutscene` case) answers a client's `cutscene request` only when `may(session, id)` allows it: the quest
  engine (P1.E09.T01) sets `may` to its rule (the character is on that cutscene step) and starts its steps' cutscenes
  itself with `start(session, id, at)` at the step's place; until it does nothing may, but a catalog entry marked `dev`
  on a development server (`NODE_ENV` not production), so the test cutscene can never start in production. A session
  asks at most once every 10 s (`COOLDOWN_S`). Asking again for the one it is watching answers with the same phase only
  while that one is still going (its phase open, the player in it, within its bound); otherwise the request goes
  through `may` and the cooldown again, so a step's cutscene cannot be replayed after its step. A cutscene the server
  starts itself (`start`, the quest engine) is pushed to the client as an unrequested `play`.
- **Where (the server):** a cutscene plays at its place. Anchored on its frame's origin, the place is that origin and
  the player must be within the radius (`refused place` otherwise); anchored on the player, it is where the player is,
  in the cutscene's frame, which must be the player's. The story phase is keyed by the cutscene and its place
  (`cutscene:<id>@<frame>`, or `…#<n>` for each player-anchored place), so a party member shares a member's phase only
  at the same place (within its radius): one far away gets its own. A player already in a phase (a bay, an event,
  another step) is refused (`refused phase`), never pulled out; the quest engine's `at` is the step's own place, so a
  step's cutscene plays in the step's phase. The actors spawn once into the phase, in the cutscene's frame at their
  exported poses (turned with the anchor when it is the player), seen only by the phase's members; `done` takes the
  player out, and the last one out closes the phase with its actors. A session that leaves (its socket closes, it is
  kicked, its entity goes, a handoff, P1.E04.T04) is forgotten. `plays(zone, phase)` says whether cutscenes play in an
  open phase (one the service has played in, whatever its key), which no call-for-aid beacon may be raised in (§21).
- **Out of play:** while a player watches, `cutscenes.watching(zone, entity)` is true and the client pauses the
  player's local hazards (pirate raids, the suit's survival damage). The server bounds it: only while the player is in
  the cutscene's phase, and no longer than the cutscene's length, the client's 1.5 s exit and a 5 s margin. Past either,
  the service's sweep (once a second, and before each request) ends the cutscene on the server, takes the player out of
  its phase if it is still in it, and pushes `ended` to the client, which ends it there as a skip. The sweep also forgets
  the anchor poses of phases that have closed, however they closed. The server's fauna (§6.2) leaves alone a player
  `phases.hiddenFromShared` hides; it must treat a watching player the same way (neither prey, intruder nor threat).
  That is a follow-up outside the cutscene code: `fauna/sim.ts`'s `Actor.hidden` should also be true while
  `cutscenes.watching(zone.id, id)`, the zone being given a way to ask the service.
- **The client's link** (`packages/client/src/cutscene/link.js`): online (`game.net`, P1.E04.T01's Net) a cutscene asks
  through `NetCutsceneLink` (`net.send` and `net.on('cutscene')`) and plays only on `play`, in the phase it names; a
  refusal, no answer within 5 s or a dropped connection plays nothing, and a `play` that comes too late for a request it gave up on is given back
  with `done`. Every `done` says how it ended: `finished`, `skipped`, or `returned` for every give-back. The link is made as the game goes online (`enterWorld` calls `cutscenes.linkFor()`), so it hears a
  `play` before the client has asked for anything. An unrequested `play` is a cutscene the server started itself (a quest
  step's): it plays, and its `done` goes back as usual (one that cannot play now, another playing among them, is given
  back at once, and the one playing stays the one playing). The server ending the one playing (`ended`)
  ends it here as a skip. `OfflineCutsceneLink` (a local
  layer, phase null, the messages it would have sent kept) is the dev sandbox's only: with no `game.net`, in a dev
  build.
- **Playback** (`packages/client/src/cutscene/`): `CutscenePlayer` loads and checks a definition (`timeline.js`), asks
  its link, then runs a `Timeline` on game time (so `window.step` and captures are exact): the clock, the lines' reveal
  and fades, events in order. `CameraDirector` (the camera-glide system, with the demo's chase-view eases, seat glides
  and dips) takes the camera: it glides from the player's view into the first shot (a dip when more than 600 m apart,
  from the cockpit seat, or asked for), plays the shots on a spline through the samples (`curve.js`) expressed in the
  cutscene's frame so they follow it as it orbits (`space.js`), and glides back to the player's view at the end. The
  canvas's field of view is widened so the band between the letterbox bars shows exactly what Blender framed.
  `ui/Cinematic.js` draws the letterbox and the dialogue bar each frame; events' banners go to `HUD.showBanner` as a
  title card in the top bar (`{station}`, `{system}`, `{home}`, `{planet}` filled in, set as text, never markup), and
  listeners (`cutscenes.on('event' | 'line' | 'start' | 'end')`) hear every event.
- **Controls:** while one plays `game.overlay` is `'cutscene'`, so the player's controls are locked as under a menu.
  Space, Enter or a click reveals the rest of a line, then jumps to the next behind a dip. Esc skips in one press: it
  closes overlays (Menus.closeAll), and under pointer lock, where the browser takes Esc to release the lock and the page
  never sees the key, the release itself (with the window focused) skips. A jump or a skip fires every event it passes
  (a skip's marked `skipped`, without banners), so whatever listens ends where watching would have left it. The
  cutscene keeps the screen and the controls while the camera glides home (1.5 s), then gives them back; a pointer
  lock that Esc released brings up the pause screen then, as after any Esc, until a click.
- **Dev:** `#cutscene:<id>` stages the ship (`CutscenePlayer.stage`, dev builds only) and plays it; `pnpm capture --
  --ui cutscene-test` (and `cutscene-test-jump`, `cutscene-test-skip`) grab the grader's stills and clips;
  `packages/tools/src/smoke/cutscene.spec.ts` plays the test cutscene end to end, skips it, and plays it through a
  stand-in Net (asked for, refused, and started by the server); `cutscene-online.spec.ts` plays it through the real Net
  against a local server (online.ts), its tug seen in the snapshots while the player watches and gone after `done`.

## 16. Developer tooling (`packages/server/src/admin`, `src/cli`, `gateway/devLogin.ts`)

P1.E03.T07. Configured by ASTRA_* variables (`admin/config.ts`, read beside `config.ts` from the environment and the
repository's `.env`): `ASTRA_DEV_LOGIN`, `ASTRA_ADMIN_SECRET`, `ASTRA_ADMIN_PORT` (8788), `ASTRA_ADMIN_IN_PRODUCTION`
and `ASTRA_METRICS_S` (10; 0 turns the zone metrics log off, §6). Dev tools are unreachable in production
(IMPLEMENTATION_PLAN 0.3): a server with `NODE_ENV=production` refuses to start with the dev login on, and with an admin
secret unless `ASTRA_ADMIN_IN_PRODUCTION=1` and the secret has 32+ characters; with `NODE_ENV` unset it serves the dev
login only on a loopback `HOST` (as `config.ts` allows the dev JWT secret). Secrets may not hold whitespace (they travel
as Bearer tokens).

- **Dev login** (`POST /auth/dev {name, people?}`, served only with `ASTRA_DEV_LOGIN=1` outside production; otherwise the
  path does not exist, 404). Signs in to the account `dev-<name>` (`name`: 1–20 of `[A-Za-z0-9_-]`, any case) without a
  password, making it on first use with a random password nobody knows, and with it a character "Dev <Name>" (three
  letters added on a name clash; the reserved word marks it as a dev character, and only this route bypasses the name
  rules) of `people` (thalune by default; another people's gets a character of its own). It answers `{token, accountId,
  character, created}`, so a client dev scenario (`?dev#foot`, `?dev#fly`, …; P1.E04.T05, §9) goes through the real server in one
  request: dev login, then `hello` with the token and `join` the character. Rate-limited with `/auth/*`; every dev login is
  logged at warn. Only `dev-` accounts are reachable this way, and registration refuses `dev-` usernames (§5), so no
  player's account is.
- **The admin channel** (`admin/channel.ts`): with `ASTRA_ADMIN_SECRET` (16+ characters) set, an HTTP listener of its own
  on 127.0.0.1:`ASTRA_ADMIN_PORT`, never the game's port or host, taking `POST /admin/command {command}` with
  `Authorization: Bearer <secret>`. Requests from anywhere but loopback, with an `Origin` (a browser), or without the
  secret are refused and logged. `GET /admin/health` answers `{service: 'astra-admin', version: 1}` without the secret.
  Commands are zod-validated (`admin/commands.ts`) and run by the admin service, which
  logs each one (`admin command`) with the operator the CLI names (`x-astra-operator`, `$USER` by default), how it came,
  what it asked and how it ended. Answers: `{ok: true, result}` or `{ok: false, error, message}` with `error` one of
  `usage`, `not_found`, `needs_server`, `unavailable`, `held`, `busy`, `invalid`, `refused`, `conflict`, `failed`.
- **The CLI** (`pnpm --filter @astra/server cli -- [--json] [--direct [--force]] [--url u] [--operator who] <command>`;
  `--help` lists them). It sends the secret only to a loopback `http:` URL (`--url`, `ASTRA_ADMIN_URL`, else
  127.0.0.1:`ASTRA_ADMIN_PORT`; anything else is refused as usage) that first answers `GET /admin/health` as above, so
  an unrelated program that happens to hold the port never sees it (a hostile local process could copy the public
  health answer; the secret is a guard against accidents and remote callers, not against code already on the machine). Commands: `who`, `zones`, `metrics`; `teleport <character> <system> <frame> <pose> [mode=…]`; `grant <character>
  <item|resource|units> <n>` (negative takes away, all or nothing); `spawn <system> herd species=<i> [count] [level]
  (near=<character> | body=<i> at=<x,y,z>)` (FaunaSim.spawnHerd, §6.2) and `spawn <system> entity kind=npc|prop
  frame=<f> at=<x,y,z> [name]`, `despawn <system> <entity>` (not players or creatures), both only in a loaded zone;
  `set-quest-step <character> <quest> <step>`; `set-skill-points <character> <n>` (SkillService.setPoints, §14);
  `set-rep <character> <faction> <value>` (standing 0–1000, `ReputationService.set` in play, `setStanding` out of it, §24);
  `mute <account> [seconds]` (3,600 by default, a week at most) and `unmute <account>` (SocialService, §13); `rename
  <species|body|site> <key> <name|--clear>` (a first find's name, §25: the filter's rules but the reserved names hold;
  `--clear` gives it its procedural name for good; a name of several words may come unquoted). Characters
  and accounts are named by id or by name, ignoring case. Frames are `station`, `inertial`, a body index or a frame id;
  poses are `docked` (station frame), `orbit[:alt]` (above a body's sea level along +x, by default a quarter of its
  radius and at least 2 km; or out from the Waystation along +z), `surface[:lat,lon]` (on a rocky body's drawn ground,
  §12, 2 m up, on foot; y is the pole; default 20°, 0°) or `x,y,z` metres in the frame (in a ship); every pose is checked
  as a saved one is (`poseProblem`) and against the system's frames. Exit codes: 0, 1 refused or failed, 2 usage, 3 no
  server to talk to.
- **In play or out.** A character a joined session holds is changed through the live services, so authority holds and
  its client hears the usual messages: a teleport in its zone patches its entity and sends `correction` at its last
  input's `seq` (once movement authority, P1.E03.T04, is on main, the teleport must also re-seat the mover there: the
  seam is marked in `AdminService.moveInZone`); a grant goes through the inventory service (pushed `inventory`), skill
  points through the skill service (pushed `skills`); each is then saved at once (`saveNow(id, 'admin')`). A character out of
  play is changed by `persistence.edit` (§8) with the same shared rules (the inventory laid out for its ship and nodes,
  `addItem`/`takeItem`/`addUnits`/`spendUnits`, `setAvailablePoints`, the pose), and its next join loads it. A
  character held by the save of its leave is waited for (up to 3 s) rather than refused. `mute` and the world commands
  need the running server. `set-quest-step` goes through the quest runtime's `QuestAdmin` (§17, `quests/admin.ts`): in
  play `setStep` moves the quest (pushed `quests`), out of play `setStepStored` moves it in the stored log.
- **Teleporting a character in play to another system** (until zone handoff, P1.E04.T04, replaces it with a real
  handoff): the client cannot follow a `zone` message yet, so the server takes the character out of play and saves it at
  the new placement through the same edit as one out of play (`persistence.edit(…, {leaving: session})`: its leave is
  captured and written, then the pose, its joins held throughout), takes its entity out of its zone, stops handling the
  session's messages (its inputs in the old system's frames are no strikes) and closes the socket without a refusal
  (code 4001, `MOVED_CLOSE_CODE`). The client's Net reconnects as after any dropped connection, and its welcome places
  it where the server now holds it (`Game.onWelcome`, §9).
- **Direct mode** (`--direct`): with no server running, teleport, grant, set-quest-step, set-skill-points, set-rep and
  rename (on the default shard's `discoveries`) run in the CLI itself against `DATABASE_URL`, through the same admin
  service and `persistence.edit`, printing their audit lines on stderr. One process holds a character at a time (§8), so direct mode is refused while anything answers at the
  server's `HOST:PORT/health`; for a character saved in the last 60 s (`saved_at`: a server elsewhere on the same
  database may hold it; an edit counts as a save too) unless `--force`; and in production unless
  `ASTRA_ADMIN_IN_PRODUCTION=1`.

## 17. Quests

DESIGN 14.1, P1.E09.T01. A quest is data (`@astra/shared/quests`, `QUESTS` in `catalog.ts`, validated by
`questDefSchema`): id, title, category (DESIGN 14.2), chapter for the main story, tier, giver (`npc:…`, `terminal:…`,
`monolith:…`, `board:…`), `auto` (started for every character that can take it: First Jobs, the demo's guided path),
prerequisites (level, chapter, quests, flags, not-flags, people, faction rank), steps, rewards, flags set on completion
and a repeat rule (`once`, `daily` by world-time day, `{cooldownS}`). Steps are the fifteen types of DESIGN 14.1, each with
its parameters; things in the world are named as targets `kind:id[:id…]`, matched exactly or under a `:*` prefix.
Steps go on to the next, or to a later `next` (a choice's options each name one); they only go forward, so entering a
step already met (a collect step with the goods in the suit) finishes it at once and a quest always ends. While an
optional step is current the step after it is live too (its events, its delivery, its answer, its phase), and finishing
that one skips the optional step; an optional step cannot itself be instanced. Counting steps count in a quest-level
counter (`counter`, default the step's id), so two steps can share one (Forty Names' 20 and 40 logs).

- **The engine** (`QuestBook`, `engine.ts`) is pure: one character's quest state, changed in place by `start`, `offer`
  and `accept`, `autoStart`, `apply(event)`, `choose` (a dialogue answer or a fork, on a live step; an answer it does not
  offer is refused) and `abandon` (never the main story), each returning notes (started, progress, step, completed,
  failed, abandoned, reward, pruned) for its caller to act on. It is told the world time, the character, the system it
  is in (with its tier), where it is and what it holds (`QuestContext`). Events (`world.ts`): `tick {dt, at}` (where the
  character is: system, frame, body, height above the radius, above the air or not, mode), `held {items}`, and from the
  systems that see them `enter {place}`, `interact {target}`, `mine {node, id?}`, `analyze {species}`, `scan {sites}`,
  `kill {tags, entity?}`, `wave {cleared}`, `defend_lost`, `escort {npc, status, progress?}`, `delivered {item, count,
  to}`, `died`, `touch {monolith}`, `cutscene_end {cutscene}`. Places (`Place`: a body's frame, the Waystation's or the
  inertial one, at its origin, a position, a point on the surface, or a spot in one of a world's cities: its plaza or its
  market, where the client draws the trade post) resolve against the shared `SystemDescription` and the shared city plan
  (`cityGround`: `planCities` and the ground levelled under them, cached per world), so both ends agree on where the
  apothecary's stall in Belost's market is, and an actor's offset there (east, up, north) stands on that ground
  (`actorPosition`).
- **The state** (the `quests` component, v2): `active` (quest id → its step by id, counters, the distinct ids counted,
  when it and its step began, the anchor of a step round the player, whether a dialogue's speaker was addressed; at most
  25), `done` (quest id → times finished and when last; bounded at 4,096: repeatable quests past their wait are forgotten
  first, then the oldest repeatable ones, and only then, logged as an error, the oldest once-only one, so saving never
  fails), `flags`, `owed` (rewards a system declined: reputation and titles held before the reputation service existed
  or while it did not hold the character, skill points and nodes the skill service refused, and items that did not fit,
  kept until claimed with `QuestRuntime.takeOwed` or a hook; owed items are retried on join, and owed reputation and
  titles settled on join, §24) and `paid`
  (per quest, the step rewards and answers' reputation already paid: kept across an abandon so taking a quest up again
  pays none of it twice, and cleared when the quest is finished, so a repeat its rule allows pays anew). v1 stored step
  indices and is migrated through the catalog (an index past the steps: the last). On load the runtime reconciles the
  state with the catalog (`reconcile`): a quest it no longer has is dropped, one whose step it no longer has starts again
  at its first step, each logged, never a refused join, and a step whose start is behind its quest's (a world clock
  that came back behind its last save after a crash) is clamped. The component's `check` (`questLogProblem`) refuses
  only what no engine path writes (a distinct id counted twice, a flag held twice): a counter a distinct-counting step
  and a holdings step share, with fewer counts than ids remembered, is the engine's own and loads.
- **The runtime** (`server/src/quests/runtime.ts`) holds a book per character in play, loaded and saved by persistence.
  Each character is ticked every 500 ms, the characters spread over a 50 ms timer in round-robin slices: a tick reads its
  entity when a live step needs it (travel, defend, survive, instanced) and applies `tick`. The inventory service's
  changes apply `held`; `event(characterId, event)` takes the rest. An `interact` with a live deliver step's `to` takes
  the goods first (`InventoryService.consume`, all or nothing; nothing for anyone else; a notice when short) and applies
  `delivered`; a `kill` naming a quest actor's entity carries its tags. Rewards: XP (`xp`, plus `levels` levels' worth
  counted at the quest's tier, else the tier of the system the character is in: DESIGN 11's level bands, `xpForLevels`)
  to its progress, levelling its entity; units and items through the inventory service; flags into the state; skill
  points and node unlocks through the skill service (`skillRewardHooks` over `skillServiceIn(registry)`: `grantPoints`,
  `unlock(…, {kind: 'quest', quest})`, and `refresh` when a quest's XP raises the level); reputation and titles through
  the reputation service's hooks with the quest (`reputationRewardHooks`, §24), else owed; rank prerequisites read its
  `rankOf`. A completion starts any auto quest it opened. Quests start by `startQuest` (dev, tests), auto quests
  on join, and `offer` then the client's `accept` (givers: the board, P1.E09.T06, and NPCs, P1.E09.T05, call `offer`).
- **Instanced steps** (`phase`): a story phase (§6.1) keyed `quest:<quest>:<scene or step>` at the step's place, or round
  where the player was when the step became live (`at: 'player'`, its anchor saved), placed under `partyIdOf`, so a party
  on the step shares one layer; the step's actors are spawned into a phase that has none. A player is placed for one step
  at a time (the one it was placed for while it holds, else the first live one whose place it is in), only when it is in
  no phase or in the one this runtime put it in (a bay, an event or a cutscene's phase is never left for a quest's), and
  re-placed only when that phase no longer holds just its party: so two quests at one place never churn phases, and a
  party that disbanded is parted, each part getting its own actors. Leaving the step (to one not in its scene) or the
  quest takes the player out.
- **Cutscene steps** play through the cutscene service (§15; wired in server.ts by `quests/cutscenes.ts`): entering one
  calls its `start(session, id, at?)`, with the step's place when it has one, the service phases the player itself, and
  its `play` is pushed to the client unrequested. The service's `may` is the runtime's `mayPlay(session, id)` (a client
  asks for a quest's cutscene only while a live step plays it), or its own development rule. A cutscene that ends, by
  the client's `done` played or skipped (the gateway, `doneEndsQuestStep`) or by the service's sweep (its `notify` of
  `ended`), calls `quests.cutsceneEnded(session, id)`, which ends the step; one the client gave back unplayed (`done`
  with `reason: 'returned'`) ends its phase and the watching but not the step, and the retry below plays it again. A live cutscene step the player is not watching is started
  again on join (and on its first tick, when its entity's world position is known) and on the tick at most every 5 s
  (`CUTSCENE_RETRY_S`): one the service refused (the player in another phase, another cutscene playing) or lost with a
  dropped connection plays once it can; the one it is watching is never started again; refusals are logged at debug
  with their reason. Rules for quest authors: a step's cutscene is one the cutscene catalog has, or the step is marked
  `planned` until its cutscene is authored (a unit test checks both ways); and a cutscene step that shares a `scene`
  with an instanced step plays in that step's phase, which already has the step's actors, so the cutscene's own actors
  are not spawned there: such a cutscene is authored to use the step's actors.
- **A development server's quest** (`cutscene_test`, `dev`): its one step plays the test cutscene, started by the
  server; on a development server a client takes it without an offer (`quest accept`), elsewhere it is an unknown quest.
  The online smoke plays it as a session's first cutscene.
- **Developer tooling** (§16): the admin service's `QuestAdmin` is `questAdmin(runtime)` (`quests/admin.ts`), so the
  CLI's `set-quest-step <character> <quest> <step>` puts the quest at that step (its index), started if it is not on,
  with no prerequisite, offer or wait asked and nothing paid for the steps passed over (`QuestBook.setStep`). The step is
  entered as any step is (its phase, its cutscene, its anchor) but not checked by the engine: in play
  (`runtime.setStep`) the runtime then checks it against what the character holds (a collect step met finishes at once)
  and sends the client `quests`; out of play (`setStepStored` through `persistence.edit`, in the server and in the
  CLI's direct mode at the shard's world time) the stored log changes and the next join and ticks check it. A step
  round the player entered where the player's position was not known (set out of play, restarted by `reconcile`) is
  anchored at its first tick. A development server's quests are unknown to the command elsewhere.
- **On the wire** (protocol 7): `quest {seq, op}` with `op` `accept {quest}`, `abandon {quest}`, `choose {quest, step,
  choice}`; `seq` counts the session's requests from 1 and must increase. The server answers each with `quests {seq,
  quests, error?}`, the whole state (`QuestView`: active without anchors, steps by id, done counts, flags, what is on
  offer), sends it after `welcome` (`seq` 0, after the party is known so a player back at a step's place returns to its
  party's phase), and pushes it with the same `seq` whenever it moves a quest itself, with `event {kind: 'quest'}`
  notices (`offered`, `accepted`, `progress` with counters, `step`, `completed`, `failed`; `step` is the step's index)
  and `notice` toasts. Errors: `stale_seq`, `unknown_quest`, `not_offered`, `prerequisites`, `active`, `done`,
  `cooldown`, `full`, `not_active`, `cannot_abandon`, `not_current`, `bad_choice`, `not_open`.
- **The client** shows the objective line under the location panel from a `QuestBook` (`Game.objectives`): online, `Net`
  passes each `quests` message to `book.receive`, a new objective is announced and a completed quest's event toasts, and
  `game.questRequest(op)` sends `quest` requests (the journal and the dialogue bar, P1.E09.T03, call it); in the dev
  sandbox the shared engine fills the book from the game's own state and events twice a second. Boards' generated jobs
  (P1.E09.T06) will need their definitions on the wire, since the client knows only the catalog's.

## 18. Resources (`packages/server/src/resources`)

DESIGN 15.3, 16.6 "Resources", P1.E13.T01. Resource nodes are the shared spec's (§12): every machine places them from
the seeds, the server holds only what players did to them, the same for everyone, and the client draws the scatter less
what the server says is gone (P1.E13.T06). The gateway makes the `ResourceService` (`ws.resources`), hands it `mine`
requests and starts its timer.

- **Nodes are not entities.** A cell's nodes are scattered (`scatterNodes` over `drawnGround` at the zone's tier) only
  when a hit names one of them, and kept (4,096 cells, most recently used). The ground is fauna's (§6.2): its planner
  plans each world once in its worker thread, and the plan carries the sites' clearance beside the pads (`planGround`),
  so a fauna `Ground` also serves the nodes (`Ground.nodes`, `resources/ground.ts`); the 16 worlds most recently asked for
  keep it, and a world's is asked for as a player arrives on it. A touched node (`nodes.ts`) holds its hp, the damage each
  character did (every character that hit it: those in reach bound how many), and when it heals (`HEAL_S`, 60 s after its
  last hit) or grows back (`RESPAWN_S`: a plant 3 min, a deposit 5, a formation 8; `respawnSeconds` overrides it). At
  most 100,000 touched nodes over every world: past that the one due soonest comes back early. Node state is in memory
  only; a restart brings every node back.
- **A hit**, cheapest checks first, so a client spamming far nodes costs little: `stale_seq`; `rate` (8 hits at once per
  character, 8 a second); `stale` (stamped more than 3 s from the server's clock); `zone`; `mode` (on foot, as the zone
  entity has it: movement authority's believed mode once P1.E03.T04 lands); `world` (the frame is the player's, a rocky
  world); `unknown` (`parseNodeKey`: a cell on the world's grid, a type the world carries at its tier); `range` before
  any terrain is sampled (the cell's centre further than reach and a cell); `busy` (the ground is still being planned);
  `unknown` (no such candidate in the scatter); `harvested`; `range` (35 m from the player's position to the node: the
  client's 30 m beam and 5 m for the eye, the node's size and a pose a tick old); `los` (the ground sampled every 2 m
  along the beam from the eye, 1.6 m up, to the node, its ends skipped, blocked where the beam runs 0.75 m under it; rocks,
  trees and buildings do not block); `heat` (`beam(character, seconds)`: given Heat's meter service as `meters`
  (P1.E07.T02), a hit counts only while `meters.beamActive(character, now)` says the beam is firing, its button held
  and out of the overheat lockout, so hits sent with the button off never mine; without it, as until Heat is wired into
  the gateway's `ResourceService`, the beam never overheats on the server).
- **Beam time.** A hit is worth the time since the character's last hit that counted, at most 0.5 s (an honest client
  sends one every 0.25 s), at the multitool's 1.6 hp a second (× 1.5 on minerals with a node flagged
  `deposits_break_faster`, Hot Hands). However fast a client sends, a character mines no faster than one beam held on
  continuously; nodes and flora share that one beam.
- **Breaking.** The node's yield is rolled once and split by the damage each character did (whole units, largest
  remainders first, ties to the first to hit it; `splitByDamage`), so a token hit earns a token share (nothing, a few
  thousandths of a node) and the one who did the work takes the rest; each share × the character's `mining.yield`
  (Optical Drill, Hot Hands) and granted into its
  inventory: what does not fit is reported (`added` below `count`), not kept, and a character out of play loses its
  share. The breaker's answer carries its share; every other contributor in the zone is sent `mine {seq: 0, result:
  'depleted', …}`; the inventory is pushed as for any server-side grant. `subscribe(fn)` hears every share
  (`MinedEvent`: character, zone, frame, node or null, type or flora kind, resource, count, added, `broke`); the gateway
  passes each to the quest runtime (§17) as `questMineEvent(e)`: `mine {node: <type>, id: <frame>/<node>}` for a node
  share worth something, so a `mine` step counts distinct nodes (one grown back is the same node), and nothing for
  flora, whose carbon and ferrite count through `collect` steps.
- **Common flora** (trees, giant growths, shrubs, ferns, crystal growths, boulders, rocks: carbon and ferrite) is each
  client's own scatter, not shared nodes. A hit names `flora {kind, ref, at}`: the world must grow that kind
  (`floraGrows`), `at` must be within 8 m of the ground and in range and sight, the same beam time breaks it
  (`FLORA_HARVEST`'s hp, the client's numbers) and its yield is granted; the last 256 keys a character broke are refused
  `harvested`, and so is flora past a budget per patch of ground, counted in hp so a giant growth costs six rocks (24 hp
  an hour to a character in any 10 m patch; the client's flora holds about 6 hp to a patch, up to about 18 in a clump).
  Its place cannot be checked against a scatter the server does not have, but its rate is bounded as a node's is (per
  beam-second, as much as an honest player breaking rocks, far below a deposit's worth), and a modified client standing
  still and naming plants that are not there gets about 7,500 units an hour from the ~40 patches in its reach, the same
  whether it names rocks, boulders or giant growths: below what an honest beam held on rocks earns (about 19,000 ferrite
  an hour at Heat's duty cycle). So carbon and ferrite grants are never the client's.
- **What players are sent.** Every 250 ms (`sweep`, on the service's timer) each session whose player is in a world's
  frame and within 500 m of its ground is sent, as `nodes`, the touched cells within 500 m of it that it does not hold or
  that changed (`gone`: broken and growing back; `hurt`: damaged, with the fraction left rounded up to tenths, so a
  beam's every hit is not news), an empty cell for one that went back to the scatter or that it has left 600 m behind,
  and `reset` as it arrives on a world (again whenever it comes back to one). A client holds exactly what it was sent and
  draws the rest as the scatter has it. Nothing is sent while no node near a player is touched, and a player is looked
  at again only when its world's touched nodes changed (each world has a version) or it has moved. The cells round a
  player are found through buckets of touched cells about 512 m across, worked out again once it has moved 32 m; each
  cell's state is checked against the schema and encoded once per change, and a session's message put together from
  those (`Session.sendText`).
- **Bounds and cost.** A far hit never scatters or samples the ground; at most 16 grounds, 4,096 scattered cells and
  100,000 touched nodes are kept, and a miner idle for an hour (the flora budget's) is forgotten. The bench's mining trial (25 players on foot
  among 480 nodes, herds about, every node broken many times over) keeps the whole tick, hits and sweeps included,
  well under the 10 ms p95.
- **Not here.** Asteroids and the ship's Mining Laser, and with them iridium from Tier 3+ belts, are P1.E13.T07's (after
  P1.E12.T04 resolves ship weapons on the server); the client's half is P1.E13.T06.

## 19. Meters

Reserved for Heat and Charge (P1.E07.T02), which holds protocol 9 and this section on its branch until it merges.

## 20. Combat (`packages/server/src/combat`)

DESIGN 12.1, 9.1, 10.3, 14.9; P1.E06.T02. The server decides every hit: its health, its damage, deaths and what a kill
is worth. Clients fire their tracers at once for feel and are told what happened. (§19 is Heat and Charge's, P1.E07.T02.)

- **Health** is each zone's (`zone.combat`, `ZoneCombat`). A creature's is its mob stats' (`mobStats` of its body plan
  and temperament at its herd's level; the apex takes the Pack Alpha's row), taken when it is first hurt. A player has
  its suit's (`playerMaxHealth` of the nodes it entered with: 100, Second Skin 150) and its ship's shield and hull
  (`shipStats` of the ship it entered with); a hit takes the suit when the server believes it on foot, else the shield
  and then the hull. On the wire, an entity's `hp` is the fraction left of the pool in use (and aboard, `shield`), patched
  as it changes and as a player's mode changes which pool is shown. Nothing heals yet and health is not saved: the
  Recall (P1.E06.T03) and creature attacks (P1.E08.T02) decide recovery.
- **One damage path**, `zone.combat.applyDamage(source, target, packet)`: `source` the attacker's entity (or null),
  `packet` the server's description of the hit (`base`, `kind` (`weapon`, `ability`, `attack`, `hazard`), `what` dealt
  it, its `DamageSource` for resistances, the attacker's modifiers, effects on the target). It runs the shared pipeline
  (`computeDamage`: resistances by node, weapon or branch, the attacker's power, augments, what the target takes),
  level-scaled only when the source is a creature (its entity's level; DECISIONS P1.E06.T01), then takes the health,
  feeds the creature's threat table (`FaunaSim.hurt`), records the damage each character did (counted up to the health
  left), tells the hooks who fought (`engaged`) and queues the event. A dead creature or a downed player takes no more.
  Weapons (below), abilities (P1.E07.T03) and creature attacks (P1.E08.T02) all come through it; nothing a client sends
  carries an amount.
- **Death.** A creature at 0 dies: fauna takes it out of its herd at once (§6.2: its den's timers start), its entity
  stays a corpse (`hp` 0, mode `dead`, no `attack`) for DEATH_BEAT_S (3 s) and is then despawned, and the hooks hear
  `killed` with the damage by character and the killing blow's. A player at 0 is down (`down: 'suit' | 'ship'`): it takes
  no more damage, fires no more, its event says `killed`, and the hooks hear `downed` (the Recall, P1.E06.T03, acts on
  it; until then it stays down for its session).
- **Events.** Each hit queues a `combat` event; hits of one source on one target by the same thing in a tick are summed
  into one. After each tick's snapshots (the interest sets just worked out) each session is sent those whose target or
  source its interest holds (`Zone.sees`), its own entity's first, at most 32 a tick; a tick queues at most 512. Each is
  encoded once and written to every session as text.
- **The base gun** (DESIGN 9.1: the ship lasers stay on LMB). Its numbers are the first fitted hitscan weapon's with a
  per-shot damage, cooldown and range, through `shipStats` of the ship the player entered with and the nodes it owns now
  (`baseGun`: the Lark's Pulse Lasers, 11 a volley every 0.12 s to 1,500 m; Gunnery and the laser nodes apply); P1.E12.T04
  turns it into the Pulse Lasers module. The `CombatService` (`ws.combat`, made by the gateway) checks each `fire`
  cheapest first: its `seq`; the player in a zone; a gun fitted; the gun's rate (a bucket of 3 shots refilled at one per
  cooldown: a client firing as fast as its own cooldown lets it is never refused for jitter, and none fires faster for
  long; a refused shot spends it too); its clock (within 3 s of the server's); the believed mode (`ship`); not down; the
  aim's frame (its pose's); the aim within 30° of the believed nose (the lasers fire along it). Then the ray: from the
  believed position carried on along the believed velocity to the shot's time (from its last input's stamp, 0.1 s at
  most), along the aim, as far as the gun reaches, the shared `rayHits` against the living creatures of its frame's world
  (hit spheres round their bodies, 0.6 × size + 1 m), and the first it meets must be in sight from the believed position
  itself: the drawn ground (fauna's plan, §12) sampled along the stretch the origin was carried (the client's stamp
  chooses the carry, so it never jumps ground the ship has not been seen to cross) and on to the hit, at most 96 times a
  stretch (every 2 m on a short one), the gun's end and the target's skipped. A hit deals the gun's damage through the
  damage path. Players are neither targets nor in the way: PvP is P2.E17.T01.
- **A kill's worth** (`killLoot`, `@astra/shared/combat`): XP of the mob's level × 10 (DESIGN 14.9), units of 2 a level a
  threat star (spread ×0.75–1.25 by a roll), and a row's drops (the stone-touched's Count residue, a boss's loot
  resources; plain fauna drop none), rolled once and split by the damage each character did (`splitByDamage`, as a
  node's yield). XP goes to the character's progress (levelling its entity and pushing the skill view, as a quest's
  does), units and items into its inventory (what does not fit is lost), each told to its session as `xp` and `loot`
  events (the session found where it is by then, the kill's zone first), and every one who hurt it is sent a quest `kill {tags: [fauna, temperament, body plan], entity}`.
- **In combat** is having dealt or taken damage within 6 s: the skill service's `inCombat` (slots swap only out of it).
- **The client** (`net/combat.js`): `Ship.fireLasers` fires its tracers and sends `fire` (`fireIntent`: the nose's
  direction in the frame of the ship's pose, at the game's world time); `Net.combat` keeps the events that concern the
  player, and the HUD shows a number off the reticle for each of its hits (gold for a kill), a flash for a blow taken and
  a kill's XP and units as toasts. Until the client renders the server's herds (P1.E08.T09) its own local creatures are
  not the ones the server's shots hit; their health bars, hit flashes and deaths come with that task.
- **Bench.** The combat trial (25 ships flying low over a Tier 3 world's herds, each firing every cooldown at the
  creature nearest it, herds put down as they thin) keeps the whole tick, its shots included, under the 10 ms p95.
- **Not here.** Pirates' fights move to the server in P1.E08.T05 (the client's local pirate combat and asteroid hits are
  its own until then, P1.E13.T07 for asteroids); creatures' attacks are P1.E08.T02; abilities P1.E07.T03.

## 21. Call-for-aid beacons (`packages/server/src/social/beacons.ts`)

DESIGN 16.6's "Social" row and DESIGN 17, P1.E15.T02: a beacon broadcasts an instance's open slots to the shard, so a
player alone in an instance finds help on a quiet shard, and players on a busy one fill the instances that have room. The
social service holds the beacons (`SocialService.beacons`, its timer checking them every tick, 100 ms), in memory like
the parties: Phase 1 runs the shard in one process (§1), so nothing elsewhere reads them, and a restart drops them. When
P3.E37 splits the shard across processes they move to Redis beside the world service's mirror (§3).

- **Instances.** A beacon is raised for the phase its caller is in (§6.1): an `event` or a `raid`, whose slots are its
  12 players (members and places kept, as the cap counts them), or a quest step's `story` phase (keyed
  `quest:<quest>:<scene or step>` by the quest runtime, §17), which holds one party, so its slots are its caller's
  party's (`PARTY_MAX`, 6; a caller in no party holds one). A hangar `bay` and a phase cutscenes play in are not
  instances anyone calls aid to (`kind`): the cutscene service marks those it plays in (`CutsceneService.plays`, given
  to the social service by the gateway), whatever their key, since a quest's cutscene step plays in a `quest:` phase.
- **Raising** (`beacon {op: 'raise'}`) is refused while the character has a beacon up, or its instance has one
  (`raised`: one per character and one per instance); in no phase (`no_phase`), in a bay or a cutscene's phase
  (`kind`); with no slot open (`full`); with `BEACON_MAX` (256) up on the shard (`busy`); and, checked last so that no
  other refusal spends it, past the account's allowance (`rate` with `retryS`: 3 at once, then one every 30 s, shared
  by the account's sockets). The caller is sent `beacon {op: 'raised', id, beacon}`, and again whenever its character
  enters the world while the beacon is up.
- **The listing** (`BeaconView`): its id; the instance's kind and star system (galaxy index); its place, as a frame, a
  centre in it and a radius (where to go to answer); what the place is called (the quest's title, else the location's
  key; the kind's name if neither is plain text); the quest, for a story instance; the caller's name; its open slots of
  `cap`; and the world times it was raised (`at`: its age is the client's server time less this) and lapses (`until`,
  10 minutes later). A session that sends `watch` is sent the whole list (`beacons {reset: true, beacons, gone: []}`,
  some 70 KB at 256 beacons) and from then the changes (`beacons {beacons, gone}`: new beacons and those whose open
  slots changed, and the ids of those that ended), until it sends `unwatch` or its connection closes; a new connection
  starts unwatched. The changes are gathered and sent only at the tick's sweep, one message encoded once for every
  watcher (`Session.sendText`), so the shard's broadcasts come at most ten times a second however many requests arrive.
  A `watch` from a session already watching is ignored, and an account is sent the whole list 5 times at once, then
  once every 10 s (`denied {of: 'watch', code: 'rate', retryS}`, the session then not watching), so no flood of watch
  and unwatch turns its message budget into megabytes.
- **The end.** At every tick each beacon is checked, and it ends when its instance closed (`closed`), it lapsed
  (`expired`), its caller is no longer in the instance (`left`; a caller whose connection dropped keeps it up while the
  phase keeps its place, §6.1), or no slot is open (`full`, at once when an answer took the last); and when its caller
  lowers it (`lower`, `lowered`). Its caller is sent `beacon {op: 'ended', id, why}` and the watchers its id in `gone`;
  a change in its open slots goes to the watchers as the beacon again.
- **Answering** (`beacon {op: 'answer', id}`) is checked again there and then, cheapest first: the beacon is up
  (`unknown`, and one whose instance closed, lapsed or was left by its caller ends now) and not the answerer's own
  (`self`); the answerer is in the instance's star system (`elsewhere`), in no phase (`in_phase`), and inside the
  instance's place, its volume with the phase manager's 5% hysteresis, from its pose as it stands (`far`). The server
  never moves a player to answer: its entity stays where movement authority has it, its inputs are judged as before and
  nothing re-seats its mover. Travelling to a beacon (a server-side relocation, which would re-seat the mover as an
  admin teleport does, §7) is a later feature; until then the listing says where to go. The answerer is then placed by
  `PhaseManager.enter` (§6.1), under the phase's cap and party rule, so an event or a raid that filled since it was
  listed refuses it (`full`). A story instance's answer joins the caller's party as accepting an invite from the caller
  would (`Parties.joinWith`, or a new party the caller leads), refused `in_party` (the answerer is in another party),
  `full` (the party is full) and `gone` (the caller is not connected in its instance), all checked before anything
  changes; the caller is re-placed under the party first, since a caller placed before it had a party was placed as a
  party of one. A helper needs no quest of its own: it fights beside the party in the caller's chapter, the quest runtime
  leaving alone a player in a phase it did not put it in, and quests move only for those who hold them. The answerer is
  sent `beacon {op: 'joined', id, phase}`, the caller `beacon {op: 'answered', id, name}`, and the watchers the beacon's
  new slots (or its end, when that was the last).
- **Helpers.** Since the quest runtime never re-places a player it did not place, the beacons do it for the helpers a
  story answer placed, as the runtime does for a party (§17: a party that breaks up is split again): a helper that is no
  longer in the party it joined (it left, was kicked, or the party disbanded: at once, as the party service tells of it,
  `Parties.onLeft`, so the runtime never re-places a caller around it first) or whose caller is no longer in the chapter
  (its step ended, it went elsewhere, its kept place lapsed: at the next tick) goes back to the shared world
  (`PhaseManager.leave`; a helper whose connection is down has its kept place given up, `PhaseManager.release`), logged
  as `beacon helper sent back`. So a party's private phase is only ever the party's: a kicked helper cannot stay with
  its actors, nor hold the phase open for the party's return. One that leaves the chapter by itself is forgotten.
- **Refusals** go to the asker only, as `denied {of: 'raise' | 'lower' | 'answer' | 'watch', code, retryS?}`. Every
  raise, answer, end and helper sent back is logged at info, with the character, zone, phase and kind.
- **The client.** `net.beacons` (`packages/client/src/net/beacons.js`) holds the list while watching (and watches again
  after a reconnect, or once a watch refused for its rate may succeed), the character's own beacon, the phase its last
  answer put it in and the last refusal, and sends the requests. The chat and party UI (§13, P1.E15.T03) watches from
  the first welcome and shows the list as the chat panel's fourth tab: the player's own beacon (raise or lower it) over
  the shard's, newest first, each with its kind, place, caller, open slots of the cap, age, star system and, in this
  one, the distance to its place ("here" inside it), and an answer button with the server's refusal in words under the
  beacon answered (`elsewhere`, `far`, `in_phase`, `full`, `gone` …). A beacon newly called in the player's own system
  is a line in the log. The tab shows how many are up.

## 22. Analysis and the codex (`packages/server/src/codex`, `@astra/shared/codex`)

DESIGN 14.5, 12.1, 9.1, 9.5, 14.9; P1.E08.T04. Analyzing a creature puts its species in the character's codex; the server
checks every analysis and records it, and nothing a client sends grants a codex entry or XP. The demo's analysis, which
paid units on the client, is gone (DESIGN 20.2–20.3).

- **A request** (`analyze {seq, time, target}`, §5) goes from the gateway to the `AnalysisService` (`codex/analysis.ts`),
  which checks it as resources check a mining hit (§18), cheapest first: `stale_seq`; `zone` (the character in play, its
  codex held); `rate` (2 at once per character, then 1 a second: the analysis is instant, as the demo's was, so there is
  no scan to hold a target through); `stale` (stamped more than 3 s from the server's clock); `zone`; `mode` (on foot, as
  the zone entity has it: movement authority's believed mode; ring grazers and depth leviathans will be analyzed from the
  cockpit with Deep Sweep, P2.E29.T02, which lets `ship` through for those species); `unknown` (no `mob` entity of that id
  in the player's zone that its phase lets it see, `phases.canSee`, so a phase's own creature is none to anyone else and
  nothing more of it is told; or a species its world does not carry); `dead` (no hp left); `world` (it is not on the world the
  player's frame names); `range` (from the eye, 1.6 m up, to the creature's middle, more than the demo's reach of 70 m
  plus its hit radius, 1.15 × its size × 0.9, a flyer's 0.6, as the client's aim pick takes it, plus 5 m for a pose a tick
  old); `busy` (the ground not planned yet); `los` (the drawn ground in the way, sampled as the beam's is, §18). Every
  analysis that passes is heard by listeners (`subscribe`), first or not: the gateway passes each to the quest runtime as
  `analyze {species: <key>}` (§17), so a quest's `analyze` step counts species the server saw analyzed.
- **The codex** (`CodexService`, `codex/service.ts`, made by `coreRegistry` over the progress holder and the skill service
  unless one is given; the gateway finds it with `codexServiceIn`). A species is keyed by its world's frame id (unique per
  world, unlike a planet's seed) and its index in the world's `faunaSpecies` list (`speciesKey`: `<frame>/<index>`). The
  stored value (`@astra/shared/codex`, the `codex` component, v1) is `{worlds: {<frame>: {system, species: {<index>:
  {temperament, threat, bodyPlan, bond, at}}}}}`: threat stars by temperament (`threatRating`), `bond` `eligible` or
  `big_game` (heavy quadrupeds and flyers need Big Game, DESIGN 9.5; `canBond(entry, owned)` is P1.E07.T07's rule, and
  `CodexService.canBond` reads the owned nodes), `at` the world time of the first analysis. Bounded to 4,096 species over
  1,024 worlds and 64 a world (the galaxy has 2,959 species on 432 worlds, at most 9 a world): past that an analysis is
  refused `full`, logged as an error, and nothing is earned.
- **XP.** The first analysis of a species earns `SPECIES_XP` (300, DESIGN 14.9) into the character's progress, levelling it
  as quest XP does (the player's entity takes the level, the skill view is refreshed); the answer's `xp` is what was
  granted. A repeat records nothing and earns nothing.
- **Reconcile.** On load the stored codex is brought in line with the species data as it is now (`reconcileCodex`, the
  component's `reconcile`): a world that no longer has fauna, or whose frame is not in its system any more, is dropped; a
  species past its world's list is dropped; an entry whose species changed takes its new temperament, threat, body plan
  and Bond reach, keeping `at`; one warning per character. Only a value that cannot be read refuses the join.
- **Survey bookkeeping** for P2.E29 and the Symbiotic fragment (DESIGN 9.1, 14.5): `analyzedOn(codex, world)` counts a
  world's species analyzed and `analyzedEvery(codex, world, count)` says whether every one of a list `count` long is (a
  world's list at a tier is a prefix of its whole list). Survey rewards are P2.E29.T02's; first-finder naming and codex
  plates are P2.E29.T01's (§25: every analysis made is the discovery service's too, and a first find earns through the
  codex's XP grant, `CodexService.grantXp`); the codex UI, and a `codex` state message to feed it, P2.E29.T03's.
- **The client** (`Game.analyze(target)`, `Game.onAnalyze`) sends the request and shows the answer: a first analysis's
  banner (the codex line, Bond, the XP), a known one's toast, a refusal's reason. Until the client draws the server's
  creatures (P1.E08.T09) it has no server creature to aim at: online, its own demo herds show their names but cannot be
  analyzed; the dev sandbox still analyzes its own herds for its quest book, and pays nothing for it.

## 23. Fabricators (`packages/server/src/crafting`, `@astra/shared/crafting`)

DESIGN 15.7, 15.3, 10.1; P1.E13.T05. Crafting is the main use for raw materials, and the server makes every craft: a
client asks, the server checks the recipe, where the player is and what it holds, and changes the inventory itself. The
gate is recipes and materials, not a skill tree.

- **Recipes are items.** Every recipe of the table (`data/recipes.ts`) has an item `recipe_<id>` (`recipeItemId`, kind
  `recipe`, stacking, so vendors and the market can sell several; `data/items.ts`). Using one (`learn`) uses it up and
  writes the recipe into the character's knowledge for good; one already known is refused `known` and the item kept.
  What a character knows is the `recipes` persistence component (§8, `{known: [ids]}`, v1) held by the `RecipeBook`
  (`crafting/book.ts`, made by `coreRegistry`; the gateway finds it with `recipeBookIn`). A new character, or one saved
  before crafting, knows `STARTING_RECIPES`: Phase 1's consumables (warp cell, pulse fuel cell, oxygen and sodium
  cartridges, flak ammo), so the warp cell that replaces the demo's 1,800-unit purchase is craftable from the first
  Waystation. Vendors, chains, drops and vaults hand out the rest (P2.E20.T01). On load the stored list is reconciled
  with the table (`reconcileKnown`: a recipe the table dropped is dropped, one warning); only an unreadable value refuses
  the join.
- **Two fabricators** (`makesAt`). A Waystation's makes the item recipes of its line (`fabricators` includes
  `waystation`) up to Tier 2 (`FABRICATORS`, "Tier 1 stations craft Tier 0–2 recipes"): every consumable but the
  catalysts, the Tier 1–2 modules. The ship's own makes only the field-craftable recipes (`field`: pulse fuel, both
  cartridges, flak ammo; torpedoes from a Tier 2 system, by the zone's tier), never a warp cell. Neither assembles a hull.
  Capitals', sanctuaries' and the Scrapyard's fabricators come with those places (P1.E10.T02, P1.E11.T05, P2.E20.T01).
- **Where.** As the zone believes the player (its entity's frame, position and mode; movement authority's, §7): the
  station's fabricator needs the player in the zone's Waystation frame, docked (in its ship on a pad) or on foot within
  `STATION_FABRICATOR.reachM` (4.5 m) of the fabricator terminal's use point on the trade deck (`data/station.ts`,
  1.2 m in front of the kiosk at x −30, z −80 on the 7 m deck; the client builds the kiosk there); the ship's needs it
  aboard its ship in any mode (`ship`, `pulse`, `landed`, `docked`) or on foot within the boarding reach (9 m) plus 5 m of
  the ship it left (`MovementAuthority.parkedOf`; a zone without movement authority has none, so on foot it is refused).
- **A request** (`craft {seq, op}`, §5) goes from the gateway to the `CraftingService` (`crafting/service.ts`), checked
  cheapest first: `stale_seq`; `zone` (the character's recipes and inventory held); `rate` (4 at once per character,
  then 2 a second: every request that gets this far spends one, refused for the rate or anything after it or not; a
  stale number or a character out of play spends none); `unknown` (not in the table); then for `make`: `not_known`;
  `fabricator`; `place`; and the craft itself. For `learn`: `known`, `no_item`. A craft is instant (no state held between
  request and result) and all or nothing: the shared `craft(inv, recipe, count)` takes every material from the suit
  first, then the cargo pods, and adds the output to the suit first, then the cargo, on a copy, and the inventory service
  applies the result as one change (`InventoryService.transact`, pushed once as `inventory` state). Short of a material
  it is `materials`; when the output does not fit even in the room the materials leave, `no_room`; either way nothing is
  used up. Crafts made are logged at debug, lessons at info.
- **Using what is made.** Warp cells are what the client's warp spends (`Inventory.warpCells`; the warp itself stays the
  client's until zone handoff, P1.E04.T04). The fabricator replaces the trade panel's 1,800-unit warp cell (DESIGN
  15.7), which is gone (`pnpm gate:removed` holds it to this task): until the client mines through the server
  (P1.E13.T06), online players get warp cells only from the starting kit and crash sites. The rest of the demo's `SHOP`
  list, the 300-unit pulse fuel refill among it, goes with P1.E07.T09, since a crafted pulse fuel cell cannot be used
  yet. What a consumable restores is `refillOf(item)` (shared, from the item table): a pulse fuel cell refills Charge
  once Heat and Charge are the server's, through P1.E07.T02's `refillCharge`, a seam that task adds and that is not on
  main yet (called with that amount as a cell is used up through `InventoryService.consume`); cartridges restore 60 once
  the suit's life support and hazard protection are the server's (today the client's `Game.updateSurvival` refills them
  from raw oxygen and sodium, 40 a time); flak ammo stacks until the Flak Cannon fires on the server (P1.E12.T04,
  P2.E24.T04). Salvage (a module broken down into a third of its materials, `salvageYield`) waits for modules in the
  inventory (P1.E12.T04, P2.E20).
- **The client** (`net/crafting.js`, `ui/Fabricator.js`). `game.crafting` keeps the recipes the server says the
  character knows, checks a request with the same shared rules (`makeProblem`, `learn`: a refusal they predict is said
  at once and never sent) and sends it; in the dev sandbox it makes the craft on the client's own inventory with them.
  The fabricator screen opens at the trade deck's fabricator terminal (E), and with K: docked, the Waystation's; aboard
  anywhere else, or on foot beside the ship, the ship's. It lists the known recipes this fabricator makes (how many the
  materials held make, or "missing materials"), the others as made elsewhere, and recipe items held to learn; the
  selected recipe's materials needed against held, Craft ×n (1 to what the materials make, at most 100); the fabrication
  runs across the button (0.56 s) and the result or the refusal shows in the line under the columns once both it and the
  answer are in (the quantity then held to what the materials left make); a recipe learned moves from the recipes to
  learn into the list.

## 24. Reputation (`packages/server/src/reputation`, `@astra/shared/reputation`)

DESIGN 14.4, 14.2, 14.8, 16.2; P2.E18.T01. A character's standing with each faction of the table (`FACTIONS`: the
Compact, the Free Reaches, the Chorus and the three cities), its rank there and the titles it has earned. The server
changes it; no client message does.

- **The rules** (`@astra/shared/reputation`, pure, both ends). Standing runs 0–1000 per faction (`FACTION_RULES`), a
  faction with none being at 0; every change is held to those bounds in whole points (`clampRep`). The rank is the highest
  of the faction's three whose threshold (200, 500, 800: the ranks' `rep`) standing reaches (`rankIdAt`, the data's
  `rankAt`): ranks follow standing down as well as up (DESIGN: "Rep is lost as well as gained"). Titles are earned and
  kept for good, whatever standing does later: a rank's title (the data's `title`) the first time standing rises
  through its threshold (`setStanding`: every rank risen through, lowest first; a rank lost and reached again earns
  nothing more), and a quest's (`rewards.title`, Forty Names' "Unlisted"). DESIGN 14.4 has each rank's 3–4 quest chain
  end "in a named title"; until the chains exist (P2.E18.T02–T05) the threshold awards it, and a chain's last quest
  giving it adds nothing. A rank's title is held by its faction and rank id (`{faction, rank}`: the three cities share
  their ranks' names, and the data's name is the one shown), a quest's by its name (`{title, quest?}`), each once, at
  most `TITLES_MAX` (128; the table's 18 ranks and room for quests' and seasons'). A quest's title that names a rank's
  title is that rank's (`questTitle`, `rankOfTitle`: a rank of a faction the quest pays reputation to, else the one rank
  of the table with that name), so a chain's last quest giving "Hand" never stores a second Hand beside the threshold's;
  a quest's title is also held already when any title held has its name, and a rank's title takes the place of a
  quest's title of its name.
- **Opposed factions.** DESIGN names its opposed effects as acts: "raiding a convoy costs Compact rep, defending one
  costs Reaches rep". They are data (`REP_ACTS`): `convoy_escorted` (Compact +50, Reaches −25) and `convoy_raided`
  (Reaches +50, Compact −25), the side helped gaining and the side gone against losing half that (tunable; DESIGN gives
  no amounts), each with the Count meter tag of its counted action (P2.E22.T01: escorted `feed`, raided `break`).
  `ReputationService.act(character, act, {scale?})` applies both in one change, its gain earning the underdog's bonus by
  the act's own tag; the convoy run (P2.E21.T05) is their source. A plain grant moves one faction only: a quest that
  should cost another faction lists both in its rewards.
- **The underdog's bonus** (§11, DESIGN 16.2): a gain earned by a counted action (an act, or a grant passed `counted`,
  the tag of the counted action that earned it) is multiplied by `underdogRepMultiplier(count, tag)` (×1.5 for the side
  pulling the Count back toward the middle while it sits more than 200 from it), read from the world service's Count;
  losses never are.
- **The state** (the `reputation` component, v1, §8): `{rep: {<faction>: 0–1000}, titles: [{faction, rank} | {title,
  quest?}]}`. A stored faction is any id, so a faction the table later drops still reads: the component's `reconcile`
  (`reconcileReputation`) drops its standing and the titles of ranks the table no longer has (a renamed rank id is a
  removal), one warning per character, and the next save writes it; only a value that cannot be read refuses the join.
  It loads after the recipes and before the quests, and is written with the quest log (`writtenWith`, §8).
- **The service** (`ReputationService`, `reputation/service.ts`; made by `server.ts` with the world's Count and given to
  `coreRegistry`, the gateway finds it with `reputationServiceIn`) holds each character in play's value: `grant(character,
  faction, amount, {reason, counted?})` (a non-finite amount is a RangeError), `act`, `earnTitle(character, title,
  {quest?, factions?})`, `set` (the admin CLI's), and `standing`, `rankOf`, `meetsRank` and `view` to read. A character
  out of play is declined (null). Each change is logged (a rank reached or lost at info with its reason, other moves at
  debug) and its listeners hear one `rank` event for each faction whose rank the change moved (from the rank before to
  the rank after, however many thresholds it crossed), a `title` event per title earned, and then the view; the gateway
  sends those to the session holding the character (§5). The view names each title (a rank's from the data) with its
  faction and rank, or its quest.
- **Sources.** Quests (§17): their rewards' and dialogue answers' reputation and their titles go through
  `reputationRewardHooks` (`rep` and `title` with the quest, the title with the factions the quest pays reputation to,
  `questFactions`; `rankOf` for rank prerequisites); a reward a hook declines is held as owed. Acts (above). The admin CLI's `set-rep <character> <faction> <value>` (§16): in play through `set` (the
  client hears the change), out of play by `setStanding` on the stored value through `persistence.edit`, both earning the
  titles of the ranks risen through. Not yet: the convoy run's acts (P2.E21.T05), PvP kills' rep (DESIGN 14.9,
  P2.E17.T01–T02), world events' participation rep (P2.E21.T01), the Count's other counted actions (anchors and the wall:
  P2.E28, P3.E34), seasons' titles (P2.E22.T03, through `earnTitle`), the faction chains (P2.E18.T02–T05) and the gates
  that read ranks (trainers P2.E18.T06, hulls P2.E24.T05, the Void branch's standing gate through the skill service's
  `meets` hook, P2.E18.T03). Kills on main are fauna's (§20), whose tags name no faction.
- **Reading ranks at load.** The `skills` component loads (and reconciles) long before the `reputation` component, so
  while a character's components load the reputation service does not hold it yet and `rankOf` and `meetsRank` answer
  as for no standing. A standing gate must not be read then: P2.E18.T03's Void gate (the skill service's `meets`) reads
  reputation only once the character is in play, never from the skills component's `reconcile`, `check` or `load`, or a
  join would judge every Free Reaches Deckhand as having no standing.
- **Exactly once.** Nothing in the service is idempotent by itself; each source pays once by its own record, written in
  the same row update as the standing it paid: the reputation component is written with the quest log or not at all
  (`writtenWith`, §8). A quest's step rewards and answers are recorded in its `paid` record and a completion in `done`,
  so a crash before the save, or a quest log that cannot be saved, loses both the record and the standing. Reputation
  and titles owed from before this task (P1.E09.T01 held them in the quest log) are settled on join
  (`QuestRuntime.joined` → `settleOwed`, before the auto quests, whose rank prerequisites read the result): each owed
  `rep` and `title` goes to its hook, oldest first, and leaves the owed list as its hook takes it. The owed list and the
  standing change together in memory and are written in one save; a crash before it, or a capture that cannot take
  either of them, leaves the row as it was, and the next join settles it again, once in all. Sources outside the quest
  log (acts, the admin CLI) write the reputation alone; a reputation held back with a quest log that cannot be saved
  holds their changes back too.
- **The client** (`net/reputation.js`): `net.reputation` keeps the last view (`standing(faction)`, `rank(faction)`,
  `titles`), the rank and title events for a screen to `take()` (the last 16), and logs each change to the console. The
  reputation screens are P2.E18.T02 onward's.
## 25. First finders (`packages/server/src/discovery`, `@astra/shared/discovery`)

DESIGN 14.5, 14.9; P2.E29.T01. The first player on a shard to analyze a species, land on a planet or moon, or reach a site
is its finder: the find is the shard's, shown to everyone, worth `FIRST_FINDER_XP` (2,000) and a codex plate to its
finder, who may name it once. Naming is prestige: what a find earns does not depend on it. Everything is seen by the
server from what it believes; no client says it found anything.

- **Keys.** A find is its kind and a key unique in that kind, starting with its system's seed: a species by
  `speciesKey` (`<world frame>/<index>`, §22), a planet or moon by its frame id (§4), a site by its world's frame id and
  its index among the world's planned sites, `<seed>:<body>#<index>` (`planSites` order: the drawn ground every client and
  the server share, §12; a site's type is `SITE_TYPES[index % 4]`, as `planSites` deals them).
- **Finds** (`DiscoveryService`, `discovery/service.ts`, made by the gateway over the shard's store, the plates
  persistence's registry loads into and the codex's XP grant). A species: every analysis the analysis service makes
  (`subscribe`, §22), first for the character or not. A planet or moon: a player in play its zone believes `landed` on it
  or on `foot` there (movement authority lets a player out only from a landed ship, so a player on foot has landed; the
  `foot` case catches one who got out between two looks). A site: a player its zone believes within `SITE_REACH_M` (30 m)
  of the site's footprint, measured from the middle of its levelled ground (the sites' clearance on the zone's planned
  ground, `places.ts`), in any mode. Landings and sites are looked for every `SCAN_MS` (0.5 s) over the characters in
  play, never per input; site checks run only below half the world's mountains plus the reach, a chord test first.
- **The store** (`discovery/store.ts`, the `discoveries` table: shard, kind, key, system seed, finder id and name, world
  time found, name, name state, window's end, who named it and when; primary key shard + kind + key; indexed by system
  and by finder). A claim inserts the row with `ON CONFLICT DO NOTHING`: of two players racing (in one process or
  several), one inserts it and is the finder; the other reads the finder's row back. Each star system's finds are loaded
  when a player is first in it (retried after 5 s when the load fails) and kept (up to 128 systems), so a find already
  made is never claimed again; a claim in flight is not repeated by the same character; an analysis made before its
  system's finds are loaded is claimed anyway and the store decides. A finder's character going leaves its find, with
  its name (finder id `set null`).
- **Paid once.** A claim won pays its finder through `CodexService.grantXp` (the codex's XP path, which levels the entity
  and refreshes the skill view) and adds a codex plate (`plates` component, `{plates: [{kind, key, at}]}`, v1, at most
  `PLATES_MAX` 4,096: past it a find is still its finder's but earns nothing, logged as an error). The plate is the
  record of the payment: a find is paid only while its finder holds no plate for it, and plate and XP land in one save,
  asked for at once (`saveNow`). A finder out of play when its claim lands, or whose save a crash lost, is paid at its
  next join: the gateway's join reads the character's finds back (`byFinder`) and pays any without a plate. The finder
  hears `event {kind: 'notice'}` ("First to find <procedural name>: name it within 10 min") and `event {kind: 'xp'}`.
- **Naming.** Within `NAME_WINDOW_S` (600 s of world time) of the find its finder may name it once (`name`): checked
  cheapest first (its rate, 3 at once then one per 5 s per character; the find; its finder; named, closed or lapsed; the
  filter), then written by the store only on the finder's own find, still `open`, never named, at a world time no later
  than its window's end, so a second name or one past the window writes nothing (the row decides, whatever the service
  held; a refused write is answered by what the row now says). Names are immutable after that but for a moderator's
  `rename` (state `renamed`) or clear (state `cleared`: the procedural name for good, and the finder can no longer name
  it, `closed`). A find never named keeps its procedural name, which every client makes itself (species, body and site
  names from the shared generators); the server's own (`proceduralName`) is for notices and the CLI.
- **The moderation filter** (`checkDiscoveryName`, `@astra/shared/discovery`; lists in `data/names.ts`). A name is
  tidied (composed, trimmed, spaces collapsed), 3–24 UTF-16 units, words of Latin letters and digits (Basic Latin,
  Latin-1, Latin Extended-A and B, so a look-alike letter of another script cannot slip a word past it) with one space,
  apostrophe or hyphen between two, and at least two letters. It is compared as a skeleton (lower case, accents stripped,
  0 1 3 4 5 7 8 read as o i e a s t b, nothing but letters and digits): a blocked fragment anywhere in it (also with runs
  of a letter run together) is `blocked`; a blocked word as one of its words, or as the whole name run together, is
  `blocked` (words like these sit innocently inside others, so they are not fragments); a reserved word (admin,
  moderator, dev, official, system…) as one of its words, or a reserved name (the game's title, powers and people, every
  people, capital and faction of the data tables) as the whole of it, is `reserved`. Moderators' renames skip only the
  reserved names. On the wire the name keeps chat's text rules (§5, §13).
- **Shown to everyone.** The gateway calls `joined(session, name)` after a join (after `quests`): the character's system's
  finds go out as `discoveries` with `reset` once they are loaded, and again whenever its zone becomes another system's
  (the scan notices), and every new find and every name given or changed goes to everyone sent that system's finds (and
  to its finder, wherever it is). The client keeps them in `net.discoveries` (`net/discoveries.js`): the current
  system's finds (another system's news is ignored; a welcome starts over), `displayName(kind, key, procedural)` (the
  finder's name, else the procedural one), `mine()` (what its character may still name), `name(kind, key, name)` and the
  last `named` answer. One place shows names through it so far: the analysis banner and the known species' toast
  (`Game.onAnalyze`); the HUD's location line, the codex UI and a field to name a find in are later tasks' (P2.E29.T03),
  until when a finder names a find from the dev console (`game.net.discoveries.name(…)`).
- **Tests.** Integration tests run with first finds off unless they ask (`startTestServer(…, {discovery: true})`), on a
  shard of their own: a find on the shared shard pays its finder XP on a database's first run and not on the next, which
  no other test's XP should depend on. The production server and the online smoke run with them on.
