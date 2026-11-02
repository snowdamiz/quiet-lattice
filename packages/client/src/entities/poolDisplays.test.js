import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ship } from './Ship.js';
import { Cockpit } from './Cockpit.js';
import { HUD } from '../ui/HUD.js';

const element = () => ({ style: {}, dataset: {}, innerHTML: '', classList: { toggle() {} } });

function display(ship) {
  const h = Object.create(HUD.prototype);
  for (const key of ['root', 'layer', 'banner', 'band', 'crosshair', 'reticle', 'rSpeed', 'rAlt', 'rMode', 'rThr', 'rChg', 'hzWarn', 'vitals', 'location', 'inventory', 'prompt', 'underwater']) h[key] = element();
  h.visible = true;
  h.now = () => 1000;
  h.arc = vi.fn();
  h.costAt = () => null;
  h.sheen = h.readAvoid = h.updateMarkers = h.updateHits = h.updateAbilities = h.updateEvents = h.updateSpeedLines = () => {};
  h.social = h.edgeCompass = { update() {} };
  h.game = {
    mode: 'ship', ship, player: {}, director: {}, universe: { deep: true }, inventory: { key: () => '', units: 0 },
  };
  const c = Object.create(Cockpit.prototype);
  Object.assign(c, { ship, interior: { visible: true }, stick: new THREE.Object3D(), throttle: new THREE.Object3D(), stickRest: new THREE.Quaternion(), throttleRest: new THREE.Vector3(), time: 0, timer: 0 });
  const rects = [];
  const instrument = () => ({
    c: { width: 256, height: 160 }, tex: {},
    g: { fillRect: (...args) => rects.push(args), fillText() {}, measureText: () => ({ width: 1 }), beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, fill() {} },
  });
  c.left = instrument(); c.center = instrument(); c.right = instrument();
  return {
    draw() {
      rects.length = 0;
      h.update(1 / 60);
      c.timer = 0;
      c.update(1 / 60, { system: { planets: [] }, station: { position: new THREE.Vector3() } });
      return { shield: h.arc.mock.calls.find(([, name]) => name === 'shield').slice(2), hull: h.vitals.innerHTML, cockpitShield: rects.filter((r) => r[0] === 14 && r[1] === 38).at(-1)[2] / 228 };
    },
    h,
  };
}

describe('ship pool displays use the real ship capacities', () => {
  for (const skills of [[], ['shield_capacitor', 'hull_plating']])
    it(`draws full, partial and empty pools for ${skills.length ? '125-point plated' : '100-point base'} pools`, () => {
      const ship = new Ship(null);
      ship.setSkills(skills);
      const d = display(ship);
      expect(d.draw()).toMatchObject({ shield: [1, false], hull: '', cockpitShield: 1 });
      ship.shield = ship.stats.shieldMax * 0.997;
      ship.hull = ship.stats.hullMax * 0.997;
      d.h.arc.mockClear();
      expect(d.draw()).toMatchObject({ shield: [0.997, false], hull: '', cockpitShield: 0.997 });
      for (const fraction of [0.9, 0.8, 0.5, 0]) {
        ship.shield = ship.stats.shieldMax * fraction;
        ship.hull = ship.stats.hullMax * fraction;
        d.h.arc.mockClear();
        const drawn = d.draw();
        expect(drawn.shield).toEqual([fraction, true]);
        expect(drawn.cockpitShield).toBeCloseTo(fraction, 9);
        expect(drawn.hull).toContain(`width:${(fraction * 100).toFixed(1)}%`);
      }
    });
});
