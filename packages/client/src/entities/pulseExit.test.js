// The pulse drive's drop-out (P1.E04.T03): movement authority judges the engines' first pose from the last pose it had on
// the drive, so an input in mode pulse, at the drive's pose and speed, has to go before the ship changes mode.
import * as THREE from 'three';
import { PULSE_DRIVE } from '@astra/shared/ships';
import { describe, expect, it } from 'vitest';
import { moveModeOf } from '../net/pose.js';
import { Ship } from './Ship.js';

describe('Ship.exitPulse', () => {
  it('sends an input in mode pulse, at the drive’s pose and speed, before the mode changes', () => {
    const inputs = [];
    const g = { mode: 'ship', time: 0, audio: { play() {} } };
    g.net = {
      sendInput() {
        inputs.push({ mode: moveModeOf(g.mode, g.ship.mode, g.ship.state.frame), pos: g.ship.state.pos.clone(), vel: g.ship.state.vel.clone() });
        return true;
      },
    };
    g.ship = new Ship(g);
    const ship = g.ship;
    ship.mode = 'pulse';
    ship.pulse.speed = 90000;
    ship.state.pos.set(0, 0, -2e6);
    ship.state.vel.set(0, 0, -90000);
    ship.exitPulse();
    expect(inputs).toHaveLength(1);
    expect(inputs[0].mode).toBe('pulse');
    expect(inputs[0].pos.toArray()).toEqual([0, 0, -2e6]);
    expect(inputs[0].vel.toArray()).toEqual([0, 0, -90000]);
    expect(ship.mode).toBe('flying');
    expect(ship.speed).toBe(Math.min(90000, PULSE_DRIVE.exitSpeedMax));
    expect(ship.state.vel.distanceTo(new THREE.Vector3(0, 0, -ship.speed))).toBeLessThan(1e-9);
  });
});
