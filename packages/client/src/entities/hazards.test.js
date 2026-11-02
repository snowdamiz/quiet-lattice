import { describe, expect, it, vi } from 'vitest';
import { Ship } from './Ship.js';

function rig() {
  const listeners = new Map();
  const net = {
    entityId: 7,
    store: { entities: new Map() },
    on: (type, fn) => {
      listeners.set(type, fn);
      return () => listeners.delete(type);
    },
  };
  const game = { mode: 'ship', time: 100, net, shipDestroyed: vi.fn(), lightning: vi.fn(), audio: { play: vi.fn() } };
  const ship = new Ship(game);
  ship.state.pos.set(0, 10000, 0);
  ship.state.frame = { params: { hazard: { kind: 'heat', ceiling: 1000, dps: 12, curve: 1 } } };
  ship.altitude = 0;
  return { game, ship, listeners };
}

describe('the ship only predicts hazard health', () => {
  it('predicts shield-first hull loss without triggering the online rebuild, tax or teleport at zero', () => {
    const { game, ship } = rig();
    ship.updateHazard(10);
    expect(ship.shield).toBe(0);
    expect(ship.hull).toBe(80);
    ship.updateHazard(10);
    expect(ship.hull).toBe(0);
    expect(game.shipDestroyed).not.toHaveBeenCalled();
    expect(ship.state.pos.toArray()).toEqual([0, 10000, 0]);
  });

  it('takes authoritative shield and hull fractions from each aboard snapshot and ignores suit hp', () => {
    const { ship, game, listeners } = rig();
    ship.setSkills(['shield_capacitor', 'hull_plating']);
    ship.watchServer();
    game.net.store.entities.set(7, { mode: 'ship', hp: 0.6, shield: 0.2 });
    listeners.get('snapshot')();
    expect(ship.hull).toBe(75);
    expect(ship.shield).toBe(25);
    game.net.store.entities.set(7, { mode: 'foot', hp: 0.1 });
    listeners.get('snapshot')();
    expect(ship.hull).toBe(75);
    expect(ship.shield).toBe(25);
    ship.reconcileHealth({ mode: 'ship', hp: 0, shield: 0 });
    expect(ship.hull).toBe(0);
    expect(game.shipDestroyed).not.toHaveBeenCalled();
  });

  it('predicts re-entry damage with Ablative Plating on a world without a hostile sky', () => {
    const { ship } = rig();
    ship.state.frame = { sampler: {}, params: {} };
    ship.state.vel.set(0, -1100, 0);
    ship.atmoDensity = 1;
    ship.setSkills(['ablative_plating']);
    ship.updateHazard(3);
    expect(ship.shield).toBeCloseTo(80, 10);
    ship.state.vel.set(0, 1100, 0);
    ship.updateHazard(3);
    expect(ship.shield).toBeCloseTo(80, 10);
  });

  it('keeps storm wind, lightning, thunder and extra strike prediction', () => {
    const { game, ship } = rig();
    ship.state.frame.params.hazard.kind = 'storm';
    ship.nextStrike = 0;
    ship.updateHazard(0.05);
    expect(game.lightning).toHaveBeenCalledWith(1, true);
    expect(game.audio.play).toHaveBeenCalledWith('thunder', { dist: 300 });
    expect(ship.state.vel.length()).toBeGreaterThan(0);
    expect(ship.shield).toBeLessThan(94.4);
  });
});
