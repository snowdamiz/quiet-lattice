// The exo-suit's meters on the server (P1.E06.T06, DESIGN 9.8): life support and hazard protection run from timestamps like
// heat, drain by the place the server believes the character is in, the night and the build, refill in a station and where
// nothing is hard, and top up aboard; a refill at the line spends the character's real inventory (a crafted cartridge, else
// 10 raw units); health is lost at zero and regained through combat's suit vitals, which put the character down; all of it
// from the server's clock, with or without the client sending inputs.
import { SUIT } from '@astra/shared/data';
import type { Hazard } from '@astra/shared/data';
import { countOf } from '@astra/shared/inventory';
import type { ClientMessage } from '@astra/shared/protocol';
import type { MeterNotice } from './service.ts';
import type { MeterView } from '@astra/shared/meters';
import type { ShipLoadout } from '@astra/shared/ships';
import { dirToLocal, systemPoses, type Vec3 } from '@astra/shared/world';
import { describe, expect, it, vi } from 'vitest';
import type { DownedReport } from '../combat/zone.ts';
import { DEFAULT_LOADOUT, InventoryService } from '../inventory/service.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { MeterService, inventorySupplies } from './service.ts';

type Input = Extract<ClientMessage, { t: 'input' }>;
const LARK: ShipLoadout = { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 };
const ID = 'c1';
const BASE = describeZoneSystem(0);

