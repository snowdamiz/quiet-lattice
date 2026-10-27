// A shot of the ship's guns as the server is asked for it (P1.E06.T02): the nose's direction in the frame of the ship's pose,
// at the game's world time, and none while the game has no input to send.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fireIntent } from './combat.js';

const planets = [{ name: 'a' }, { name: 'b' }];
const station = { kind: 'station' };
const game = (over = {}) => ({ net: { zone: { systemSeed: 9 } }, universe: { deep: false }, system: { seed: 9, planets }, station, time: 1234.5, ...over });

describe('fireIntent', () => {
  it("aims along the ship's nose in its frame, at the game's time", () => {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const shot = fireIntent(game(), { frame: planets[1], quat });
    expect(shot.frame).toBe('9:1');
    expect(shot.time).toBe(1234.5);
    expect(shot.aim[0]).toBeCloseTo(-1, 9);
    expect(shot.aim[1]).toBeCloseTo(0, 9);
    expect(shot.aim[2]).toBeCloseTo(0, 9);
    expect(fireIntent(game(), { frame: station, quat: new THREE.Quaternion() })).toEqual({ time: 1234.5, frame: '9:station', aim: [0, 0, -1] });
    expect(fireIntent(game(), { frame: null, quat: new THREE.Quaternion() }).frame).toBeNull();
  });

  it('is none offline, out of the zone’s system, between the stars, or in a frame not of its system', () => {
    const state = { frame: planets[0], quat: new THREE.Quaternion() };
    expect(fireIntent(game({ net: null }), state)).toBeNull();
    expect(fireIntent(game({ system: { seed: 8, planets } }), state)).toBeNull();
    expect(fireIntent(game({ universe: { deep: true } }), state)).toBeNull();
    expect(fireIntent(game(), { frame: { name: 'elsewhere' }, quat: new THREE.Quaternion() })).toBeNull();
  });
});
