# Architecture: server, protocol and client networking

How the online game is put together. DESIGN 17 is the sketch; this file fixes the conventions the Phase 1 server and
networking tasks (P1.E02.T08, E03, E04, E06–E09) build on, so no task re-decides them. Where a task finds a convention
wrong, it changes this file in the same commit and logs the change in DECISIONS.md.

## 1. Packages and processes

| Package | Runs in | Owns |
|---|---|---|
| `@astra/shared` | Node and the browser | deterministic world (`/world`), data tables (`/data`), protocol schemas and codecs (`/protocol`), combat math, glyphs (`/art`) |
| `@astra/server` | Node 22 under tsx | the gateway, zones, the world service, persistence |
| `@astra/client` | the browser | rendering, input, prediction, UI |
| `@astra/tools` | Node, Blender | gates, bots, smoke/e2e, capture, art export |

One server process in Phase 1 hosts the gateway, every zone and the world service; the code keeps them behind interfaces so
P3.E37 can split them across processes. Shared state that must survive a restart lives in Postgres; hot state that other
processes will read (presence, zone membership, the server clock) is mirrored to Redis.

## 2. Server layout (`packages/server/src`)

```
index.ts            boot: config → db → redis → world service → zone manager → character persistence → gateway
config.ts           env (DATABASE_URL, REDIS_URL, JWT_SECRET, PORT=8787, TICK_HZ=20), validated with zod
db/                 Drizzle schema (schema.ts), client, migrate.ts; SQL migrations in packages/server/drizzle/
gateway/http.ts     HTTP: POST /auth/register, POST /auth/login, GET /health, GET/POST /characters
gateway/ws.ts       WebSocket upgrade (token in the first message), one Session per socket
session/            Session: the account, the character in play, the zone it is in, its outbound queue
zones/              Zone (one star system), ZoneManager, spatial hash, interest sets, snapshot encoder
phases/             PhaseManager (one per zone): private layers at shared places, their caps and visibility rule
world/              WorldService: server clock, season, Count, Edge position, tier map
persistence/        character state: the component registry, Phase 1's components, the save queue and its store (§8)
sim/                server-side systems added by later tasks: movement validation, combat, fauna, quests, skills…
dev/                dev-only login bypass and the admin CLI (P1.E03.T07)
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
below `last_time`, and advances it with the monotonic clock; so `t` carries on across a restart and never steps backwards,
even when the host's wall clock has. The world service mirrors its state to Redis under `astra:shard:<id>:world` (JSON,
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
  from 1, so `ack` 0 means no input applied yet. The client acknowledges each snapshot it applies with `ack {tick}`, at
  most once per tick; the server diffs against the latest acknowledged tick it still holds (64 ticks, about 3 s) and
  sends a full snapshot when it holds none. The server diffs against the state it last *sent*, not its true state, so
  slow motion under the epsilon still goes out. The encoder sends only the listed fields, validates each against its
  schema, clamps unit fields, and drops and reports any field that fails, so a client never rejects what the server sent. The decoder still drops a malformed entity on its own; a client that sees
  one must not store or acknowledge that tick. Control-message encoders send the validated copy, so keys a schema does
  not define (server-only state on a wider object) never leave the server.
- **Versioning:** `PROTOCOL_VERSION` in shared; the client sends it in `hello`, whose shape is frozen across versions;
  the server reads it with `peekVersion` before full validation and refuses a mismatch with `refused {code: 'version'}`.
- **Client → server:** `hello {version, token}`, `join {characterId}`, `input {seq, time, mode, pose: {frame, pos, quat,
  vel}, buttons, aim?}` at 20 Hz (`time`, because `t` is the type tag, is the client's estimate of server time when it
  sampled the pose: movement authority judges the pose at that time, bounded by the server's own clock, §7; `mode` is a
  prediction validated like the pose; `seq` counts from 1),
  `cast {seq, slot, aim, target?}`, `interact {target}`, `chat {channel, text}`, `ack {tick}` (one per applied snapshot,
  at most once per tick), `ping {id, clientTime}`, `inventory {seq, op}`. Each socket's message budget is 60 a second
  with a burst of 120: input and acks take 40, leaving room for pings, casts, interactions, chat and inventory requests,
  and the burst absorbs the backlog of a stall.
- **Server → client:** `welcome {accountId, character, entityId, serverTime, zone, pose, mode}`, `refused {code, reason}`,
  `correction {seq, pose, mode}`, `zone {zone, pose}` (handoff), `event {event}` with kinds `combat`, `quest`, `chat`,
  `loot` and `notice` (toasts), `world {season, count, edgeX, tiers, serverTime}` (sent right after `welcome` and to every
  joined session whenever the world service's state changes; `tiers` is each galaxy system's tier by index), `pong`,
  `inventory {seq, inventory, error?}`, and snapshots.
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
  Adding, taking and units are never requests. `inventory` is the one type both directions use; `encodeMessage`
  picks the union whose schema accepts the message.
- **HTTP bodies** use the same module: `Credentials`, `AuthResponse`, `CharacterCreate`, `CharacterSummary`,
  `CharacterList`.

## 6. Zones

A zone hosts one star system: every entity in it, a 20 Hz tick, a spatial hash over world positions at the tick's time,
interest sets per session (entities within the class radius of the session's own entity: ships 50 km, walkers 2 km, mobs
1.5 km, loot 500 m; always the session's own entity, and its party wherever they are; then its phase may hide some of
them, §6.1), and per-session delta snapshots. Ticks are fixed-step; a tick that overruns is logged with its duration (the
budget is 10 ms p95 at 200 entities). Entities in deep space between systems belong to a deep-space zone keyed by the
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
  under, which it keeps; without one, its entity's party tag as it stands (the tag stands in for the party system,
  P1.E15.T01). A story phase never holds two parties: re-asked, or coming back, under a party its others are not in, a
  player goes to another phase.
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
  the phase. A member already outside the volume keeps only what is left of its grace, and comes back still outside, so
  dropping and reconnecting never extends it. One that leaves the zone any other way (a handoff, a logout) goes at once. A phase with no members and no
  kept places closes, and its own entities are despawned; `close(phase)` does the same on demand. Opening and closing
  are logged (info).

## 7. Authority

Following IMPLEMENTATION_PLAN 0.3: the client sends inputs and its predicted pose; the server validates pose against per-hull
and walker speed caps and the shared terrain sampler, corrects with `correction` when the error exceeds tolerance, and
decides damage, loot, inventory, quests, economy, skills and the meter. Client-reported outcomes (damage dealt, items
picked up, quest steps done) are never trusted; they are requests the server re-evaluates.

**Movement** (`packages/server/src/sim/movement`, P1.E03.T04). Every zone the ZoneManager opens checks each player input
before applying it.

- *Time.* A pose is judged at the time its client stamped it (`input.time`), so latency, jitter and stalls change nothing:
  an honest client's poses and times are its own trajectory. The server bounds that clock by its own (`MOVEMENT.time`): it
  never runs backwards, never lags arrival by more than 30 s (a client sending no time is judged on arrival times), is
  never more than 0.3 s ahead of arrival, and never gains more than 0.4 s plus 1% on the arrival time less the smallest
  latency seen in the last 10 s. A client running its clock fast gains at most a few tenths of a second, once. The
  bodies are placed at that time too (to within 10 ms), so the pose's frame, clearance and air are the client's.

- *The pose* must be in a frame the shared rule (`selectFrame`) allows there, and change frame only where the rule does
  (out of a sphere 5% beyond it, into one inside it); a ship may not be below the ground (the shared terrain sampler,
  levelled under cities and sites exactly as the client levels it, sampled only below a ceiling no terrain reaches, and
  planned off the input path when a ship first comes near), in a gas giant's depths, or with its centre inside the
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
- *The move* from the last valid pose: no further than its allowance covers in the time since, plus a tenth of a
  second's worth and 25 m (anti-teleport); and not through the ground, nor a flying ship's centre through the hangar's
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
  rest. Persistence restores any other docked at home (§8).

## 8. Persistence

Postgres tables (Drizzle): `accounts`, `shards` (§3) and `characters` (people, name, look, level, xp, home system, and
`state`, `revision`, `saved_at`). Migrations are generated with drizzle-kit and applied with `pnpm db:migrate`.

**Character state** (`src/persistence`, P1.E03.T05). Every subsystem that owns part of a character registers one
component in the registry (`registry.ts`): `{key, v, schema, migrations?, columns?, onInvalid, default(ctx), check?(value,
ctx), load?(value, ctx), save(ctx), unload?(id)}`. A component is stored as an entry `{"v": <schema version>, "data":
<value>}` of the row's `state` jsonb under its key, or, with `columns`, in the row's own columns. Components load in
registration order, so a later one reads an earlier one's value (`ctx.get`). Phase 1 registers (`components.ts`,
`coreRegistry`): `progress` (level, xp, home system: the columns), `ship` (`ShipLoadout | null`, the Lark by default),
`inventory` (its layout re-derived from the ship on load, `applyLayout(saved, layoutFor(loadout))`; kept as saved, and
logged, when the ship cannot hold it) and `pose` (`{system, pose, mode, parked?}`, read from the character's zone
entity, `parked` being where a character on foot left its ship; version 2; its `check` is movement authority's
`poseProblem` (§7), so a saved pose inside the ground, in the hangar's shell, docked off a pad or on foot with no ship to
board is not restored).

- **Load** on `join`, from what persistence still holds for the character (it left moments ago and that save may not have
  landed) or else from its row; the join pins the character while it reads the row. A missing component gets its default;
  an older `v` is migrated one version at a time and written back at the next save. A value that cannot be read (a newer
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
- A capture is synchronous and small: each component's live value, checked against its schema (a value that fails is
  logged and its stored one kept), and only the components whose value changed since the last capture, at a revision one
  above it. Writes never block a tick: the queue holds at most one save per character (a newer capture merges into the
  waiting one), one writer drains it in batches of up to 64, one `UPDATE … FROM (VALUES …)` statement each, which merges
  the entries into `state` (`state || new`, so keys this server does not know survive), sets the columns it carries and
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
  character out of play behind persistence's back. There is no API yet for changing one out of play: P1.E03.T07 (the
  dev CLI's grant, teleport, set quest step) adds it to persistence as load, modify and save, refused while the character
  is held and holding its joins until the save is written.

**Adding a component** (skills P1.E07.T01, quests P1.E09.T01, flags, reputation): export `xComponent(service)` returning a
`CharacterComponent` with its key, `v: 1`, the zod schema of the stored value, `default`, `load`, `save` and `unload`
(`onInvalid: 'refuse'` for anything a player earned), and register it in `coreRegistry` after the components it reads and
before those that read it: skills go before the inventory, which then passes the owned nodes to `layoutFor` (Pack Mule's
stack cap). No SQL migration: it is a new key in `state`. To change a stored shape later, raise `v` and add
`migrations[oldV]`. State that must be queried across characters, or outgrows one jsonb entry, gets a child table and a
store of its own.

## 9. Client networking (`packages/client/src/net`)

`Net` owns the socket: connect, `hello`, `join`, the clock offset, decoding snapshots into an entity store, sending input at
20 Hz, and applying `correction`s through the prediction layer. Remote entities render from the store with 100 ms
interpolation delay and up to 250 ms extrapolation, frame-aware (interpolate in the entity's frame; on a frame change,
re-express the buffered poses). Gameplay code reads remote state from the store, never from the socket.

## 10. Tests

Unit tests (`*.test.ts`) next to the code or in the package's `test/` folder; integration tests (`*.int.test.ts`) start a real server on a random port against
the dockerised Postgres and Redis (`pnpm db:up && pnpm test:int`) and drive it with scripted clients from
`packages/tools/src/bots`. Each integration test creates its own accounts with unique names and cleans nothing up; the
database is disposable.
