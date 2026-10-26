// Between the client's state and the wire (P1.E04.T01): frame ids both ways, modes, walker orientation, buttons.
import * as THREE from 'three';
import { Buttons } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { buttonsOf, frameIdOfFrame, frameOfId, headingOf, moveModeOf, walkerQuat } from './pose.js';

const planets = [{ name: 'a' }, { name: 'a-moon' }, { name: 'b' }];
const station = { kind: 'station' };
const system = { seed: 424242, planets };

describe('frames on the wire', () => {
  it('names each of the system frames by its frame id, and finds it again', () => {
    expect(frameIdOfFrame(system, station, null)).toBeNull();
    expect(frameIdOfFrame(system, station, station)).toBe('424242:station');
    expect(frameIdOfFrame(system, station, planets[2])).toBe('424242:2');
    expect(frameIdOfFrame(system, station, { name: 'elsewhere' })).toBeUndefined();
    for (const f of [null, station, ...planets]) expect(frameOfId(system, station, frameIdOfFrame(system, station, f))).toBe(f);
  });

  it('finds no frame for another system, a body it lacks, or a misspelt id', () => {
    for (const id of ['1:station', '424242:3', '424242:02', 'nonsense']) expect(frameOfId(system, station, id)).toBeUndefined();
  });
});

describe('movement modes', () => {
  it('maps what the client is doing onto the protocol mode', () => {
    expect(moveModeOf('foot', 'landed', station)).toBe('foot');
    expect(moveModeOf('ship', 'landed', station)).toBe('docked');
    expect(moveModeOf('ship', 'landed', planets[0])).toBe('landed');
    expect(moveModeOf('ship', 'pulse', null)).toBe('pulse');
    for (const m of ['flying', 'takeoff', 'landing', 'docking']) expect(moveModeOf('ship', m, station)).toBe('ship');
  });
});

describe('walker orientation', () => {
  it('turns a heading into a unit quaternion facing it, and back', () => {
    const up = new THREE.Vector3(0.3, 0.9, -0.2).normalize();
    const heading = new THREE.Vector3(1, 0, 0.4).addScaledVector(up, -new THREE.Vector3(1, 0, 0.4).dot(up)).normalize();
    const q = walkerQuat(up, heading);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).distanceTo(up)).toBeLessThan(1e-9);
    expect(headingOf(q, up).distanceTo(heading)).toBeLessThan(1e-9);
  });

  it('is the identity for a walker facing −z in a hangar', () => {
    const q = walkerQuat(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
    expect(q.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });
});

describe('buttons', () => {
  it('packs what is held into the mask', () => {
    expect(buttonsOf({})).toBe(0);
    expect(buttonsOf({ boost: true, fire: true, jet: false })).toBe(Buttons.boost | Buttons.fire);
  });
});
