// The admin commands' effects (P1.E03.T07, docs/ARCHITECTURE.md §16). A command that changes a character changes it
// through the live services while it is in play, so authority holds and its client hears the usual state messages
// (`inventory`, `skills`, a `correction` or a `zone` handoff); out of play, through persistence's load–modify–save
// (`CharacterPersistence.edit`), which is refused while the character is held or joining and holds its joins until the
// write lands. A character that left a moment ago is held until its last save is written; a command waits a little for
// that rather than refuse.
//
// The same service runs in the server (live services given, reached over the admin channel) and in the CLI's direct mode
// (no server: only out-of-play edits). Every command is logged with who ran it and what it asked, and how it ended.
import { addItem, addUnits, applyLayout, itemInfo, layoutFor, spendUnits, takeItem, type Inventory, type Result } from '@astra/shared/inventory';
import type { PeopleId } from '@astra/shared/protocol';
import type { ShipLoadout } from '@astra/shared/ships';
import { setAvailablePoints, type SkillResult, type SkillState } from '@astra/shared/skills';
import { tierOfGalaxySystem } from '@astra/shared/world';
import { eq, sql } from 'drizzle-orm';
import { isUuid } from '../characters/characters.ts';
import type { Db } from '../db/client.ts';
import { accounts, characters } from '../db/schema.ts';
import type { WsGateway } from '../gateway/ws.ts';
import { INVENTORY, POSE, PROGRESS, SHIP, SKILLS, type PoseState, type Progress } from '../persistence/components.ts';
import type { CharacterEdit, CharacterPersistence, EditRefusal, EditVerdict } from '../persistence/service.ts';
import type { Session } from '../session/session.ts';
import { systemZoneId } from '../world/home.ts';
import type { WorldSource } from '../world/service.ts';
import type { ZoneManager } from '../zones/manager.ts';
import type { Zone } from '../zones/zone.ts';
import { AdminError, DEFAULT_MUTE_S, type AdminCommand, type AdminErrorCode } from './commands.ts';
import { resolvePlacement } from './place.ts';

/** What the service reaches in a running server. */
export interface AdminLive {
  zones: ZoneManager;
  gateway: Pick<WsGateway, 'registry' | 'inventory' | 'skills' | 'social' | 'stats'>;
  /** each system's tier as the Edge stands (a surface teleport stands on the ground drawn at it) */
  world?: Pick<WorldSource, 'tierOf'>;
}

/**
 * The quest runtime's admin seam (P1.E09.T01 answers it once it lands): set a character's quest to a step, in play
 * through the runtime, out of play on the stored quest log. Without one, set-quest-step is `unavailable`.
 */
export interface QuestAdmin {
  /** Sets the quest of a character in play to `step`: null, or why not. */
  setStep(characterId: string, quest: string, step: number): string | null;
  /** The persistence component the quest log is stored under. */
  readonly component: string;
  /** The stored quest log with the quest at `step`, or why not. */
  setStepStored(log: unknown, quest: string, step: number): { ok: true; log: unknown } | { ok: false; error: string };
}

/** A pino-shaped logger. */
export interface AdminLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

export interface AdminDeps {
  db: Db;
  persistence: CharacterPersistence;
  /** The running server's services; absent in the CLI's direct mode. */
  live?: AdminLive;
  quests?: QuestAdmin;
  log?: AdminLog;
  /** How long a command waits for a character held by its last save (or a join) to be free, ms (3000). */
  heldWaitMs?: number;
}

/** Who ran a command: the name the CLI sent, and how it came. */
export interface Operator {
  name: string;
  via: 'channel' | 'direct';
  remote?: string;
}

export type AdminResult = Record<string, unknown>;

/** A character as a command names it. */
interface Named {
  id: string;
  name: string;
  accountId: string;
}

/** What a command did to a character: in play (live services) or out of play (an edit at `revision`). */
type Changed<T> = { online: true; value: T } | { online: false; value: T; revision: number; changed: string[] };

export class AdminService {
  private readonly db: Db;
  private readonly persistence: CharacterPersistence;
  private readonly live?: AdminLive;
  private readonly quests?: QuestAdmin;
  private readonly log?: AdminLog;
  private readonly heldWaitMs: number;

