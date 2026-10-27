// What the server's movement authority (P1.E03.T04) reads from shared: the walker's numbers and caps, the Waystation's
// hangar and pads, the air and the pulse drive's clearance. Until the client reads each of these from shared, its own
// literals are checked against them here, so the two cannot drift apart.
import { describe, expect, it } from 'vitest';
import { STATION_HANGAR, STATION_LAYOUT, WALKER, stationLayoutSchema, walkerSchema } from '../src/data/index.ts';
import {
  AIR,
  PULSE_CLEAR,
  PULSE_DRIVE,
  SHIP_GEAR_HEIGHT,
  WALKER_TOLERANCE,
  airDensity,
  pulseClearRadius,
  pulseClearance,
  terrainReach,
  walkerCaps,
  walkerFall,
  walkerStats,
} from '../src/ships/index.ts';
import { describeSystem, systemPoses, type PlanetParams } from '../src/world/index.ts';
// The client's sources as text (Vite's ?raw), for the literals they still carry.
import GAME from '../../client/src/Game.js?raw';
import PLAYER from '../../client/src/entities/Player.js?raw';
import SHIP from '../../client/src/entities/Ship.js?raw';
import PLANET from '../../client/src/universe/Planet.js?raw';
import STATION from '../../client/src/universe/Station.js?raw';

/** Asserts `source` contains `snippet` verbatim. */
const has = (source: string, snippet: string) => expect(source.includes(snippet), snippet).toBe(true);

describe('the walker', () => {
  it('is today’s Player.js', () => {
    expect(walkerSchema.safeParse(WALKER).success).toBe(true);
    has(PLAYER, `let speed = this.sprinting ? ${WALKER.sprintSpeed} : ${WALKER.walkSpeed};`);
    has(PLAYER, `if (this.swimming) speed = ${WALKER.swimSpeed};`);
    has(PLAYER, `newUp = ${WALKER.jumpSpeed};`);
    has(PLAYER, `const accel = this.grounded ? ${WALKER.accel.ground} : this.swimming ? ${WALKER.accel.swim} : ${WALKER.accel.air};`);
    has(PLAYER, `newUp += (g + ${WALKER.jet.thrust}) * dt;`);
    has(PLAYER, `newUp = Math.min(newUp, ${WALKER.jet.climbMax});`);
    has(PLAYER, `horiz.addScaledVector(this.heading, fwdIn * ${WALKER.jet.push} * dt);`);
    has(PLAYER, `(dt * ${1 / WALKER.jet.fuelS}) / (this.jetEfficiency || 1)`);
    has(PLAYER, `this.airTime > ${WALKER.jet.afterS}`);
    has(PLAYER, `if (this.grounded) this.jetFuel = Math.min(1, this.jetFuel + dt * ${WALKER.jet.regenPerS});`);
    has(PLAYER, `this.jetFuel = Math.min(1, this.jetFuel + dt * ${WALKER.jet.swimRegenPerS});`);
    has(PLAYER, `input.down('Space') ? ${WALKER.swim.riseSpeed} : -${WALKER.swim.sinkSpeed}`);
    has(PLAYER, `this.swimming = seaDepth > ${WALKER.swim.depthM};`);
    has(PLAYER, `if (f.kind === 'station') return ${WALKER.stationGravity.toFixed(1)};`);
    has(PLAYER, `return f.gravity || ${WALKER.defaultGravity};`);
    // getting out and in (Game.exitShip, Game.handleInteractions)
    has(GAME, `p.state.pos.distanceTo(ship.state.pos) < ${WALKER.boardRangeM}`);
    has(GAME, `addScaledVector(left, ${WALKER.exit.planet.leftM}).addScaledVector(fwd, ${WALKER.exit.planet.forwardM})`);
    has(GAME, `f.surfaceRadius(dir) + ${WALKER.exit.planet.aboveGroundM}`);
    has(GAME, `addScaledVector(left, ${WALKER.exit.station.leftM});`);
    has(GAME, `feet.y = ${WALKER.exit.station.feetY};`);
  });

  it('takes Sprint Stride, Long Jump, Efficient Jetpack and the Thalune’s swimming from the web and the people', () => {
    const plain = walkerStats();
    expect(plain).toMatchObject({ walk: 5.2, sprint: 9.5, swim: 3.2, jump: 5.5, jetClimb: 14, jetPush: 6, airAccel: 2.2 });
    expect(plain.jetFuelS).toBeCloseTo(1 / 0.42, 12);
    expect(walkerStats({ skills: ['sprint_stride'] }).sprint).toBe(11.5);
    expect(walkerStats({ skills: ['long_jump'] }).jump).toBe(7);
    expect(walkerStats({ skills: ['efficient_jetpack'] }).jetFuelS).toBeCloseTo(2 / 0.42, 12);
    expect(walkerStats({ people: 'thalune' }).swim).toBe(9.5);
    expect(walkerStats({ people: 'thalune', skills: ['sprint_stride'] }).swim).toBe(11.5);
    expect(walkerStats({ people: 'ixari' }).swim).toBe(3.2);
    expect(walkerStats({ skills: ['grav_boots'] }).flags).toContain('walk_station_exterior');
    // ship passives and actives leave the walker alone
    expect(walkerStats({ skills: ['photon_thrusters', 'afterburner'] })).toEqual(plain);
    expect(() => walkerStats({ skills: ['sprint_strid'] })).toThrow(/Unknown skill node/);
    expect(Object.isFrozen(plain)).toBe(true);
  });

  it('caps: across the ground at the sprint (or the jetpack’s push in the air), up at the jetpack’s climb, both with the tolerance', () => {
    const T = WALKER_TOLERANCE;
    const plain = walkerCaps(walkerStats());
    // walking with the jetpack's push on top: 5.2 + 6 / 2.2 = 7.93, under the sprint
    expect(plain.across).toBeCloseTo(9.5 * T.factor + T.slackMps, 12);
    expect(plain.climb).toBeCloseTo(14 * T.factor + T.slackMps, 12);
    expect(walkerCaps(walkerStats({ skills: ['sprint_stride'] })).across).toBeCloseTo(11.5 * T.factor + T.slackMps, 12);
  });

  it('falls no faster than gravity takes it from the top of its jump', () => {
    // from rest, a second at 9 m/s²: 4.5 m, with the tolerance
    expect(walkerFall(9, 0, 1)).toBeCloseTo(4.5 * WALKER_TOLERANCE.factor + WALKER_TOLERANCE.slackMps, 12);
    // already 20 m down: moving at 20 m/s
    expect(walkerFall(10, 20, 1)).toBeCloseTo((20 + 5) * WALKER_TOLERANCE.factor + WALKER_TOLERANCE.slackMps, 12);
    expect(walkerFall(10, -5, 1)).toBe(walkerFall(10, 0, 1));
  });
});

