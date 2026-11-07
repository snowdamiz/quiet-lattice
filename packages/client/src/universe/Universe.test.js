import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Galaxy, GALAXY_SEED } from '@astra/shared/world';
import { STATION_LAYOUT } from '@astra/shared/data';
import { Game } from '../Game.js';
import { Traffic } from '../entities/Traffic.js';
import { Universe } from './Universe.js';

const state = (frame) => ({ frame, pos: new THREE.Vector3(1, 2, 3), vel: new THREE.Vector3(4, 5, 6) });

describe('world tiers', () => {
  it('uses the first world message for the first playable system build', () => {
    const galaxy = new Galaxy(GALAXY_SEED);
    const game = { galaxy, mode: 'title', pool: {} };
    game.universe = new Universe(game);
    const tiers = galaxy.systems.map(() => 4);
    game.universe.applyWorld({ tiers });
    const out = {};
    const build = Game.prototype.buildSystem.call(game, galaxy.systems[0], out);
    build.next();
    expect(out.system.tier).toBe(4);
    expect(out.system.planets).toEqual([]);
    build.return();
    out.system.star.root.traverse((node) => { node.geometry?.dispose(); });
  });

  it.each(['ship', 'foot'])('keeps the player pad reserved before real traffic attaches during a tier rebuild in %s mode', (mode) => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const info = { seed: 1, x: 0, y: 0, z: 0 };
      const system = (tier) => {
        const star = { root: new THREE.Group(), position: new THREE.Vector3() };
        return { info, tier, star, bodies: [star], update: () => {} };
      };
      const station = () => ({ seed: 1, root: new THREE.Group(), pads: STATION_LAYOUT.pads.map((p) => ({ ...p, occupied: null })), update: () => {} });
      const old = station();
      const game = {
        mode, time: 0, galaxy: { systems: [info] }, system: system(0), station: old,
        ship: { model: new THREE.Group(), state: state(old), dockPad: old.pads[0], blend: { clear: () => {} } },
        player: { state: state(old), blend: { clear: () => {} } }, cam: state(old),
        engine: { scene: new THREE.Scene() }, prediction: { reset: () => {} },
        flora: { reset: () => {} }, fauna: { reset: () => {} }, structures: { setPlanet: () => {} }, cities: { setPlanet: () => {} },
        asteroids: { group: new THREE.Group(), configure: () => {} }, audio: { setMood: () => {} },
        loadSystem: Game.prototype.loadSystem, disposeSystem: Game.prototype.disposeSystem,
        *buildSystem() { yield; return { system: system(2), station: station() }; },
      };
      old.pads[0].occupied = game.ship;
      game.universe = new Universe(game);
      game.traffic = new Traffic(game);
      game.universe.applyWorld({ tiers: [2] });
      const reserved = game.station.pads[0];
      expect(game.traffic.ships).toHaveLength(5);
      expect(game.traffic.ships.filter((s) => s.state === 'parked')).toHaveLength(2);
      expect(game.ship.dockPad).toBe(reserved);
      expect(game.traffic.ships.some((s) => s.pad === reserved)).toBe(false);
      expect(reserved.occupied).toBe(game.ship);
      for (const s of game.traffic.ships) game.traffic.startDeparture(s, true);
      expect(reserved.occupied).toBe(game.ship);
    } finally {
      random.mockRestore();
    }
  });

  it('rebuilds a changed tier and drops stale preparation without moving the ship, walker or camera', () => {
    const info = { x: 0, y: 0, z: 0 };
    const body = () => ({ root: { visible: true }, position: new THREE.Vector3() });
    const star = body();
    const planet = body();
    const station = { ...body(), pads: [{}] };
    const game = {
      mode: 'foot', galaxy: { systems: [info] }, system: { info, tier: 0, star, bodies: [star, planet] }, station,
      ship: { state: state(station), dockPad: station.pads[0], blend: { clear: vi.fn() } },
      player: { state: state(planet), blend: { clear: vi.fn() } }, cam: state(planet), navTarget: planet,
      prediction: { reset: vi.fn() }, asteroids: { group: {} }, disposeSystem: vi.fn(),
    };
    const universe = new Universe(game);
    universe.prep = { sys: info, out: { system: { tier: 0 } } };
    game.loadSystem = vi.fn(() => {
      const nextStar = body();
      game.system = { info, tier: 2, star: nextStar, bodies: [nextStar, body()] };
      game.station = { ...body(), pads: [{}] };
      universe.reset(info);
    });
    universe.applyWorld({ tiers: [2] });
    expect(universe.prep).toBeNull();
    expect(game.disposeSystem).toHaveBeenCalledOnce();
    expect(game.loadSystem).toHaveBeenCalledWith(info, { seamless: true, reservedPad: -1 });
    expect(game.ship.state.frame).toBe(game.station);
    expect(game.player.state.frame).toBe(game.system.bodies[1]);
    expect(game.cam.frame).toBe(game.system.bodies[1]);
    expect(game.navTarget).toBe(game.system.bodies[1]);
    expect(game.ship.dockPad).toBe(game.station.pads[0]);
    expect(game.ship.state.pos.toArray()).toEqual([1, 2, 3]);
    expect(game.player.state.vel.toArray()).toEqual([4, 5, 6]);
    universe.applyWorld({ tiers: [2] });
    expect(game.loadSystem).toHaveBeenCalledOnce();
  });
});

it('keeps a buffered inertial pose at the same galactic place across draw-origin rebases', () => {
  const info = { seed: 17, x: 2, y: 3, z: 4 };
  const game = {
    net: { zone: { systemSeed: 17 } }, galaxy: { systems: [info] },
    system: { info, star: { position: new THREE.Vector3() } },
    ship: { state: state(null) }, cam: state(null),
  };
  const universe = new Universe(game);
  universe.anchor.set(info.x, info.y, info.z);
  const frame = universe.networkFrame();
  const remote = new THREE.Vector3(200, 0, 0);
  expect(frame.localToWorld(remote, new THREE.Vector3()).x).toBe(200);
  universe.rebase(new THREE.Vector3(100, 0, 0));
  expect(universe.networkFrame()).toBe(frame);
  // Ly origins are doubles; a 100 m rebase at this galactic coordinate loses less than 5 m.
  expect(Math.abs(frame.localToWorld(remote, new THREE.Vector3()).x - 100)).toBeLessThan(5);
  expect(game.ship.state.pos.x).toBe(-99);
});
