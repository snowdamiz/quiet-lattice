// The Exo-suit's Tier I–II passives on the client (P1.E07.T10): the real Player walks, jumps and jets by the build the server's
// skill view names, and the real Game drains the suit, refills it from the pack and scans by it.
import * as THREE from 'three';
import { Galaxy, GALAXY_SEED, describeGalaxySystem } from '@astra/shared/world';
import { describe, expect, it, vi } from 'vitest';
import { Game } from './Game.js';
import { Inventory } from './gameplay/Inventory.js';
import { Body } from './universe/Body.js';
import { Player } from './entities/Player.js';

const DT = 1 / 60;

/** An Input with the keys held and the keys pressed this frame. */
const keys = (down = [], hit = []) => ({ mouseDX: 0, mouseDY: 0, down: (k) => down.includes(k), hit: (k) => hit.includes(k) });

/** A walker on a station's floor (a box under y = 0), grounded and facing −z. */
function walker(build) {
  const frame = { kind: 'station', colliders: [{ min: new THREE.Vector3(-500, -2, -500), max: new THREE.Vector3(500, 0, 500) }] };
  const p = new Player({ audio: null, hud: null });
  p.setBuild(build);
  p.state.frame = frame;
  p.state.pos.set(0, 0, 0);
  p.heading.set(0, 0, -1);
  p.grounded = true;
  return p;
}

function step(p, input, seconds) {
  for (let t = 0; t < seconds; t += DT) p.update(DT, input);
}

describe('the Player under the build', () => {
  it('Sprint Stride: sprints at 11.5 m/s, not 9.5', () => {
    for (const [skills, speed] of [[[], 9.5], [['sprint_stride'], 11.5]]) {
      const p = walker({ skills });
      step(p, keys(['KeyW', 'ShiftLeft']), 3);
      expect(p.sprinting).toBe(true);
      expect(p.hSpeed).toBeCloseTo(speed, 1);
    }
  });

  it('Long Jump: jumps at 7 m/s, not 5.5', () => {
    for (const [skills, speed] of [[[], 5.5], [['long_jump'], 7]]) {
      const p = walker({ skills });
      step(p, keys(), 0.2);
      p.update(DT, keys([], ['Space']));
      expect(p.state.vel.y).toBeCloseTo(speed, 6);
    }
  });

  it('Efficient Jetpack: a full tank lasts twice as long', () => {
    for (const [skills, seconds] of [[[], 1 / 0.42], [['efficient_jetpack'], 2 / 0.42]]) {
      const p = walker({ skills });
      p.grounded = false;
      p.airTime = 1;
      p.state.pos.set(0, 3000, 0);
      let t = 0;
      const jetting = keys(['Space']);
      while (p.jetFuel > 0 && t < 10) {
        p.update(DT, jetting);
        t += DT;
      }
      expect(t).toBeCloseTo(seconds, 1);
    }
  });

  it('follows the build when it changes: nothing owned, then Sprint Stride, then nothing', () => {
    const p = walker({ skills: [] });
    p.setBuild({ skills: ['sprint_stride'] });
    expect(p.walker.sprint).toBe(11.5);
    p.setBuild({ skills: [] });
    expect(p.walker.sprint).toBe(9.5);
  });
});

/** A Game with a frozen home world to stand on, day or night, and the parts updateSurvival and scan read. */
function onFrozenWorld({ night, skills = [], people }) {
  const d = describeGalaxySystem(new Galaxy(GALAXY_SEED).systems[0]);
  d.bodies[d.home] = { ...d.bodies[d.home], type: 'frozen' };
  const star = new Body({ name: d.star.name, kind: 'star', radius: d.star.radius });
  const planets = d.bodies.map(
    (b, i) =>
      new Body({
        name: b.name,
        kind: b.kind,
        parent: star,
        radius: b.radius,
        orbitRadius: b.orbitRadius,
        orbitPeriod: b.orbitPeriod,
        orbitPhase: b.orbitPhase,
        orbitTilt: new THREE.Quaternion().fromArray(b.orbitTilt),
        rotationPeriod: b.rotationPeriod,
        rotationPhase: b.rotationPhase,
        axialTilt: new THREE.Quaternion().fromArray(b.axialTilt),
        soi: b.soi,
      }),
  );
  const home = planets[d.home];
  home.params = { type: 'frozen', hazard: null };
  star.update(2.3e7);
  for (const p of planets) p.update(2.3e7);
  const g = Object.assign(Object.create(Game.prototype), {
    time: 2.3e7,
    mode: 'foot',
    system: { description: d, planets },
    inventory: new Inventory(),
    audio: { play: vi.fn() },
    hud: { toast: vi.fn() },
    build: { skills, people },
    universe: {},
    playerDied: vi.fn(),
  });
  g.player = new Player(g);
  g.suitMods = undefined;
  g.applyBuild();
  const away = new THREE.Vector3().copy(home.localToWorld(new THREE.Vector3(), new THREE.Vector3())).normalize();
  const dir = night ? away : away.clone().negate();
  g.player.state.frame = home;
  g.player.state.pos.copy(home.worldToLocal(dir.multiplyScalar(d.bodies[d.home].radius).add(home.localToWorld(new THREE.Vector3(), new THREE.Vector3())), new THREE.Vector3()));
  return g;
}

