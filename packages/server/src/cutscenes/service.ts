// Cutscenes on the server (docs/ARCHITECTURE.md "Cutscenes"): every cutscene plays in a story phase (DESIGN 14.1:
// "Cutscenes are always instanced"; 17: phases are first class). Asked to play one, the service places the player in a
// story phase at its place through its zone's phase manager (a party member already watching it there shares that
// phase), spawns the cutscene's actors into the phase once, and answers `play` with the phase's id, so the client knows
// the layer it is in. When the player's cutscene ends (or is skipped) it leaves the phase; the last one out closes it,
// which despawns the actors. Story phases hide only their actors: everyone else at the place still sees the player.
//
// The gateway hands it `cutscene` messages (handle) once the networked client sends them (P1.E04.T01); the quest
// engine (P1.E09.T01) calls start/end for its cutscene steps.
import type { ClientMessage, ServerMessage } from '@astra/shared/protocol';
import type { Zone, ZoneLog, ZoneViewer } from '../zones/zone.ts';
import { CUTSCENES, type CutsceneEntry } from './catalog.ts';

type CutsceneRequest = Extract<ClientMessage, { t: 'cutscene' }>;
type CutsceneState = Extract<ServerMessage, { t: 'cutscene' }>;
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

/** Where the service finds a session's zone (the ZoneManager). */
export interface CutsceneZones {
  zoneOf(viewer: ZoneViewer): Zone | undefined;
}

interface Playing {
  id: string;
  zone: Zone;
  phase: number;
}

export class CutsceneService {
  private readonly playing = new Map<ZoneViewer, Playing>();

  constructor(
    private readonly zones: CutsceneZones,
    private readonly catalog: Readonly<Record<string, CutsceneEntry>> = CUTSCENES,
    private readonly log?: ZoneLog,
  ) {}

  /** A client's `cutscene` message, answered. */
  handle(viewer: ZoneViewer, msg: CutsceneRequest): CutsceneState {
    return msg.op === 'request' ? this.start(viewer, msg.id) : this.end(viewer, msg.id);
  }

  /** The cutscene the session is watching, and its phase. */
  playingOf(viewer: ZoneViewer): { id: string; phase: number } | null {
    const p = this.playing.get(viewer);
    return p ? { id: p.id, phase: p.phase } : null;
  }

  /**
   * Plays cutscene `id` for the session where its player is: places it in a story phase there (its party's, if a member
   * is watching the same cutscene there) and spawns the cutscene's actors into a phase that has none yet. Asked again
   * for the cutscene it is watching, it answers with the same phase.
   */
  start(viewer: ZoneViewer, id: string): CutsceneState {
    const entry = Object.hasOwn(this.catalog, id) ? this.catalog[id]! : undefined;
    if (!entry) return { t: 'cutscene', op: 'refused', id, phase: null, reason: 'unknown' };
    const zone = this.zones.zoneOf(viewer);
    const entity = zone?.entityOf(viewer);
    if (!zone || entity === undefined) return { t: 'cutscene', op: 'refused', id, phase: null, reason: 'zone' };
    const now = this.playing.get(viewer);
    if (now) {
      if (now.id === id && zone.phases.phase(now.phase)?.open && zone.phases.phaseOf(entity) === now.phase) {
        return { t: 'cutscene', op: 'play', id, phase: now.phase };
      }
      if (now.id !== id && zone.phases.phase(now.phase)?.open) return { t: 'cutscene', op: 'refused', id, phase: null, reason: 'busy' };
      this.playing.delete(viewer);
    }
    const { frame, pos, quat } = zone.entity(entity)!.fields;
    const phase = zone.phases.phaseFor(viewer, 'story', { key: `cutscene:${id}`, frame, center: [...pos], radius: entry.radius });
    // (a party member watching it here already has the actors out)
    if (phase.entities.size === 0) {
      for (const a of entry.actors) {
        zone.phases.spawn(phase.id, {
          kind: a.kind,
          frame,
          pos: add(pos, rotate(quat, a.offset)),
          quat: [...quat],
          vel: [0, 0, 0],
          name: a.name,
          ...(a.hull ? { hull: a.hull } : {}),
        });
      }
    }
    this.playing.set(viewer, { id, zone, phase: phase.id });
    this.log?.info({ zone: zone.id, phase: phase.id, cutscene: id, entity, members: phase.members.size }, 'cutscene started');
    return { t: 'cutscene', op: 'play', id, phase: phase.id };
  }

  /** The session's cutscene ended (or was skipped): its player leaves the phase, which closes once it is empty. */
  end(viewer: ZoneViewer, id: string): CutsceneState {
    const p = this.playing.get(viewer);
    if (!p || p.id !== id) return { t: 'cutscene', op: 'ended', id, phase: null };
    this.playing.delete(viewer);
    const entity = p.zone.entityOf(viewer);
    if (entity !== undefined && p.zone.phases.phaseOf(entity) === p.phase) p.zone.phases.leave(viewer);
    this.log?.info({ zone: p.zone.id, phase: p.phase, cutscene: id }, 'cutscene ended');
    return { t: 'cutscene', op: 'ended', id, phase: p.phase };
  }

  /**
   * The session left its zone (a dropped connection, a handoff): its cutscene is forgotten here. The phase manager keeps
   * a dropped player's place for its grace, and a reconnecting client asks again.
   */
  forget(viewer: ZoneViewer): void {
    this.playing.delete(viewer);
  }
}

/** Vector `v` turned by unit quaternion `q` ([x, y, z, w]). */
export function rotate(q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

function add(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