class Viewer implements ZoneViewer {
  readonly characterId = ID;
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

/** The system with its home world made `type`, carrying `hazard` (a ship hazard of `dps`, or none). */
function worldOf(type: string, hazard: { kind: Hazard; dps: number } | null) {
  const d = structuredClone(BASE);
  const b = d.bodies[d.home]!;
  (b as { type: string }).type = type;
  (b.params as { type: string }).type = type;
  (b.params as { hazard: unknown }).hazard = hazard ? { ...hazard, label: hazard.kind, ceiling: 9000 } : null;
  return d;
}

interface Opts {
  owned?: string[];
  type?: string;
  hazard?: { kind: Hazard; dps: number } | null;
  stock?: Record<string, number>;
  people?: 'ulgani';
  saved?: { lifeSupport?: number; hazard?: number };
  combat?: boolean;
}

/** A service over one zone with the character's entity in it, its real inventory and the time. */
function rig(opts: Opts = {}) {
  const downed: DownedReport[] = [];
  const zone = new Zone({
    id: 'sys:0',
    systemIndex: 0,
    system: worldOf(opts.type ?? 'lush', opts.hazard === undefined ? null : opts.hazard),
    fauna: false,
    combat: () => ({ downed: (r) => downed.push(r) }),
  });
  const viewer = new Viewer(1);
  let owned: readonly string[] = opts.owned ?? [];
  let inCombat = opts.combat ?? false;
  const inventory = new InventoryService();
  inventory.open(ID, { loadout: DEFAULT_LOADOUT });
  for (const [item, n] of Object.entries(opts.stock ?? {})) inventory.grant(ID, item, n);
  const meters = new MeterService({
    ships: { get: () => LARK },
    skills: { owned: () => owned },
    zones: { zoneOf: () => zone },
    supplies: inventorySupplies(inventory),
    inCombat: () => inCombat,
  });
  const pushes: { view: MeterView; notice?: MeterNotice }[] = [];
  meters.subscribe((_, view, notice) => pushes.push({ view, notice }));
  let now = 2.3e7;
  zone.step(now);
  meters.open(ID, { heat: 0, overheated: false, charge: 100, lifeSupport: 100, hazard: 100, at: now, ...opts.saved });
  const entityId = zone.join(viewer, {
    kind: 'player',
    frame: zone.stationFrame,
    pos: [0, 0, 0],
    quat: [0, 0, 0, 1],
    vel: [0, 0, 0],
    mode: 'docked',
    ...(opts.people ? { people: opts.people } : {}),
  });
  zone.combat.joined(entityId, { characterId: ID, ship: LARK, skills: owned as string[] });
  meters.locate(ID, viewer, now);
  let seq = 0;
  const send = (mode: Input['mode'], frame: string | null, pos: Vec3): void => {
    const msg: Input = { t: 'input', seq: ++seq, time: now, mode, pose: { frame, pos, quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 };
    meters.claim(ID, msg, now);
    expect(zone.input(viewer, msg)).toBe('ok');
    meters.input(ID, viewer, msg, now);
  };
  /** The home world, `alt` m over its sea level, on its day or its night side. */
  const home = (night: boolean, alt = 2): { frame: string; pos: Vec3 } => {
    const d = zone.system;
    const p = systemPoses(d, zone.time).bodies[d.home]!;
    const [x, y, z] = p.position;
    const l = Math.hypot(x, y, z);
    const s = night ? 1 : -1;
    const local = dirToLocal(p, [(s * x) / l, (s * y) / l, (s * z) / l]);
    const r = d.bodies[d.home]!.radius + alt;
    return { frame: `${d.seed}:${d.home}`, pos: [local[0] * r, local[1] * r, local[2] * r] };
  };
  const t = {
    zone,
    viewer,
    meters,
    inventory,
    downed,
    pushes,
    entityId,
    send,
    home,
    get now() {
      return now;
    },
    wait(s: number) {
      now += s;
      zone.step(now);
    },
    own(nodes: string[]) {
      owned = nodes;
    },
    combatOn(v: boolean) {
      inCombat = v;
    },
    /** On the home world on foot, then `s` seconds of the server's time with the client sending nothing more. */
    stand(night = false, s = 0) {
      const at = home(night);
      send('foot', at.frame, at.pos);
      t.wait(s);
      meters.sweep(now);
    },
    /** The server's sweep at the current time (it brings every character on foot up to date). */
    sweep: () => meters.sweep(now),
    view: () => meters.view(ID, now),
    held: (item: string) => countOf(inventory.get(ID)!, item),
    health: () => zone.combat.playerHealth(entityId)!,
  };
  return t;
}

describe('life support and hazard protection drain from the place the server believes', () => {
  it('life support drains 0.35/s on a world with nothing hard on the suit, and hazard protection holds full', () => {
    const t = rig();
    t.stand(false, 20);
    const v = t.view();
    expect(v.lifeSupport).toBeCloseTo(100 - 7, 3);
    expect(v.hazard).toBe(100);
  });

  it.each(Object.entries(SUIT.hazardKind))('hazard protection drains by a %s hazard (strength %s at 5 dps) 0.6 a second per unit', (kind, perDps) => {
    const t = rig({ hazard: { kind: kind as Hazard, dps: SUIT.hazardRefDps } });
    t.stand(false, 10);
    expect(t.view().hazard).toBeCloseTo(100 - 10 * 0.6 * perDps!, 3);
  });

  it('a world’s own hazard drains it where its ship hazard says nothing (a frozen world: strength 1)', () => {
    const t = rig({ type: 'frozen' });
    t.stand(false, 10);
    expect(t.view().hazard).toBeCloseTo(94, 3);
  });

  it('drains ×1.4 at night, by the star below the horizon', () => {
    const day = rig({ type: 'frozen' });
    day.stand(false, 10);
    const night = rig({ type: 'frozen' });
    night.stand(true, 10);
    expect(night.view().hazard).toBeCloseTo(100 - 8.4, 3);
    expect(100 - day.view().hazard).toBeCloseTo(6, 3);
  });

  it('regains where nothing is hard, 2/s', () => {
    const t = rig({ saved: { hazard: 50 } });
    t.stand(false, 10);
    expect(t.view().hazard).toBeCloseTo(70, 3);
  });

  it('refills inside a station, 5/s and 10/s', () => {
    const t = rig({ saved: { lifeSupport: 10, hazard: 10 } });
    t.send('foot', t.zone.stationFrame, [-22, 0, -22]);
    t.wait(4);
    expect(t.view()).toMatchObject({ lifeSupport: 30, hazard: 50 });
  });

  it('does not move aboard a ship, which tops it up', () => {
    const t = rig({ saved: { lifeSupport: 10, hazard: 10 } });
    t.wait(10);
    t.send('docked', t.zone.stationFrame, [0, 0, 0]);
    expect(t.view()).toMatchObject({ lifeSupport: 100, hazard: 100 });
    t.wait(30);
    expect(t.view()).toMatchObject({ lifeSupport: 100, hazard: 100 });
  });

  it('boarding from a hazard tops it up', () => {
    const t = rig({ type: 'frozen' });
    t.stand(false, 20);
    expect(t.view().hazard).toBeLessThan(90);
    const at = t.home(false);
    t.send('landed', at.frame, at.pos);
    expect(t.view()).toMatchObject({ lifeSupport: 100, hazard: 100 });
  });

  it('stands still while the character is away, and runs from its first input', () => {
    const t = rig({ type: 'frozen', saved: { lifeSupport: 80, hazard: 70 } });
    t.wait(500);
    expect(t.view()).toMatchObject({ lifeSupport: 80, hazard: 70 });
    t.stand(false, 10);
    expect(t.view().hazard).toBeCloseTo(64, 3);
  });

  it('runs on the server’s clock whether or not inputs come, and the same however they are spread', () => {
    const quiet = rig({ type: 'frozen' });
    quiet.stand(false, 60);
    const busy = rig({ type: 'frozen' });
    const at = busy.home(false);
    busy.send('foot', at.frame, at.pos);
    for (let i = 0; i < 120; i++) {
      busy.wait(0.5);
      busy.send('foot', at.frame, at.pos);
    }
    expect(busy.view().hazard).toBeCloseTo(quiet.view().hazard, 6);
    expect(busy.view().lifeSupport).toBeCloseTo(quiet.view().lifeSupport, 6);
  });

  it('is saved with the rest and comes back as it was left', () => {
    const t = rig({ type: 'frozen' });
    t.stand(false, 10);
    const saved = t.meters.close(ID)!;
    expect(saved.hazard).toBeCloseTo(94, 6);
    expect(saved.lifeSupport).toBeCloseTo(96.5, 6);
  });
});

describe('the build', () => {
  const hazardLost = (opts: Opts, night = false, s = 10) => {
    const t = rig({ type: 'frozen', ...opts });
    t.stand(night, s);
    return 100 - t.view().hazard;
  };

  it('Hazard Weave: 40% slower, after the night’s ×1.4', () => {
    expect(hazardLost({ owned: ['hazard_weave'] })).toBeCloseTo(3.6, 3);
    expect(hazardLost({ owned: ['hazard_weave'] }, true)).toBeCloseTo(8.4 * 0.6, 3);
  });

  it('Cold Blood: none at night on a frozen world, the plain drain by day', () => {
    expect(hazardLost({ owned: ['cold_blood'] }, true)).toBe(0);
    expect(hazardLost({ owned: ['cold_blood'] })).toBeCloseTo(6, 3);
  });

  it('Heat Shroud: none by day on a desert world, the plain drain at night and on a frozen one', () => {
    expect(hazardLost({ owned: ['heat_shroud'], type: 'desert' })).toBe(0);
    expect(hazardLost({ owned: ['heat_shroud'], type: 'desert' }, true)).toBeCloseTo(8.4, 3);
    expect(hazardLost({ owned: ['heat_shroud'] })).toBeCloseTo(6, 3);
  });

  it('the Ulgani’s perk: none on a toxic world, the plain drain on another', () => {
    expect(hazardLost({ people: 'ulgani', type: 'toxic' })).toBe(0);
    expect(hazardLost({ people: 'ulgani' })).toBeCloseTo(6, 3);
  });

  it('Second Lung: life support drains 30% slower', () => {
    const t = rig({ owned: ['second_lung'] });
    t.stand(false, 20);
    expect(t.view().lifeSupport).toBeCloseTo(100 - 20 * 0.245, 3);
  });

  it('Deep Diver: a crushing world’s hazard ÷3', () => {
    expect(hazardLost({ owned: ['deep_diver'], type: 'crushing', hazard: { kind: 'pressure', dps: 5 } })).toBeCloseTo((10 * 0.6 * 6) / 3, 3);
  });

  it('a build bought mid-session takes effect from then', () => {
    const t = rig({ type: 'frozen' });
    t.stand(false, 10);
    t.own(['hazard_weave']);
    t.wait(10);
    expect(t.view().hazard).toBeCloseTo(100 - 6 - 3.6, 3);
  });

  it('Second Skin: nothing drops below 20 out of combat, and drains on in combat', () => {
    const t = rig({ type: 'frozen', owned: ['second_skin'], saved: { lifeSupport: 30, hazard: 30 } });
    t.stand(false, 600);
    expect(t.view()).toMatchObject({ lifeSupport: 20, hazard: 20 });
    expect(t.health().suit).toBe(t.health().suitMax);
    t.combatOn(true);
    t.wait(600);
    expect(t.view()).toMatchObject({ lifeSupport: 0, hazard: 0 });
  });
});

describe('refills spend the character’s real inventory', () => {
  /** Hazard protection 30 on a frozen world by day drains 0.6/s: the line is reached at (30 − 25) / 0.6 s. */
  const TO_LINE = 5 / 0.6;

  it('takes 10 raw sodium at the line and restores 40, at the moment it was crossed', () => {
    const t = rig({ type: 'frozen', stock: { sodium: 50 }, saved: { hazard: 30 } });
    t.stand(false, TO_LINE + 5);
    expect(t.held('sodium')).toBe(40);
    expect(t.view().hazard).toBeCloseTo(25 + 40 - 5 * 0.6, 3);
  });

  it('takes 10 raw oxygen for life support too', () => {
    const t = rig({ stock: { oxygen: 25 }, saved: { lifeSupport: 26 } });
    t.stand(false, 10);
    expect(t.held('oxygen')).toBe(15);
    expect(t.view().lifeSupport).toBeCloseTo(25 + 40 - (10 - 1 / 0.35) * 0.35, 3);
  });

  it('Cartridge Recycler: the refill restores 60', () => {
    const t = rig({ type: 'frozen', owned: ['cartridge_recycler'], stock: { sodium: 50 }, saved: { hazard: 30 } });
    t.stand(false, TO_LINE + 1);
    expect(t.held('sodium')).toBe(40);
    expect(t.view().hazard).toBeCloseTo(25 + 60 - 0.6, 3);
  });

  it('a crafted cartridge first, one item, restoring 60 (80 with Cartridge Recycler)', () => {
    for (const [owned, restored] of [[[], 60], [['cartridge_recycler'], 80]] as const) {
      const t = rig({ type: 'frozen', owned: [...owned], stock: { sodium: 50, sodium_cartridge: 2 }, saved: { hazard: 30 } });
      t.stand(false, TO_LINE + 1);
      expect(t.held('sodium_cartridge')).toBe(1);
      expect(t.held('sodium')).toBe(50);
      expect(t.view().hazard).toBeCloseTo(Math.min(100, 25 + restored) - 0.6, 3);
    }
  });

  it('an oxygen cartridge refills life support', () => {
    const t = rig({ stock: { oxygen_cartridge: 1 }, saved: { lifeSupport: 26 } });
    t.stand(false, 10);
    expect(t.held('oxygen_cartridge')).toBe(0);
    expect(t.view().lifeSupport).toBeGreaterThan(70);
  });

  it('refills as many times as a long stretch needs, each taking 10', () => {
    const t = rig({ type: 'frozen', stock: { sodium: 100 }, saved: { hazard: 30 } });
    t.stand(false, 600);
    // 600 s at 0.6 = 360 lost, 5 from the start and 40 a refill: 9 refills (with 5 left over to the next line)
    expect(t.held('sodium')).toBe(100 - 90);
    expect(t.view().hazard).toBeGreaterThanOrEqual(25 - 1e-9);
    expect(t.view().hazard).toBeCloseTo(30 + 9 * 40 - 360, 3);
  });

  it('refills nothing without enough: fewer than 10 raw units, or none', () => {
    const t = rig({ type: 'frozen', stock: { sodium: 9 }, saved: { hazard: 30 } });
    t.stand(false, 20);
    expect(t.held('sodium')).toBe(9);
    expect(t.view().hazard).toBeCloseTo(30 - 12, 3);
  });

  it('refills nothing in a station or where the meter regains by itself, and a refill is told with a toast', () => {
    const calm = rig({ stock: { sodium: 50 }, saved: { hazard: 10 } });
    calm.stand(false, 5);
    expect(calm.held('sodium')).toBe(50);
    const t = rig({ type: 'frozen', stock: { sodium: 50 }, saved: { hazard: 30 } });
    t.stand(false, TO_LINE + 1);
    const told = t.pushes.filter((p) => p.notice);
    expect(told).toHaveLength(1);
    expect(told[0]!.notice).toEqual({ text: 'Hazard protection recharged', tone: 'good' });
    expect(told[0]!.view.hazard).toBeGreaterThan(60);
  });

  it('spends what the server holds, not what a client claims: the inventory changes as one pushed state', () => {
    const t = rig({ type: 'frozen', stock: { sodium: 12 }, saved: { hazard: 30 } });
    const pushed: number[] = [];
    t.inventory.subscribe((_, reply) => pushed.push(countOf(reply.inventory, 'sodium')));
    t.stand(false, TO_LINE + 1);
    expect(pushed).toEqual([2]);
  });
});

describe('health through combat’s suit vitals', () => {
  it('is lost at 4/s while a meter is at zero, from the moment it reached it', () => {
    const t = rig({ type: 'frozen', saved: { hazard: 6 } });
    t.stand(false, 20);
    // 10 s to zero, then 10 s at 4/s
    expect(t.view().hazard).toBe(0);
    expect(t.health().suit).toBeCloseTo(100 - 40, 3);
    expect(t.health().down).toBeNull();
  });

  it('is regained at 1.5/s while both hold, and not past the suit’s health', () => {
    const t = rig({ type: 'frozen', saved: { hazard: 6 } });
    t.stand(false, 20);
    const hurt = t.health().suit;
    t.wait(1);
    t.sweep();
    // (still at zero: the hurt goes on)
    expect(t.health().suit).toBeLessThan(hurt);
    const calm = rig();
    calm.stand(false, 1);
    calm.zone.combat.suitHealth(calm.entityId, -50);
    calm.wait(10);
    calm.sweep();
    expect(calm.health().suit).toBeCloseTo(50 + 15, 3);
    calm.wait(100);
    calm.sweep();
    expect(calm.health().suit).toBe(100);
  });

  it('is regained after a refill ends it', () => {
    const t = rig({ type: 'frozen', saved: { hazard: 0 } });
    t.stand(false, 5);
    expect(t.health().suit).toBeCloseTo(80, 3);
    t.inventory.grant(ID, 'sodium', 50);
    // the refill comes on the next advance, at once: back to regaining
    t.wait(10);
    t.sweep();
    expect(t.health().suit).toBeGreaterThan(70);
    expect(t.view().hazard).toBeGreaterThan(30);
  });

  it('is neither lost nor regained in a station or aboard', () => {
    const t = rig({ saved: { lifeSupport: 0, hazard: 0 } });
    t.send('foot', t.zone.stationFrame, [-22, 0, -22]);
    t.wait(5);
    expect(t.health().suit).toBe(100);
  });

  it('does not put the character in combat', () => {
    const t = rig({ type: 'frozen', saved: { hazard: 0 } });
    const engaged = vi.spyOn(t.zone.combat, 'applyDamage');
    t.stand(false, 5);
    expect(engaged).not.toHaveBeenCalled();
  });
});

describe('a hazard death is decided by the server', () => {
  it('puts the character down when its health runs out at zero, with no client input after the first', () => {
    const t = rig({ type: 'frozen', saved: { hazard: 6 } });
    const at = t.home(false);
    t.send('foot', at.frame, at.pos);
    for (let s = 0; s < 40; s++) {
      t.wait(1);
      t.meters.sweep(t.now);
    }
    // 10 s to zero, 25 s to lose 100 health at 4/s
    expect(t.downed).toHaveLength(1);
    expect(t.downed[0]).toMatchObject({ cause: 'suit', characterId: ID, source: null, entity: t.entityId });
    expect(t.downed[0]!.at).toBeCloseTo(t.now - 40 + 35, 0);
    expect(t.health()).toMatchObject({ suit: 0, down: 'suit' });
    expect(t.zone.combat.isDown(t.entityId)).toBe(true);
    expect(t.zone.entity(t.entityId)!.fields.hp).toBe(0);
  });

  it('is decided once, and by a single long stretch as by many short ones', () => {
    const t = rig({ type: 'frozen', saved: { hazard: 0 } });
    t.stand(false, 0);
    t.wait(500);
    t.meters.sweep(t.now);
    t.wait(500);
    t.meters.sweep(t.now);
    expect(t.downed).toHaveLength(1);
  });

  it('is not decided while a refill keeps the meter up', () => {
    const t = rig({ type: 'frozen', stock: { sodium: 1000, oxygen: 1000 }, saved: { hazard: 30 } });
    t.stand(false, 0);
    for (let s = 0; s < 300; s++) {
      t.wait(1);
      t.meters.sweep(t.now);
    }
    expect(t.downed).toEqual([]);
    expect(t.health().suit).toBe(100);
    expect(t.held('sodium')).toBeLessThan(1000);
  });

  it('is not decided in a station or aboard, at zero', () => {
    const t = rig({ saved: { lifeSupport: 0, hazard: 0 } });
    t.send('foot', t.zone.stationFrame, [-22, 0, -22]);
    for (let s = 0; s < 60; s++) {
      t.wait(1);
      t.meters.sweep(t.now);
    }
    expect(t.downed).toEqual([]);
  });

  it('is decided for life support at zero as for hazard protection', () => {
    const t = rig({ saved: { lifeSupport: 0 } });
    t.stand(false, 0);
    t.wait(30);
    t.meters.sweep(t.now);
    expect(t.downed).toHaveLength(1);
  });
});

describe('what the client is told', () => {
  it('both meters are in the view and the save', () => {
    const t = rig({ type: 'frozen' });
    t.stand(false, 10);
    expect(t.view()).toMatchObject({ lifeSupport: expect.closeTo(96.5, 3), hazard: expect.closeTo(94, 3) });
    expect(t.meters.get(ID)).toMatchObject({ lifeSupport: expect.any(Number), hazard: expect.any(Number) });
  });

  it('is pushed as the suit moves, not every instant, and at once when a meter reaches zero', () => {
    const t = rig({ type: 'frozen', saved: { hazard: 3 } });
    const at = t.home(false);
    t.send('foot', at.frame, at.pos);
    const first = t.pushes.length;
    t.wait(0.5);
    t.meters.sweep(t.now);
    // 0.5 s moves nothing worth a message
    expect(t.pushes.length).toBe(first);
    t.wait(5);
    t.meters.sweep(t.now);
    expect(t.pushes.length).toBe(first + 1);
    // the hazard meter reached zero within this stretch: told at once, with the meter at zero
    expect(t.pushes.at(-1)!.view.hazard).toBe(0);
  });
});