  constructor(deps: AdminDeps) {
    this.db = deps.db;
    this.persistence = deps.persistence;
    this.live = deps.live;
    this.quests = deps.quests;
    this.log = deps.log;
    this.heldWaitMs = deps.heldWaitMs ?? 3000;
  }

  /** Runs a command; logs who asked what and how it ended. Throws an AdminError when it did nothing. */
  async run(cmd: AdminCommand, who: Operator): Promise<AdminResult> {
    const started = Date.now();
    const audit = { admin: who.name, via: who.via, remote: who.remote, command: cmd };
    try {
      const result = await this.dispatch(cmd, who);
      this.log?.info({ ...audit, ok: true, ms: Date.now() - started }, 'admin command');
      return result;
    } catch (err) {
      const e = err instanceof AdminError ? err : new AdminError('failed', err instanceof Error ? err.message : String(err));
      if (e.code === 'failed') this.log?.error({ ...audit, ok: false, error: e.code, err }, 'admin command failed');
      else this.log?.info({ ...audit, ok: false, error: e.code, reason: e.message, ms: Date.now() - started }, 'admin command');
      throw e;
    }
  }

  private dispatch(cmd: AdminCommand, who: Operator): Promise<AdminResult> | AdminResult {
    switch (cmd.cmd) {
      case 'who':
        return this.who();
      case 'zones':
        return { zones: this.needLive('zones').zones.metrics() };
      case 'metrics':
        return this.metrics();
      case 'teleport':
        return this.teleport(cmd);
      case 'grant':
        return this.grant(cmd);
      case 'spawn':
        return this.spawn(cmd);
      case 'despawn':
        return this.despawn(cmd);
      case 'set-quest-step':
        return this.setQuestStep(cmd);
      case 'set-skill-points':
        return this.setSkillPoints(cmd);
      case 'mute':
        return this.mute(cmd, who);
      case 'unmute':
        return this.unmute(cmd);
    }
  }

  // ---------- reading ----------

  private who(): AdminResult {
    const { zones, gateway } = this.needLive('who');
    const online = [];
    for (const s of gateway.registry.sessions) {
      if (s.state !== 'joined' || !s.characterId) continue;
      const zone = zones.zoneOf(s);
      const e = zone && s.entityId !== null ? zone.entity(s.entityId) : undefined;
      online.push({
        character: s.characterId,
        name: gateway.social.roster.get(s.characterId)?.name ?? null,
        account: s.accountId,
        session: s.id,
        zone: zone?.id ?? null,
        entity: s.entityId,
        mode: e?.fields.mode ?? null,
        frame: e?.fields.frame ?? null,
        pos: e ? [...e.fields.pos] : null,
      });
    }
    online.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { sessions: gateway.registry.size, online };
  }

  private metrics(): AdminResult {
    const { zones, gateway } = this.needLive('metrics');
    const mem = process.memoryUsage();
    return {
      loop: { tickHz: Math.round(1000 / zones.stepMs), ticks: zones.ticks, skipped: zones.skippedTicks, running: zones.running },
      zones: zones.metrics(),
      persistence: this.persistence.stats(),
      gateway: gateway.stats(),
      process: { uptimeS: Math.round(process.uptime()), rssMb: mb(mem.rss), heapMb: mb(mem.heapUsed) },
    };
  }

  // ---------- characters ----------

  private async teleport(cmd: Extract<AdminCommand, { cmd: 'teleport' }>): Promise<AdminResult> {
    const c = await this.character(cmd.character);
    const tierOf = (system: number) => this.live?.world?.tierOf(system) ?? tierOfGalaxySystem(system);
    const at = resolvePlacement(cmd, { tierOf });
    const r = await this.change(
      c,
      (s) => this.moveInPlay(c, s, at),
      (e) => {
        e.set(POSE, at);
        return false;
      },
    );
    return { character: c.id, name: c.name, ...at, ...this.how(r), handoff: r.online ? r.value : undefined };
  }

