// Gravitic's client hooks (P1.E07.T04): the cast events the server sends make the client do its own part and nothing it would
// have to decide: the jetpack cut for a Slam's fall, an Inertial Brake's stop, the rocks a Tractor Beam draws, a held ship's
// thrusters, a Mass Sense scan's heavy creatures, and Heavy Footing's landings.
import { GRAVITIC_NUMBERS, LANDING, landingOf } from '@astra/shared/abilities';
import { getSkillNode } from '@astra/shared/data';
import { describeGalaxySystem, faunaSpecies, frameId, Galaxy, GALAXY_SEED } from '@astra/shared/world';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Game } from '../Game.js';
import { Asteroids } from '../universe/Asteroids.js';
import { Player } from '../entities/Player.js';
import { Ship } from '../entities/Ship.js';
import { playAbilityFx } from '../net/abilities.js';
import './graviticFx.js';

const ME = 7;
const game = () => ({ net: { entityId: ME }, player: { slam: vi.fn() }, ship: { brake: vi.fn(), hold: vi.fn() }, asteroids: { tractor: vi.fn() } });
const event = (node, extra = {}) => ({ kind: 'cast', node, phase: 'cast', at: 1, frame: 'f:1', aim: [0, 0, -1], ...extra });

describe('Slam', () => {
  it('cuts this player’s jetpack, and no other player’s', () => {
    const g = game();
    playAbilityFx(g, event('slam', { caster: ME }));
    expect(g.player.slam).toHaveBeenCalledTimes(1);
    playAbilityFx(g, event('slam', { caster: 9 }));
    playAbilityFx(g, event('slam'));
    expect(g.player.slam).toHaveBeenCalledTimes(1);
  });
});

describe('Inertial Brake', () => {
  it('stops this player’s ship and keeps it steady in gusts for the node’s 6 s', () => {
    const g = game();
    playAbilityFx(g, event('inertial_brake', { caster: ME }));
    expect(g.ship.brake).toHaveBeenCalledWith(6);
    playAbilityFx(g, event('inertial_brake', { caster: 3 }));
    expect(g.ship.brake).toHaveBeenCalledTimes(1);
  });

  it('zeroes the ship’s speed, velocity and turning at once and shrugs off the storm’s gusts until it ends', () => {
    const ship = Object.assign(Object.create(Ship.prototype), {
      _speed: 400,
      throttle: 0.8,
      stats: { speed: { space: 600 } },
      state: { vel: new THREE.Vector3(400, 0, 0) },
      angVel: new THREE.Vector3(1, 2, 3),
      wind: new THREE.Vector3(5, 0, 5),
      game: { time: 100 },
    });
    ship.brake(6);
    expect(ship.speed).toBe(0);
    expect(ship.state.vel.length()).toBe(0);
    expect(ship.angVel.length()).toBe(0);
    expect(ship.wind.length()).toBe(0);
    expect(ship.stormImmuneUntil).toBe(106);
  });
});

describe('Tractor Beam', () => {
  it('draws rocks to this player’s hull, and holds the ship it names if that is this player’s', () => {
    const g = game();
    playAbilityFx(g, event('tractor_beam', { caster: ME }));
    expect(g.asteroids.tractor).toHaveBeenCalledWith(g.ship, GRAVITIC_NUMBERS.tractor.rangeM, 3);
    playAbilityFx(g, event('tractor_beam', { caster: 3, target: ME }));
    expect(g.ship.hold).toHaveBeenCalledWith(3);
    expect(g.asteroids.tractor).toHaveBeenCalledTimes(1);
    playAbilityFx(g, event('tractor_beam', { caster: 3, target: 5 }));
    expect(g.ship.hold).toHaveBeenCalledTimes(1);
  });

  it('pulls the nearest rocks ahead of the hull to it and no farther than its standoff, and leaves the rest', () => {
    const rock = (x, y, z, size = 20) => ({ id: `${x}${y}${z}`, pos: new THREE.Vector3(x, y, z), size });
    const ahead = rock(0, 0, -400);
    const aside = rock(400, 0, 0);
    const behind = rock(0, 0, 300);
    const beyond = rock(0, 0, -900);
    const ship = {
      mode: 'flying',
      state: { worldPosition: (out) => out.set(0, 0, 0), worldDir: (v, out) => out.copy(v), quat: new THREE.Quaternion() },
    };
    const asteroids = Object.assign(Object.create(Asteroids.prototype), {
      game: { time: 10, ship },
      list: [ahead, aside, behind, beyond],
      debris: [],
      drawn: [],
      drawnUntil: 0,
    });
    asteroids.tractor(ship, 500, 3);
    expect(asteroids.drawn).toEqual([ahead]);
    for (let i = 0; i < 30; i++) asteroids.updateDrawn(0.1);
    expect(ahead.pos.length()).toBeCloseTo(20 + 30, 0);
    expect(aside.pos.length()).toBe(400);
    expect(behind.pos.length()).toBe(300);
    asteroids.game.time = 14;
    asteroids.updateDrawn(0.1);
    expect(asteroids.drawn).toEqual([]);
  });

  it('holds a ship still for the beam’s 3 s', () => {
    const ship = Object.assign(Object.create(Ship.prototype), {
      _speed: 100,
      throttle: 0.2,
      stats: { speed: { space: 600 } },
      state: { vel: new THREE.Vector3(100, 0, 0) },
      game: { time: 50, hud: { toast: vi.fn() } },
    });
    ship.hold(3);
    expect(ship.heldUntil).toBe(53);
    expect(ship.speed).toBe(0);
    expect(ship.state.vel.length()).toBe(0);
  });
});

