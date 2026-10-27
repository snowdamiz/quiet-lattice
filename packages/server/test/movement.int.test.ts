// Movement authority over the wire (P1.E03.T04), against the dockerised Postgres and Redis: a scripted client that flies
// honestly is never corrected; one that teleports and speeds is snapped back with `correction` (its entity put back where
// the correction says), logged with its account, character, the rule and the measured and allowed values, and after
// repeated cheating refused with `kicked`.
import { STATION_LAYOUT } from '@astra/shared/data';
import { flightCaps, shipStats, SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import { frameIdOf } from '@astra/shared/world';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT } from '../src/inventory/service.ts';
import type { RunningServer } from '../src/server.ts';
import { MOVEMENT } from '../src/sim/movement/index.ts';
import { startTestServer, waitFor } from './helpers.ts';
import { Pilot } from './pilot.ts';

type Vec3 = [number, number, number];

let server: RunningServer;
/** warn lines the server logged while the suite ran */
const warnings: { obj: Record<string, unknown>; msg: string }[] = [];

beforeAll(async () => {
  server = await startTestServer();
  // the zones log through the server's logger (silent in tests): listen in on its warnings
  const log = server.app.log as unknown as { warn: (obj: object, msg: string) => void };
  const warn = log.warn.bind(log);
  log.warn = (obj: object, msg: string) => {
    warnings.push({ obj: obj as Record<string, unknown>, msg });
    warn(obj, msg);
  };
});

afterAll(async () => {
  await server?.close();
});

/** Off the pad it joined on, up, and out of the hangar's mouth. */
async function takeOff(p: Pilot): Promise<Vec3> {
  const [x, y, z] = p.welcome.pose.pos;
  const out: Vec3 = [0, 30, STATION_LAYOUT.hangar.z1 + 60];
  await p.fly([[x, y, z], [x, 14, z], [x, 14, 40], out], [10, 40, 60]);
  return out;
}

const zoneOf = (p: Pilot) => server.zones.zone(p.welcome.zone.id)!;