  /** Moves a character in play: in its zone (a correction tells its client) or to another (a handoff). True for a handoff. */
  private moveInPlay(c: Named, s: Session, at: PoseState): boolean {
    const { zones, gateway } = this.needLive('teleport');
    const zone = zones.zoneOf(s);
    const entityId = s.entityId;
    const e = zone && entityId !== null ? zone.entity(entityId) : undefined;
    if (!zone || entityId === null || !e) throw new AdminError('held', `${c.name} is between zones; try again`);
    const { pose, mode } = at;
    let handoff = false;
    if (zone.systemIndex === at.system) {
      zone.patch(entityId, { ...pose, mode });
      // the client rewinds to this pose at its last applied input (§5); the zone has taken it already
      s.send({ t: 'correction', seq: e.input?.seq ?? 0, pose, mode });
    } else {
      const info = this.persistence.info(c.id);
      const f = e.fields;
      zones.leave(s, 'left');
      const joined = zones.join(
        s,
        {
          id: c.id,
          name: info?.name ?? c.name,
          people: (info?.people ?? f.people ?? 'thalune') as PeopleId,
          level: f.level ?? 1,
          homeSystem: info?.homeSystem ?? at.system,
        },
        at,
      );
      s.entityId = joined.entityId;
      s.zoneId = joined.zone.id;
      s.send({ t: 'zone', zone: { id: joined.zone.id, systemSeed: joined.zone.system.seed }, pose: joined.pose });
      // its party tag and the system chat index follow it at once
      gateway.social.moved(s);
      handoff = true;
    }
    this.persistence.saveNow(c.id, 'admin');
    return handoff;
  }

  private async grant(cmd: Extract<AdminCommand, { cmd: 'grant' }>): Promise<AdminResult> {
    const c = await this.character(cmd.character);
    const units = cmd.what.toLowerCase() === 'units';
    if (!units && !itemInfo(cmd.what)) throw new AdminError('invalid', `no item or resource ${cmd.what} (units: the currency)`);
    const n = cmd.count;
    // one shared rule both ways: the service applies it to the live inventory, the edit to the stored one
    const op = (inv: Inventory): Result<{ added?: number; remainder?: number; taken?: number }> =>
      units ? (n > 0 ? addUnits(inv, n) : spendUnits(inv, -n)) : n > 0 ? addItem(inv, cmd.what, n) : takeItem(inv, cmd.what, -n);
    const r = await this.change(
      c,
      (s) => {
        const inventory = this.needLive('grant').gateway.inventory;
        const id = s.characterId!;
        const done = units
          ? n > 0
            ? inventory.earn(id, n)
            : inventory.spend(id, -n)
          : n > 0
            ? inventory.grant(id, cmd.what, n)
            : inventory.consume(id, cmd.what, -n);
        if (!done.ok) throw new AdminError('refused', done.error.message);
        this.persistence.saveNow(c.id, 'admin');
        return outcome(done);
      },
      (e) => {
        // as a join would see it: laid out for its ship and the nodes it owns
        let inv = e.get<Inventory>(INVENTORY);
        const laid = applyLayout(inv, layoutFor({ ship: e.get<ShipLoadout | null>(SHIP), skills: e.get<SkillState>(SKILLS).bought }));
        if (laid.ok) inv = laid.inv;
        const done = op(inv);
        if (!done.ok) return done.error.message;
        e.set(INVENTORY, done.inv);
        return outcome(done);
      },
    );
    return { character: c.id, name: c.name, what: units ? 'units' : cmd.what, count: n, ...r.value, ...this.how(r) };
  }

  private async setSkillPoints(cmd: Extract<AdminCommand, { cmd: 'set-skill-points' }>): Promise<AdminResult> {
    const c = await this.character(cmd.character);
    const r = await this.change(
      c,
      (s) => {
        const done = this.needLive('set-skill-points').gateway.skills.setPoints(s.characterId!, cmd.points);
        if (!done.ok) throw new AdminError('refused', done.error.message);
        this.persistence.saveNow(c.id, 'admin');
        return done.available;
      },
      (e) => {
        const done: SkillResult<{ available: number }> = setAvailablePoints(e.get<SkillState>(SKILLS), e.get<Progress>(PROGRESS).level, cmd.points);
        if (!done.ok) return done.error.message;
        e.set(SKILLS, done.state);
        return done.available;
      },
    );
    return { character: c.id, name: c.name, asked: cmd.points, available: r.value, ...this.how(r) };
  }

