// A star system's star, planets and moons, built from its description (describeSystem in @astra/shared/world, which
// the server derives the same bodies and frames from). `planets` holds the planets and moons in the description's
// order, so planets[i] is the body with frame id frameId(seed, i).
import * as THREE from 'three';
import { describeSystem, STAR_CLASSES } from '@astra/shared/world';
import { Star } from './Star.js';
import { Planet } from './Planet.js';

export class SolarSystem {
  constructor(seed, pool, { name, homeType, cls, staged } = {}) {
    const d = describeSystem(seed, { name, homeType, cls });
    this.description = d;
    this.seed = seed;
    this.pool = pool;
    this.name = d.name;
    this.starClass = STAR_CLASSES.find((c) => c.cls === d.star.cls);
    this.star = new Star({ name: d.star.name, radius: d.star.radius, color: d.star.color });
    this.bodies = [this.star];
    this.planets = [];
    this.outerOrbit = d.outerOrbit;
    this.belt = d.belt;
    // the planets come a body at a time; staged, one per step(), so a system can be readied
    // over frames while the ship approaches it
    this.steps = this.buildBodies();
    if (!staged) while (!this.step());
  }

  step() {
    if (this.steps && this.steps.next().done) this.steps = null;
    return !this.steps;
  }

  *buildBodies() {
    const d = this.description;
    for (const b of d.bodies) {
      const body = new Planet(
        {
          name: b.name,
          kind: b.kind,
          parent: b.parent === null ? this.star : this.planets[b.parent],
          radius: b.radius,
          // (a copy: the planet adds its levelled pads to its params, and the description stays as generated)
          params: { ...b.params },
          rings: b.rings,
          orbitRadius: b.orbitRadius,
          orbitPeriod: b.orbitPeriod,
          orbitPhase: b.orbitPhase,
          orbitTilt: new THREE.Quaternion().fromArray(b.orbitTilt),
          rotationPeriod: b.rotationPeriod,
          rotationPhase: b.rotationPhase,
          axialTilt: new THREE.Quaternion().fromArray(b.axialTilt),
          gravity: b.gravity,
          soi: b.soi,
        },
        this.pool,
      );
      // (a planet's place out from the star, a moon's among its planet's moons)
      body.index = b.slot;
      this.planets.push(body);
      this.bodies.push(body);
      if (b.index === d.home) this.homePlanet = body;
      yield;
    }
  }

  update(t) {
    for (const b of this.bodies) b.update(t);
  }

  // Innermost frame containing world position (stations > moons > planets).
  frameFor(world, extra = []) {
    for (const e of extra) if (e.distanceTo(world) < e.soi) return e;
    let best = null;
    for (const p of this.planets) {
      if (p.distanceTo(world) < p.soi && (!best || p.soi < best.soi)) best = p;
    }
    return best;
  }

  nearestPlanet(world) {
    let best = null;
    let bd = Infinity;
    for (const p of this.planets) {
      const d = p.distanceTo(world) - p.radius;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return { planet: best, altitude: bd };
  }

  dispose() {
    for (const p of this.planets) {
      if (p.terrain) p.terrain.dispose();
      this.pool.forgetPlanet(p.id);
    }
  }
}