describe('the suit on a frozen world', () => {
  const drainOf = (g, seconds = 10) => {
    g.player.hazard = 100;
    for (let i = 0; i < seconds * 10; i++) g.updateSurvival(0.1);
    return 100 - g.player.hazard;
  };

  it('drains 0.6 a second by day and 0.84 at night, as the demo did', () => {
    expect(drainOf(onFrozenWorld({ night: false }))).toBeCloseTo(6, 6);
    expect(drainOf(onFrozenWorld({ night: true }))).toBeCloseTo(8.4, 6);
  });

  it('Hazard Weave: 40% slower', () => {
    expect(drainOf(onFrozenWorld({ night: false, skills: ['hazard_weave'] }))).toBeCloseTo(3.6, 6);
  });

  it('Cold Blood: no drain at night, the plain drain by day', () => {
    expect(drainOf(onFrozenWorld({ night: true, skills: ['cold_blood'] }))).toBe(0);
    expect(drainOf(onFrozenWorld({ night: false, skills: ['cold_blood'] }))).toBeCloseTo(6, 6);
  });

  it('Heat Shroud does nothing on a frozen world', () => {
    expect(drainOf(onFrozenWorld({ night: true, skills: ['heat_shroud'] }))).toBeCloseTo(8.4, 6);
  });

  it('Cartridge Recycler: the refill from the pack restores 60 and takes 10 sodium, not 40', () => {
    for (const [skills, restored] of [[[], 40], [['cartridge_recycler'], 60]]) {
      const g = onFrozenWorld({ night: false, skills });
      g.inventory.add('sodium', 50);
      g.player.hazard = 20;
      g.updateSurvival(0);
      expect(g.player.hazard).toBe(20 + restored);
      expect(g.inventory.has('sodium', 40) && !g.inventory.has('sodium', 41)).toBe(true);
    }
  });

  it('Cartridge Recycler: the oxygen refill restores 60 too', () => {
    const g = onFrozenWorld({ night: false, skills: ['cartridge_recycler'] });
    g.inventory.add('oxygen', 50);
    g.player.lifeSupport = 10;
    g.updateSurvival(0);
    expect(g.player.lifeSupport).toBe(70);
  });
});

describe('the scan under the build', () => {
  function scanning(skills) {
    const g = onFrozenWorld({ night: false, skills });
    const reach = [];
    Object.assign(g, {
      scanCooldown: 0,
      hud: { scanPulse: vi.fn(), toast: vi.fn() },
      flora: { scan: (_, range) => (reach.push(['deposits', range]), []) },
      structures: { scanReveal: (_, range) => (reach.push(['sites', range]), { nearest: null }) },
    });
    g.scan();
    return reach;
  }

  it('Scanner Lens: reveals sites to 6 km, not 3, and deposits still to 180 m', () => {
    expect(scanning([])).toEqual([['deposits', 180], ['sites', 3000]]);
    expect(scanning(['scanner_lens'])).toEqual([['deposits', 180], ['sites', 6000]]);
  });
});

describe('the build from the server', () => {
  it('is the bought nodes of each skill view, and the people of the character that entered', () => {
    const g = onFrozenWorld({ night: false });
    g.ship = { setSkills: vi.fn() };
    g.onSkills({ state: { bought: ['sprint_stride', 'cartridge_recycler'] } });
    expect(g.ship.setSkills).toHaveBeenLastCalledWith(['sprint_stride', 'cartridge_recycler']);
    expect(g.player.walker.sprint).toBe(11.5);
    expect(g.suitMods.some((m) => m.stat === 'suit.cartridge_restore')).toBe(true);
    g.onSkills({ state: { bought: [] } });
    expect(g.player.walker.sprint).toBe(9.5);
    expect(g.suitMods).toEqual([]);
  });
});