  private async setQuestStep(cmd: Extract<AdminCommand, { cmd: 'set-quest-step' }>): Promise<AdminResult> {
    const quests = this.quests;
    if (!quests) throw new AdminError('unavailable', 'quests unavailable: the quest runtime (P1.E09.T01) is not on this server yet');
    const c = await this.character(cmd.character);
    const r = await this.change(
      c,
      (s) => {
        const why = quests.setStep(s.characterId!, cmd.quest, cmd.step);
        if (why) throw new AdminError('refused', why);
        this.persistence.saveNow(c.id, 'admin');
        return true;
      },
      (e) => {
        const done = quests.setStepStored(e.get(quests.component), cmd.quest, cmd.step);
        if (!done.ok) return done.error;
        e.set(quests.component, done.log);
        return true;
      },
    );
    return { character: c.id, name: c.name, quest: cmd.quest, step: cmd.step, ...this.how(r) };
  }

  /**
   * Applies a change to a character: through `live` while a joined session holds it, else as an edit out of play. A
   * character held by its last save or by a join is waited for (heldWaitMs), then looked at again: it may be in play by
   * then. `edit` returns the value to report, or a string: why it refuses (nothing is written).
   */
  private async change<T>(c: Named, live: (s: Session) => T, edit: (e: CharacterEdit) => T | string): Promise<Changed<T>> {
    const deadline = Date.now() + this.heldWaitMs;
    for (;;) {
      const s = this.sessionOf(c.id);
      if (s) return { online: true, value: live(s) };
      let value: T | undefined;
      const r = await this.persistence.edit(
        c.id,
        (e): EditVerdict => {
          const v = edit(e);
          if (typeof v === 'string') return v;
          value = v;
        },
        'admin',
      );
      if (r.ok) return { online: false, value: value as T, revision: r.revision, changed: r.changed };
      if ((r.code === 'held' || r.code === 'busy') && Date.now() < deadline) {
        await sleep(25);
        continue;
      }
      throw new AdminError(EDIT_CODES[r.code], r.reason);
    }
  }

  private how<T>(r: Changed<T>): AdminResult {
    return r.online ? { online: true } : { online: false, revision: r.revision, changed: r.changed };
  }

  /** The joined session holding the character, if the server has one. */
  private sessionOf(characterId: string): Session | undefined {
    if (!this.live) return undefined;
    for (const s of this.live.gateway.registry.sessions) if (s.state === 'joined' && s.characterId === characterId) return s;
    return undefined;
  }

  /** The character a command names: its id (any case) or its name (ignoring case). */
  private async character(ref: string): Promise<Named> {
    const where = isUuid(ref) ? eq(characters.id, ref.toLowerCase()) : sql`lower(${characters.name}) = lower(${ref})`;
    const [row] = await this.db.select({ id: characters.id, name: characters.name, accountId: characters.accountId }).from(characters).where(where).limit(1);
    if (!row) throw new AdminError('not_found', `no character ${ref}`);
    return row;
  }

  // ---------- zones ----------

  private async spawn(cmd: Extract<AdminCommand, { cmd: 'spawn' }>): Promise<AdminResult> {
    const zone = this.loadedZone(cmd.system, 'spawn');
    const spec = cmd.spec;
    if (spec.kind === 'entity') {
      const at = resolvePlacement({ system: cmd.system, frame: spec.frame, pose: spec.at.join(',') });
      const id = zone.spawn({ kind: spec.entity, ...at.pose, name: spec.name });
      return { zone: zone.id, entity: id, kind: spec.entity, frame: at.pose.frame, pos: at.pose.pos };
    }
    if (!zone.fauna) throw new AdminError('unavailable', `zone ${zone.id} has no fauna`);
    let body = spec.body;
    let at = spec.at;
    if (spec.near !== undefined) {
      const c = await this.character(spec.near);
      const near = this.sessionOf(c.id);
      const e = near && this.live!.zones.zoneOf(near) === zone && near.entityId !== null ? zone.entity(near.entityId) : undefined;
      if (!e) throw new AdminError('not_found', `${c.name} is not in play in ${zone.id}`);
      const m = e.fields.frame === null ? null : /:(\d+)$/.exec(e.fields.frame);
      if (!m) throw new AdminError('invalid', `${c.name} is not in a world's frame`);
      if (body !== undefined && body !== Number(m[1])) throw new AdminError('invalid', `${c.name} is on body ${m[1]}, not ${body}`);
      body = Number(m[1]);
      at ??= [...e.fields.pos];
    }
    if (body === undefined || at === undefined) throw new AdminError('usage', 'a herd needs near=<character>, or body=<i> and at=<x>,<y>,<z>');
    let herd: ReturnType<NonNullable<Zone['fauna']>['spawnHerd']>;
    try {
      herd = zone.fauna.spawnHerd({ body, species: spec.species, at, count: spec.count, level: spec.level });
    } catch (err) {
      if (err instanceof RangeError) throw new AdminError('invalid', err.message);
      throw err;
    }
    if (!herd) throw new AdminError('refused', `zone ${zone.id} holds as many creatures as it may`);
    const sp = zone.fauna.speciesOf(body)[spec.species];
    return { zone: zone.id, body, species: spec.species, name: sp?.name, herd: herd.herd, creatures: herd.creatures };
  }