describe('movement authority over the wire', () => {
  it('joins docked on a pad, and never corrects a client that flies honestly', async () => {
    const p = await Pilot.join(server);
    const { pos, frame } = p.welcome.pose;
    expect(frame).toMatch(/:station$/);
    expect(p.welcome.mode).toBe('docked');
    expect(STATION_LAYOUT.pads.some((pad) => pad.x === pos[0] && pad.z === pos[2])).toBe(true);
    expect(pos[1]).toBeCloseTo(STATION_LAYOUT.padTop + SHIP_GEAR_HEIGHT, 9);

    await p.hold('docked', 300);
    const out = await takeOff(p);
    // cruising under the space cap, then boosting under the boost cap, then easing off
    const cruise: Vec3 = [0, 200, out[2] + 1000];
    await p.fly([out, cruise], [550]);
    const boosted: Vec3 = [0, 500, cruise[2] + 2400];
    await p.fly([cruise, boosted], [1500], 'ship', 2 /* boost */);
    await p.fly([boosted, [0, 520, boosted[2] + 300]], [500]);

    const zone = zoneOf(p);
    await waitFor(() => zone.entity(p.entityId)?.fields.pos?.[2] === p.last.pos[2], 5000, 'the last input applied');
    const e = zone.entity(p.entityId)!;
    expect(e.unvalidated).toBe(false);
    expect(e.fields.mode).toBe('ship');
    expect(p.corrections).toEqual([]);
    expect(zone.movement!.recent.filter((r) => r.entity === p.entityId)).toEqual([]);
    expect(p.errors).toEqual([]);
    p.close();
  });

  it('never corrects a client flying out of the Waystation’s sphere into its world’s frame, stamping its time or not', { timeout: 60_000 }, async () => {
    for (const stamps of [true, false]) {
      const p = await Pilot.join(server, 'thalune', { stamps });
      await takeOff(p);
      const zone = zoneOf(p);
      const d = zone.system;
      // boosting outward, through the edge of the Waystation's sphere and 5% beyond it
      const frame = await p.flyOn(d, [0, 0.1, 0.995], 1400, 5000, 2 /* boost */);
      expect(frame).toBe(frameIdOf(d.seed, d.station.parent));
      await waitFor(() => zone.entity(p.entityId)?.fields.frame === frame, 5000, 'the last input applied');
      expect(p.corrections, `${stamps ? 'stamped' : 'no time'}`).toEqual([]);
      expect(zone.movement!.recent.filter((r) => r.entity === p.entityId)).toEqual([]);
      // (and a client that sends no time is logged as such, once)
      expect(warnings.filter((w) => w.msg.includes('sends no time') && w.obj.entity === p.entityId).length).toBe(stamps ? 0 : 1);
      p.close();
    }
  });

  it('snaps back a client that teleports and speeds, logs it, and kicks it when it keeps on', async () => {
    const p = await Pilot.join(server);
    const out = await takeOff(p);
    const before = warnings.length;

    // a teleport: 3 km in one input
    const valid = p.last;
    const seq = p.send({ ...valid, pos: [out[0], out[1], out[2] + 3000] }, 'ship');
    await waitFor(() => p.corrections.length === 1, 5000, 'the correction');
    expect(p.corrections[0]).toEqual({ t: 'correction', seq, pose: valid, mode: 'ship' });
    const zone = zoneOf(p);
    expect(zone.entity(p.entityId)!.fields.pos).toEqual(valid.pos);
    await waitFor(() => warnings.length > before, 2000, 'the log line');
    expect(warnings.find((w) => w.msg === 'movement corrected' && w.obj.entity === p.entityId)?.obj).toMatchObject({
      zone: p.welcome.zone.id,
      account: p.accountId,
      character: p.characterId,
      seq,
      rule: 'teleport',
      unit: 'm',
    });
    const logged = warnings.find((w) => w.msg === 'movement corrected' && w.obj.entity === p.entityId)!.obj;
    expect(logged.measured as number).toBeGreaterThan(logged.allowed as number);

    // it takes the correction, then flies at three times the space cap
    await new Promise((r) => setTimeout(r, MOVEMENT.correction.graceS * 1000));
    const fast = flightCaps(shipStats(DEFAULT_LOADOUT.ship!), 'space').allowed * 3;
    const from = valid.pos as Vec3;
    await p.fly([from, [from[0], from[1], from[2] + 2000]], [fast]);
    await waitFor(() => p.corrections.length > 1, 5000, 'a correction for speeding');
    const speeding = p.corrections[1]!;
    expect(speeding.mode).toBe('ship');
    // back to where the too-fast window began: no further along than the first pose it flew from there
    expect(speeding.pose.pos[2] - from[2]).toBeLessThan(fast * 0.15);
    expect(warnings.some((w) => w.msg === 'movement corrected' && w.obj.entity === p.entityId && w.obj.rule === 'speed')).toBe(true);

    // and keeps cheating: refused with `kicked`
    for (let i = 0; i < 400 && p.sock.ws.readyState === p.sock.ws.OPEN; i++) {
      p.send({ ...valid, pos: [from[0] + 2000 + i, from[1], from[2]] }, 'ship');
      await new Promise((r) => setTimeout(r, 50));
    }
    const refused = await p.sock.next('refused', 1000);
    expect(refused.code).toBe('kicked');
    expect(p.corrections.length).toBe(MOVEMENT.kick.count);
    expect(warnings.some((w) => w.msg.includes('kicked') && w.obj.character === p.characterId && w.obj.account === p.accountId)).toBe(true);
    await p.sock.closed;
    await waitFor(() => zone.entity(p.entityId) === undefined, 5000, 'its entity out of the zone');
    expect(zone.movement!.recent.filter((r) => r.entity === p.entityId).map((r) => r.rule)).toContain('teleport');
  });

  it('keeps a client that claims to be on foot in mid-flight a ship to everyone else', async () => {
    const p = await Pilot.join(server);
    const watcher = await Pilot.join(server);
    const out = await takeOff(p);
    p.send({ ...p.last, pos: [out[0], out[1] + 1, out[2]] }, 'foot');
    const c = await p.sock.next('correction');
    expect(c.mode).toBe('ship');
    expect(zoneOf(p).entity(p.entityId)!.fields.mode).toBe('ship');
    await waitFor(() => watcher.client.latest.get(p.entityId)?.mode === 'ship', 5000, 'the watcher to see a ship');
    p.close();
    watcher.close();
  });
});
