import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlanetParams } from '@astra/shared/world';
import { Ship } from './Ship.js';
import { Pirates } from './Pirates.js';
import { SCREENS } from '../../../tools/src/capture/screens.ts';

afterEach(() => vi.unstubAllGlobals());

function pageWithCombat() {
  const ship = new Ship(null);
  const game = {
    ship, mode: 'ship', time: 100, universe: { deep: true }, engine: { scene: new THREE.Scene() },
    system: { planets: [{ params: createPlanetParams(7, 'inferno', 1e5) }] },
    hud: { update: vi.fn() },
    frame(dt) { this.time += dt; pirates.update(dt); },
  };
  ship.game = game;
  const pirates = new Pirates(game);
  let steps = 0;
  vi.stubGlobal('window', { game, async step(n) { for (let i = 0; i < n; i++) { game.frame(1 / 60); steps++; } } });
  const page = { evaluate: async (fn, arg) => fn(arg), waitForTimeout: async () => {} };
  return { ship, game, page, steps: () => steps };
}

describe('the actual remote-ships pool capture callbacks', () => {
  for (const aspect of ['16x9', '21x9'])
    it(`preserves every advertised still value through real Pirate regeneration at ${aspect}`, async () => {
      const { ship, game, page, steps } = pageWithCombat();
      const cases = [
        ['full-125', 125, 125, false],
        ['half-125', 62.5, 62.5, false],
        ['cockpit-half-125', 62.5, 62.5, true],
        ['hazard-35-125', 0, 43.75, false],
        ['hazard-critical-125', 0, 43.625, false],
      ];
      for (const [name, shield, hull, cockpit] of cases) {
        await SCREENS['remote-ships-pools'].stills[name](page);
        expect(ship.stats).toMatchObject({ shieldMax: 125, hullMax: 125 });
        expect(ship.shield, `${name} shield at the screenshot boundary`).toBe(shield);
        expect(ship.hull, `${name} hull at the screenshot boundary`).toBe(hull);
        expect(ship.inCockpit).toBe(cockpit);
        // Even a zero-duration render frame must not let the legacy regen cap clamp full shields to 100.
        game.frame(0);
        expect(ship.shield).toBe(shield);
      }
      expect(steps()).toBe(600);
      expect(game.hud.update).toHaveBeenCalled();
      expect(ship.hazard).toBe(game.system.planets[0].params.hazard);
    });

  for (const parked of [false, true])
    it(`holds 80% values through ${parked ? 'captureClip parking' : 'normal settling'} and every recorded game frame`, async () => {
      const { ship, game, page } = pageWithCombat();
      // captureClip saves the real frame, parks game.frame, runs motion, then records through the saved frame.
      const frame = game.frame.bind(game);
      if (parked) game.frame = () => {};
      const def = SCREENS['remote-ships-pools'];
      await def.motion(page);
      expect(ship.shield).toBe(100);
      expect(ship.hull).toBe(100);
      expect(ship.stats).toMatchObject({ shieldMax: 125, hullMax: 125 });
      for (let i = 0; i < Math.round((def.clipSeconds ?? 1) * 60); i++) {
        frame(1 / 60);
        expect(ship.shield).toBe(100);
        expect(ship.hull).toBe(100);
      }
    });
});