  private despawn(cmd: Extract<AdminCommand, { cmd: 'despawn' }>): AdminResult {
    const zone = this.loadedZone(cmd.system, 'despawn');
    const e = zone.entity(cmd.entity);
    if (!e) throw new AdminError('not_found', `no entity ${cmd.entity} in ${zone.id}`);
    if (e.fields.kind === 'player') throw new AdminError('refused', 'players leave by logging out, not by despawn');
    if (e.fields.kind === 'mob') throw new AdminError('refused', "creatures belong to their herd's cell; they unload with it");
    zone.despawn(cmd.entity);
    return { zone: zone.id, entity: cmd.entity, removed: true };
  }

  private loadedZone(system: number, what: string): Zone {
    const zone = this.needLive(what).zones.zone(systemZoneId(system));
    if (!zone) throw new AdminError('not_found', `zone ${systemZoneId(system)} is not loaded (nobody is in system ${system})`);
    return zone;
  }

  // ---------- accounts ----------

  private async mute(cmd: Extract<AdminCommand, { cmd: 'mute' }>, who: Operator): Promise<AdminResult> {
    const social = this.needLive('mute').gateway.social;
    const a = await this.account(cmd.account);
    const seconds = cmd.seconds ?? DEFAULT_MUTE_S;
    social.mute(a.id, seconds, `admin ${who.name}`);
    return { account: a.id, username: a.username, seconds };
  }

  private async unmute(cmd: Extract<AdminCommand, { cmd: 'unmute' }>): Promise<AdminResult> {
    const social = this.needLive('unmute').gateway.social;
    const a = await this.account(cmd.account);
    return { account: a.id, username: a.username, wasMuted: social.unmute(a.id) };
  }

  /** The account a command names: its id or its username, ignoring case. */
  private async account(ref: string): Promise<{ id: string; username: string }> {
    const where = isUuid(ref) ? eq(accounts.id, ref.toLowerCase()) : sql`lower(${accounts.username}) = lower(${ref})`;
    const [row] = await this.db.select({ id: accounts.id, username: accounts.username }).from(accounts).where(where).limit(1);
    if (!row) throw new AdminError('not_found', `no account ${ref}`);
    return row;
  }

  private needLive(what: string): AdminLive {
    if (!this.live) throw new AdminError('needs_server', `${what} needs the running server (drop --direct)`);
    return this.live;
  }
}

/** An edit's refusal as the command's error. */
const EDIT_CODES: Readonly<Record<EditRefusal, AdminErrorCode>> = {
  closed: 'failed',
  held: 'held',
  busy: 'busy',
  not_found: 'not_found',
  unreadable: 'refused',
  invalid: 'invalid',
  refused: 'refused',
  conflict: 'conflict',
  failed: 'failed',
  unsupported: 'failed',
};

/** What an inventory change did, for the report. */
function outcome(r: { added?: number; remainder?: number; taken?: number; inv: Inventory }): Record<string, number> {
  const out: Record<string, number> = { units: r.inv.units };
  if (r.added !== undefined) out.added = r.added;
  if (r.remainder !== undefined) out.remainder = r.remainder;
  if (r.taken !== undefined) out.taken = r.taken;
  return out;
}

function mb(bytes: number): number {
  return Math.round((bytes / 1048576) * 10) / 10;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