describe('the Waystation’s hangar', () => {
  it('is the client’s: the box it builds, its pads where it lays them', () => {
    expect(stationLayoutSchema.safeParse(STATION_LAYOUT).success).toBe(true);
    expect(STATION_HANGAR).toEqual({ x0: -65, x1: 65, y0: 0, y1: 42, z0: -90, z1: 60 });
    has(STATION, 'export const HANGAR = STATION_HANGAR;');
    has(STATION, 'const padPositions = STATION_LAYOUT.pads.map((pad) => [pad.x, pad.z]);');
    has(STATION, 'const top = STATION_LAYOUT.padTop;');
    // the shell the server holds ships out of is no thicker than the client's thinnest: the 4 m floor
    has(STATION, `box(H.x0, -${STATION_LAYOUT.shellM}, H.z0, H.x1, 0, H.z1, floor);`);
    expect(Object.isFrozen(STATION_LAYOUT.pads[0])).toBe(true);
  });
});

describe('a ship’s surroundings', () => {
  const d = describeSystem(424242);
  const poses = systemPoses(d, 1000);

  it('carry the client’s literals: gear, air, the pulse drive’s clearances', () => {
    has(SHIP, `export const GEAR_HEIGHT = ${SHIP_GEAR_HEIGHT};`);
    has(SHIP, `smoothstep(this.atmoDensity, ${AIR.flightModelFrom}, 0.05)`);
    has(SHIP, `this.atmoDensity > ${AIR.pulseCeiling} || (this.altitude < ${PULSE_DRIVE.engageAltitudeM} && this.state.frame?.sampler)`);
    has(SHIP, `if (this.pulseLimit().dist < ${PULSE_DRIVE.engageClearM})`);
    has(SHIP, `this.atmoDensity > ${AIR.pulseCeiling} || dist < ${PULSE_DRIVE.dropOutM};`);
    has(SHIP, `this.seaAltitude < f.radius * ${AIR.gasDeck} ? 1 : 0`);
    has(
      SHIP,
      `b.kind === 'star' ? b.radius * ${PULSE_CLEAR.starRadii} : b.atmo ? b.radius * b.atmo.top : b.radius + (b.maxTerrain || 0) + ${PULSE_CLEAR.terrainM}`,
    );
    has(SHIP, `b.radius + b.params.hazard.ceiling * ${PULSE_CLEAR.hazardFactor}`);
    has(SHIP, `to.length() - ${PULSE_CLEAR.stationM}`);
    has(PLANET, 'this.maxTerrain = p.mountainHeight + p.landHeight * 2.5 + p.hillHeight + 50;');
    has(PLANET, `falloff: this.isGas ? 1.6 : ${AIR.falloff.toFixed(1)},`);
  });

  it('the air thins with height as the client’s flight model reads it, and a gas giant’s deck is all air', () => {
    const rocky = d.bodies.find((b) => b.type !== 'gas' && b.params.atmosphere)!;
    const H = rocky.params.atmosphere!.height;
    expect(airDensity(rocky, -50)).toBe(1);
    expect(airDensity(rocky, 0)).toBe(1);
    expect(airDensity(rocky, H / 2)).toBeCloseTo(Math.exp(-2) * 0.5, 9);
    expect(airDensity(rocky, H)).toBeCloseTo(0, 12);
    expect(airDensity(rocky, H * 1.01)).toBe(0);
    expect(airDensity({ ...rocky, params: { ...rocky.params, atmosphere: null } }, 0)).toBe(0);
    const gas = { radius: 200_000, type: 'gas' as const, params: { atmosphere: { height: 10_000 } } };
    expect(airDensity(gas, 9_999)).toBe(1);
    expect(airDensity(gas, 10_001)).toBe(0);
  });

  it('clears the top of a world’s air, else its terrain and 2.5 km, and any hazard layer by 1.3 of its ceiling', () => {
    for (const b of d.bodies) {
      const a = b.params.atmosphere;
      let clear = a ? b.radius + a.height : b.radius + terrainReach(b.params) + 2500;
      if (b.params.hazard) clear = Math.max(clear, b.radius + b.params.hazard.ceiling * 1.3);
      expect(pulseClearRadius(b)).toBeCloseTo(clear, 6);
    }
    const rocky = d.bodies.find((b) => b.type !== 'gas')!;
    const p = rocky.params as PlanetParams;
    expect(terrainReach(p)).toBe(p.mountainHeight + p.landHeight * 2.5 + p.hillHeight + 50);
  });

  it('measures to the nearest clear sphere, and to the Waystation only when heading for it', () => {
    const st = poses.station.position;
    const above: [number, number, number] = [st[0], st[1] + 4000, st[2]];
    const toward = pulseClearance(d, poses, above, [0, -1, 0]);
    const away = pulseClearance(d, poses, above, [0, 1, 0]);
    expect(toward.min).toBeCloseTo(1000, 6);
    expect(toward.ahead).toBeCloseTo(1000, 6);
    expect(away.min).toBeCloseTo(1000, 6);
    expect(away.ahead).toBeGreaterThan(1000);
    // its home world's air lies below: the Waystation orbits above it
    const home = d.bodies[d.home]!;
    const hp = poses.bodies[d.home]!.position;
    expect(away.ahead).toBeCloseTo(Math.hypot(above[0] - hp[0], above[1] - hp[1], above[2] - hp[2]) - pulseClearRadius(home), 6);
    // at the star's clear sphere
    const star: [number, number, number] = [0, d.star.radius * 3 + 50, 0];
    expect(pulseClearance(d, poses, star).min).toBeCloseTo(50, 6);
  });
});
