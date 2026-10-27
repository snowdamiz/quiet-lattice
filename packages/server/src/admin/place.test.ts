// Teleport placements from the CLI's words: frames by name, index or id; the presets; and what a join would refuse.
import { frameId, tierOfGalaxySystem, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { groundOf } from '../fauna/terrain.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { AdminError } from './commands.ts';
import { ORBIT_MIN_M, resolvePlacement, SURFACE_CLEARANCE_M } from './place.ts';

const SYSTEM = 0;
const desc = describeZoneSystem(SYSTEM);
const rocky = desc.bodies.find((b) => b.type !== 'gas')!;
const gas = desc.bodies.find((b) => b.type === 'gas');

function invalid(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AdminError);
    expect((err as AdminError).code).toBe('invalid');
    return (err as Error).message;
  }
  throw new Error('no error');
}

describe('teleport placements', () => {
  it('docks at the Waystation', () => {
    expect(resolvePlacement({ system: SYSTEM, frame: 'station', pose: 'docked' })).toEqual({
      system: SYSTEM,
      pose: { frame: frameId(desc.seed, 'station'), pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
      mode: 'docked',
    });
    expect(resolvePlacement({ system: SYSTEM, frame: `${desc.seed}:station`, pose: 'docked' }).pose.frame).toBe(frameId(desc.seed, 'station'));
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: String(rocky.index), pose: 'docked' }))).toMatch(/station frame/);
  });

  it('puts a ship in orbit above a body or out from the Waystation', () => {
    const above = resolvePlacement({ system: SYSTEM, frame: String(rocky.index), pose: 'orbit' });
    expect(above.pose.frame).toBe(frameId(desc.seed, rocky.index));
    expect(above.pose.pos).toEqual([rocky.radius + Math.max(ORBIT_MIN_M, Math.round(rocky.radius / 4)), 0, 0]);
    expect(above.mode).toBe('ship');
    expect(resolvePlacement({ system: SYSTEM, frame: String(rocky.index), pose: 'orbit:5000' }).pose.pos).toEqual([rocky.radius + 5000, 0, 0]);
    expect(resolvePlacement({ system: SYSTEM, frame: 'station', pose: 'orbit:300' }).pose.pos).toEqual([0, 0, 300]);
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: 'inertial', pose: 'orbit' }))).toMatch(/body or the station/);
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: 'station', pose: 'orbit:-1' }))).toMatch(/positive/);
  });

  it('stands a character on the drawn ground of a rocky body, on foot', () => {
    const at = resolvePlacement({ system: SYSTEM, frame: String(rocky.index), pose: 'surface:0,90' });
    expect(at.mode).toBe('foot');
    // latitude 0, longitude 90: along the frame's +z
    const [x, y, z] = at.pose.pos;
    expect(Math.abs(x)).toBeLessThan(1e-6 * rocky.radius);
    expect(Math.abs(y)).toBeLessThan(1e-6 * rocky.radius);
    const params = rocky.params as PlanetParams;
    const ground = groundOf(params, tierOfGalaxySystem(SYSTEM)).sample([0, 0, 1]);
    expect(z).toBeCloseTo(rocky.radius + (params.hasOcean ? Math.max(0, ground) : ground) + SURFACE_CLEARANCE_M, 6);
    expect(resolvePlacement({ system: SYSTEM, frame: String(rocky.index), pose: 'surface', mode: 'landed' }).mode).toBe('landed');
    if (gas) expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: String(gas.index), pose: 'surface' }))).toMatch(/gas giant/);
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: 'station', pose: 'surface' }))).toMatch(/body frame/);
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: String(rocky.index), pose: 'surface:95,0' }))).toMatch(/lat/);
  });

  it('takes a position in the frame as metres, in a ship unless a mode is given', () => {
    expect(resolvePlacement({ system: SYSTEM, frame: 'inertial', pose: '1e9, 0, -5' })).toMatchObject({
      pose: { frame: null, pos: [1e9, 0, -5] },
      mode: 'ship',
    });
    expect(resolvePlacement({ system: SYSTEM, frame: 'station', pose: '10,0,0', mode: 'foot' }).mode).toBe('foot');
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: 'station', pose: '1,2' }))).toMatch(/x,y,z/);
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: 'station', pose: 'hover' }))).toMatch(/x,y,z/);
    // beyond what a join accepts
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: 'inertial', pose: '1e12,0,0' }))).toMatch(/out of range/);
  });

  it('refuses frames the system does not have', () => {
    expect(invalid(() => resolvePlacement({ system: 5000, frame: 'station', pose: 'docked' }))).toMatch(/no system 5000/);
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: String(desc.bodies.length), pose: 'orbit' }))).toMatch(/has no body/);
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: `${desc.seed + 1}:0`, pose: 'orbit' }))).toMatch(/not in this system/);
    expect(invalid(() => resolvePlacement({ system: SYSTEM, frame: 'moon', pose: 'orbit' }))).toMatch(/a frame is/);
  });
});