describe('Heavy Footing', () => {
  it('takes away a hard landing’s damage and its stagger, and not the thud’s sound', () => {
    const fall = LANDING.damageFrom + 6;
    expect(landingOf(fall, [])).toEqual({ thud: true, shake: 1, damage: 24 });
    expect(landingOf(fall, ['heavy_footing'])).toEqual({ thud: true, shake: 0, damage: 0 });
    expect(landingOf(5, ['heavy_footing'])).toEqual({ thud: false, shake: 0, damage: 0 });
    expect(getSkillNode('heavy_footing').flags).toEqual(['no_fall_damage', 'no_landing_stagger']);
  });

  it('the walker takes the build’s nodes (setBuild) and Slam cuts its jetpack until it lands', () => {
    const p = Object.assign(Object.create(Player.prototype), { walker: null, skills: [], slamming: false, jetting: true });
    p.setBuild({ skills: ['heavy_footing'] });
    expect(p.skills).toEqual(['heavy_footing']);
    p.slam();
    expect(p.slamming).toBe(true);
    expect(p.jetting).toBe(false);
  });
});

describe('Mass Sense', () => {
  // system 0's first world with a heavy species at tier 3
  const system = describeGalaxySystem(new Galaxy(GALAXY_SEED).systems[0]);
  const world = system.bodies.find((b) => b.type !== 'gas' && faunaSpecies(b.params, 3).some((x) => x.bodyPlan === 'quad_heavy'));
  const species = faunaSpecies(world.params, 3);
  const bull = species.find((x) => x.bodyPlan === 'quad_heavy');
  const other = species.find((x) => x.bodyPlan !== 'quad_heavy');
  const frame = frameId(system.seed, world.index);

  const setup = (skills) => {
    const entities = new Map([
      [1, { kind: 'mob', frame, pos: [100, 0, 0], species: bull.index }],
      [2, { kind: 'mob', frame, pos: [100, 0, 0], species: other.index }],
      [3, { kind: 'mob', frame, pos: [900, 0, 0], species: bull.index }],
      [4, { kind: 'mob', frame: 'elsewhere', pos: [100, 0, 0], species: bull.index }],
      [5, { kind: 'player', frame, pos: [100, 0, 0] }],
    ]);
    const planet = { params: world.params, ground: { tier: 3 } };
    return Object.assign(Object.create(Game.prototype), {
      system: { seed: system.seed, planets: Array.from({ length: world.index + 1 }, (_, i) => (i === world.index ? planet : {})) },
      station: {},
      net: { store: { entities } },
      player: { state: { frame: planet, pos: new THREE.Vector3() } },
      build: { skills },
    });
  };

  it('shows the heavy creatures in range through terrain, for a scanner that has it, and no others', () => {
    expect(other).toBeDefined();
    const game = setup(['mass_sense']);
    const seen = game.heavyCreatures(360);
    expect(seen.map((c) => c.label)).toEqual([bull.name]);
    expect(seen[0].pos.x).toBe(100);
    expect(seen[0].frame).toBe(game.player.state.frame);
  });

  it('shows nothing without the node, and nothing out of the scan’s range', () => {
    expect(setup([]).heavyCreatures(360)).toEqual([]);
    expect(setup(['mass_sense']).heavyCreatures(50)).toEqual([]);
  });

  it('puts them among the scan’s markers with the deposits', () => {
    const game = setup(['mass_sense']);
    Object.assign(game, {
      time: 5,
      hud: { scanPulse: vi.fn(), toast: vi.fn() },
      audio: { play: vi.fn() },
      suitMods: [],
      flora: { scan: () => [{ label: 'Iron', pos: new THREE.Vector3(1, 2, 3), frame: game.player.state.frame }] },
      structures: { scanReveal: () => ({ nearest: null }) },
    });
    game.revealScan();
    expect(game.scanMarkers.map((m) => m.label)).toEqual(['Iron', bull.name]);
    expect(game.hud.toast).toHaveBeenCalledWith('1 deposits nearby · 1 heavy creatures');
  });
});
