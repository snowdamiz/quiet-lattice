import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Galaxy, GALAXY_SEED } from '@astra/shared/world';
import { Game } from '../Game.js';
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
    expect(game.loadSystem).toHaveBeenCalledWith(info, { seamless: true });
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
