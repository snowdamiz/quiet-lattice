// The remote layer (P1.E04.T02) on frames that move as a real system's do: what it follows and shows, an entity kept on
// its moon as the moon is drawn now (not as it stood when the snapshot was taken), a ship crossing out of the
// Waystation's sphere into its world's frame without a pop, a late snapshot after an extrapolation blended in, entities
// leaving, and Net's snapshots followed.
import * as THREE from 'three';
import { GALAXY_SEED, Galaxy, describeGalaxySystem, homeSystems, setFrameInto, systemPoses } from '@astra/shared/world';
import { describe, expect, it, vi } from 'vitest';
import { Body } from '../universe/Body.js';
import { framePoseAt } from './frames.js';
import { BLEND_S, RemoteEntities, SNAP_M, snapLimit } from './RemoteEntities.js';

const SEED = 7;
const Q = [0, 0, 0, 1];
const DT = 1 / 60;

/** A system as the client holds it (a planet spinning on its orbit, its moon and its Waystation, at a real system's
 * speeds: the Waystation ~440 m/s round its world, the moon ~2 km/s round it), and a game with the parts the layer reads. */
function world() {
  const star = new Body({ name: 'star', kind: 'star' });
  const planet = new Body({ name: 'planet', parent: star, orbitRadius: 6e6, orbitPeriod: 15548, rotationPeriod: 3080, radius: 1e5, soi: 1.2e6 });
  const moon = new Body({ name: 'moon', kind: 'moon', parent: planet, orbitRadius: 7e5, orbitPeriod: 2168, rotationPeriod: 2200, radius: 26000, soi: 130000 });
  const station = new Body({ name: 'station', kind: 'station', parent: planet, orbitRadius: 155000, orbitPeriod: 2400, soi: 4500 });
  const game = {
    time: 0,
    system: { seed: SEED, planets: [planet, moon] },
    station,
    camWorld: new THREE.Vector3(),
    place(t) {
      this.time = t;
      for (const b of [star, planet, moon, station]) {
        framePoseAt(b, t, b);
        b.quaternionInv.copy(b.quaternion).invert();
      }
    },
  };
  return { game, planet, moon, station };
}

const view = () => ({ group: new THREE.Group(), draws: (hull) => hull === 'lark', update: vi.fn() });
const frameId = (key) => `${SEED}:${key}`;

/**
 * Plays a zone into the layer: a full snapshot every 50 ms from `from` with the entities `at(t)` gives, each arriving
 * `trip(t)` later (null: not sent), while frames run at 60 Hz with the bodies placed at each frame's time. As in the
 * browser, snapshots arrive between frames: the bodies still where the last frame put them. `watch(now)` runs after each
 * frame.
 */
function play(remotes, game, at, { from, to, trip = () => 0.03, watch = () => {} }) {
  const due = [];
  let tick = 0;
  for (let t = from; t <= to + 1e-9; t += 0.05) {
    const delay = trip(t);
    if (delay !== null) due.push({ arrival: t + delay, snap: { tick: ++tick, time: t, ack: 0, full: true, entities: at(t), removed: [] } });
    else tick++;
  }
  due.sort((a, b) => a.arrival - b.arrival);
  let i = 0;
  for (let now = from; now <= to + 1e-9; now += DT) {
    while (i < due.length && due[i].arrival <= now) remotes.feed(due[i].snap, due[i++].arrival);
    game.place(now);
    remotes.update(DT);
    watch(now);
  }
}

describe('RemoteEntities: what it follows and shows', () => {
  it('follows players and ships (not the player itself, creatures, walkers, props or loot) and shows those it can draw', () => {
    const { game } = world();
    game.place(100);
    const v = view();
    const remotes = new RemoteEntities(game, { view: v });
    const at = (id, kind, extra = {}) => ({ id, kind, frame: frameId('station'), pos: [id * 10, 0, 0], quat: Q, vel: [0, 0, 0], ...extra });
    const entities = new Map(
      [
        at(1, 'player', { mode: 'ship', name: 'Tess Arlo' }),
        at(2, 'player', { mode: 'foot' }),
        at(3, 'ship', { hull: 'mule', name: 'Waystation tug' }),
        at(4, 'mob', { species: 0, mode: 'idle' }),
        at(5, 'npc'),
        at(6, 'ship'),
        at(7, 'player', { mode: 'docked' }),
        at(8, 'loot'),
      ].map((e) => [e.id, e]),
    );
    remotes.ingest(entities, 100, 100.03, 7);
    game.place(100.2);
    remotes.update(DT);
    expect(remotes.get(1)).toMatchObject({ shown: true, name: 'Tess Arlo', hull: 'lark' });
    // on foot: no body until the rig (P1.E05.T04), and no stand-in
    expect(remotes.get(2).shown).toBe(false);
    // a hull with no model of its own or of its tier is not drawn
    expect(remotes.get(3)).toMatchObject({ shown: false, hull: 'mule' });
    // a ship that names no hull is a Lark
    expect(remotes.get(6)).toMatchObject({ shown: true, hull: 'lark' });
    for (const id of [4, 5, 7, 8]) expect(remotes.get(id)).toBeUndefined();
    expect(v.update).toHaveBeenLastCalledWith(remotes.list, DT);
    // it stands where the snapshot put it, in the Waystation's frame as the Waystation is now
    expect(remotes.get(1).frame).toBe(game.station);
    expect(remotes.get(1).world.distanceTo(game.station.localToWorld(new THREE.Vector3(10, 0, 0), new THREE.Vector3()))).toBeLessThan(1e-6);
  });

  it('marks the other pilots’ ships a ship’s sensors pick up: within their range × the ship’s signature, by name', () => {
    const { game } = world();
    game.place(100);
    const remotes = new RemoteEntities(game, { view: view() });
    const pilot = (id, x, extra = {}) => ({ id, kind: 'player', mode: 'ship', name: `Pilot ${id}`, frame: frameId('station'), pos: [x, 0, 0], quat: Q, vel: [0, 0, 0], ...extra });
    // a Lark's signature is 1: a 4 km sensor picks one up at 4 km, twice that on the pulse drive; not one on foot, nor an
    // NPC ship (its own task marks it)
    const entities = [
      pilot(1, 3000),
      pilot(2, 5000),
      pilot(3, 7000, { mode: 'pulse', vel: [20000, 0, 0] }),
      pilot(4, 100, { mode: 'foot' }),
      { id: 5, kind: 'ship', name: 'Tug', frame: frameId('station'), pos: [50, 0, 0], quat: Q, vel: [0, 0, 0] },
    ];
    remotes.ingest(new Map(entities.map((e) => [e.id, e])), 100, 100, null);
    remotes.update(DT);
    const here = game.station.localToWorld(new THREE.Vector3(), new THREE.Vector3());
    const marked = [];
    remotes.markers(here, 4000, (name, w) => marked.push([name, Math.round(w.distanceTo(here) / 100) * 100]));
    expect(marked.sort()).toEqual([
      ['Pilot 1', 3000],
      ['Pilot 3', 7000],
    ]);
  });

  it('shows nothing in a frame of another system (the player is not in the zone’s system)', () => {
    const { game } = world();
    game.place(100);
    const remotes = new RemoteEntities(game, { view: view() });
    remotes.ingest(new Map([[1, { id: 1, kind: 'player', mode: 'ship', frame: '99:station', pos: [0, 0, 0], quat: Q, vel: [0, 0, 0] }]]), 100, 100, null);
    remotes.update(DT);
    expect(remotes.get(1).shown).toBe(false);
  });

  it('lets entities go as they leave, those in another system’s frames too, keeping none it no longer hears of', () => {
    const { game } = world();
    const remotes = new RemoteEntities(game, { view: view() });
    // 200 entities come and go, each in the snapshots for half a second, every other one in a frame of a system this
    // client does not have (it is not drawn, and has no samples)
    const at = (t) => {
      const out = [];
      for (let id = 1; id <= 200; id++) {
        const from = 100 + id * 0.05;
        if (t >= from - 1e-9 && t < from + 0.5 - 1e-9)
          out.push({ id, kind: 'player', mode: 'ship', frame: id % 2 ? frameId('station') : '99:station', pos: [id, 0, 0], quat: Q, vel: [0, 0, 0] });
      }
      return out;
    };
    let most = 0;
    let unplaced = 0;
    play(remotes, game, at, {
      from: 100,
      to: 112,
      watch: () => {
        most = Math.max(most, remotes.list.length);
        for (const r of remotes.list) if (r.id % 2 === 0 && (r.shown || r.buf.length)) unplaced++;
      },
    });
    // (at most the ten in the snapshots at once, and those whose leaving is not yet due)
    expect(most).toBeLessThan(16);
    expect(remotes.list).toEqual([]);
    expect(remotes.byId.size).toBe(0);
    expect(unplaced).toBe(0);
  });

  it('forgets every frame it held when the system changes (a warp)', () => {
    const { game } = world();
    game.place(100);
    const remotes = new RemoteEntities(game, { view: view() });
    remotes.ingest(new Map([[1, { id: 1, kind: 'player', mode: 'ship', frame: frameId('station'), pos: [0, 0, 0], quat: Q, vel: [0, 0, 0] }]]), 100, 100, null);
    remotes.update(DT);
    expect(remotes.get(1).shown).toBe(true);
    game.system = { seed: 8, planets: [] };
    remotes.update(DT);
    expect(remotes.get(1).shown).toBe(false);
    expect(remotes.get(1).buf.length).toBe(0);
  });

  it('lets an entity go once the render time passes the snapshot it left', () => {
    const { game } = world();
    const remotes = new RemoteEntities(game, { view: view() });
    const ship = { id: 1, kind: 'player', mode: 'ship', frame: frameId('station'), pos: [0, 0, 0], quat: Q, vel: [0, 0, 0] };
    let left = null;
    let seen = false;
    play(remotes, game, (t) => (t < 101 - 1e-9 ? [ship] : []), {
      from: 100,
      to: 101.5,
      watch: (now) => {
        if (remotes.get(1)) seen = true;
        else if (seen && left === null) left = now;
      },
    });
    // gone from the snapshot taken at 101 s, which is drawn 130 ms after it arrives
    expect(left).toBeGreaterThan(101.1);
    expect(left).toBeLessThan(101.2);
  });
});

/**
 * A ship crossing out of the Waystation's sphere into its world's frame, played into a fresh layer: its own client flies
 * it straight out at 120 m/s and re-expresses it in the planet's frame 5% past the sphere (setFrame: its velocity turned,
 * never boosted), with its clock `skew` seconds behind the server's that labels its poses. Returns where it was drawn,
 * and where it would have been drawn with nothing blended, in the planet's frame as it was then, frame by frame.
 */
function crossing(skew = 0) {
  const { game, planet, station } = world();
  const remotes = new RemoteEntities(game, { view: view() });
  const s = { frame: station, pos: new THREE.Vector3(0, 0, 4400), quat: new THREE.Quaternion(), vel: new THREE.Vector3(0, 0, 120) };
  const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() };
  const pose2 = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() };
  let crossed = null;
  const at = (t) => {
    if (t > 300) s.pos.addScaledVector(s.vel, 0.05);
    if (s.frame === station && s.pos.length() > 4500 * 1.05) {
      setFrameInto(s, framePoseAt(station, t - skew, pose), framePoseAt(planet, t - skew, pose2));
      s.frame = planet;
      crossed = t;
    }
    return [{ id: 1, kind: 'player', mode: 'ship', frame: frameId(s.frame === station ? 'station' : 0), pos: s.pos.toArray(), quat: s.quat.toArray(), vel: s.vel.toArray() }];
  };
  const drawn = [];
  const raw = [];
  const frames = [];
  play(remotes, game, at, {
    from: 300,
    to: 306,
    watch: (now) => {
      const r = remotes.get(1);
      if (!r?.shown) return;
      drawn.push(planet.worldToLocal(r.world, new THREE.Vector3()));
      const w = r.frame.localToWorld(r.pose.pos, new THREE.Vector3());
      raw.push(planet.worldToLocal(w, new THREE.Vector3()));
      frames.push([now, r.frame]);
    },
  });
  return { drawn, raw, frames, crossed, planet, station };
}

const steps = (list) => list.slice(1).map((p, k) => p.distanceTo(list[k]));
const bends = (list) => list.slice(2).map((p, k) => p.clone().sub(list[k + 1]).sub(list[k + 1]).add(list[k]).length());

describe('RemoteEntities: frames of reference', () => {
  it('keeps an entity on its moon as the moon is drawn now, though its snapshots are a tenth of a second old', () => {
    const { game, moon } = world();
    const remotes = new RemoteEntities(game, { view: view() });
    // landed on the moon's surface, which moves at some 2 km/s round the planet and turns under it
    const local = new THREE.Vector3(0, 26000 + 2, 0);
    const landed = { id: 1, kind: 'player', mode: 'landed', frame: frameId(1), pos: local.toArray(), quat: Q, vel: [0, 0, 0] };
    let worst = 0;
    let drift = 0;
    play(remotes, game, () => [landed], {
      from: 200,
      to: 202,
      watch: () => {
        const r = remotes.get(1);
        if (!r?.shown) return;
        const there = moon.localToWorld(local, new THREE.Vector3());
        worst = Math.max(worst, r.world.distanceTo(there));
        // (where the moon put it when the snapshot drawn now was taken)
        const then = framePoseAt(moon, remotes.renderTime, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() });
        drift = Math.max(drift, local.clone().applyQuaternion(then.quaternion).add(then.position).distanceTo(there));
      },
    });
    expect(drift).toBeGreaterThan(200);
    expect(worst).toBeLessThan(1e-3);
  });

  it('blends a ship crossing out of the Waystation’s sphere into its world’s frame instead of jumping', () => {
    const { drawn, raw, frames, crossed, planet, station } = crossing();
    expect(crossed).not.toBeNull();
    expect(frames.at(-1)[1]).toBe(planet);
    expect(frames.some(([, f]) => f === station)).toBe(true);
    // Carried round with the Waystation (which the planet's turning frame sees go by at ~720 m/s), the ship moves 14 m a
    // frame in the planet's frame. At the change the two frames have moved apart over the render delay: drawn as the
    // snapshots have it, the ship would jump 90 m back. Blended, it never moves faster than it was moving (the jump
    // aside), its path bends by under a metre there, and elsewhere only as its motion does (where it stops riding with the
    // Waystation).
    const moving = steps(raw).sort((a, b) => b - a)[1];
    expect(moving).toBeGreaterThan(10);
    expect(Math.max(...steps(raw))).toBeGreaterThan(moving + 40);
    expect(Math.max(...steps(drawn))).toBeLessThan(moving + 0.5);
    const change = frames.findIndex(([, f]) => f === planet);
    const d = bends(drawn);
    const r = bends(raw);
    expect(Math.min(r[change - 2], r[change - 1])).toBeGreaterThan(80);
    expect(Math.max(d[change - 2], d[change - 1])).toBeLessThan(1);
    for (let j = 0; j < d.length; j++) if (j !== change - 2 && j !== change - 1) expect(d[j]).toBeLessThan(r[j] + 0.5);
    // and once blended out (a few BLEND_S) it is where the snapshots put it
    expect(BLEND_S).toBeLessThan(0.5);
    expect(drawn.at(-1).distanceTo(raw.at(-1))).toBeLessThan(0.01);
  });

  it('meets a crossing client whose clock a hitch left behind the server’s with a slide, not a jump', () => {
    // its clock 0.35 s behind: it places itself in the planet's frame as the frames stood 0.35 s before the tick that
    // carries the pose, which puts the pose ~400 m from where the Waystation's frame had it
    const { drawn, raw, frames, planet } = crossing(0.35);
    expect(frames.at(-1)[1]).toBe(planet);
    const moving = steps(raw).sort((a, b) => b - a)[1];
    // drawn as the snapshots have it, the ship would leap some 400 m; blended it slides, a few metres a frame faster than
    // it moves at most, its path bending no more than its motion's own does (the leap's two bends aside: where it stops
    // riding with the Waystation) and a metre or two
    expect(Math.max(...steps(raw))).toBeGreaterThan(300);
    expect(Math.max(...steps(drawn))).toBeLessThan(moving + 15);
    const kink = bends(raw).sort((a, b) => b - a)[2];
    expect(Math.max(...bends(drawn))).toBeLessThan(kink + 2);
    expect(drawn.at(-1).distanceTo(raw.at(-1))).toBeLessThan(0.05);
  });
});

/** The home systems' planets and moons, with how fast each one's frame and the frame outside its sphere (the system's for
 * a planet, its planet's for a moon) move apart at the edge of its sphere (5% out, where the zone changes frames), at
 * most: its orbital speed and its turning there, and for a moon its planet's turning too. */
function homeSpheres() {
  const galaxy = new Galaxy(GALAXY_SEED);
  const out = [];
  for (const h of homeSystems(GALAXY_SEED)) {
    const d = describeGalaxySystem(galaxy.systems[h.systemIndex]);
    const poses = systemPoses(d, 1.2e7);
    d.bodies.forEach((b, i) => {
      const edge = b.soi * 1.05;
      const p = poses.bodies[i];
      const parent = b.parent === null ? null : poses.bodies[b.parent];
      const v = new THREE.Vector3(...p.velocity).sub(parent ? new THREE.Vector3(...parent.velocity) : new THREE.Vector3());
      const spin = new THREE.Vector3(...p.angularVelocity).length() * edge;
      // (a moon's sphere edge is at most its orbit plus its sphere from its planet's centre)
      const parentSpin = parent ? new THREE.Vector3(...parent.angularVelocity).length() * (b.orbitRadius + edge) : 0;
      out.push({ system: h.systemIndex, index: i, spec: b, apart: v.length() + spin + parentSpin });
    });
  }
  return out;
}

describe('RemoteEntities: the edge of a planet’s sphere', () => {
  it('blends a ship leaving the home systems’ fastest-moving sphere for the system’s frame, its client’s clock lagging', () => {
    const spheres = homeSpheres();
    const worst = spheres.filter((s) => s.spec.parent === null).sort((a, b) => b.apart - a.apart)[0];
    // a planet's frame and the system's part at up to ~5 km/s at its sphere's edge (its orbit and its spin); over the
    // render delay, the trip and the up to a second a hitch leaves a client's clock behind, that is well past SNAP_M: the
    // blend reaches that far
    expect(worst.apart).toBeGreaterThan(3000);
    expect(Math.max(...spheres.map((s) => s.apart))).toBeLessThan(8000);
    expect(worst.apart * (0.15 + 0.8)).toBeGreaterThan(SNAP_M);
    for (const s of spheres) expect(snapLimit(0, s.apart)).toBeGreaterThan(s.apart * (0.15 + 1));

    // that planet as the client holds it, and a ship flying out of its sphere along its equator at 300 m/s
    const b = worst.spec;
    const star = new Body({ name: 'star', kind: 'star' });
    const planet = new Body({
      name: 'planet',
      parent: star,
      radius: b.radius,
      soi: b.soi,
      orbitRadius: b.orbitRadius,
      orbitPeriod: b.orbitPeriod,
      orbitPhase: b.orbitPhase,
      orbitTilt: new THREE.Quaternion().fromArray(b.orbitTilt),
      rotationPeriod: b.rotationPeriod,
      rotationPhase: b.rotationPhase,
      axialTilt: new THREE.Quaternion().fromArray(b.axialTilt),
    });
    const station = new Body({ name: 'station', kind: 'station', parent: planet, orbitRadius: b.radius * 1.5, orbitPeriod: 2400, soi: 4500 });
    const game = {
      time: 0,
      system: { seed: SEED, planets: [planet] },
      station,
      camWorld: new THREE.Vector3(),
      place(t) {
        this.time = t;
        for (const x of [star, planet, station]) {
          framePoseAt(x, t, x);
          x.quaternionInv.copy(x.quaternion).invert();
        }
      },
    };
    const remotes = new RemoteEntities(game, { view: view() });
    const s = { frame: planet, pos: new THREE.Vector3(b.soi * 1.05 - 400, 0, 0), quat: new THREE.Quaternion(), vel: new THREE.Vector3(300, 0, 0) };
    const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() };
    let crossed = null;
    const at = (t) => {
      if (t > 300) s.pos.addScaledVector(s.vel, 0.05);
      if (s.frame === planet && s.pos.length() > b.soi * 1.05) {
        // (its client 0.8 s behind the server's clock after a hitch)
        setFrameInto(s, framePoseAt(planet, t - 0.8, pose), null);
        s.frame = null;
        crossed = t;
      }
      return [{ id: 1, kind: 'player', mode: 'ship', frame: s.frame ? frameId(0) : null, pos: s.pos.toArray(), quat: s.quat.toArray(), vel: s.vel.toArray() }];
    };
    // where it is drawn, and where it would be drawn with nothing blended, in the planet's frame
    const drawn = [];
    const raw = [];
    play(remotes, game, at, {
      from: 300,
      to: 304,
      watch: () => {
        const r = remotes.get(1);
        if (!r?.shown) return;
        drawn.push(planet.worldToLocal(r.world, new THREE.Vector3()));
        raw.push(planet.worldToLocal(r.frame ? r.frame.localToWorld(r.pose.pos, new THREE.Vector3()) : r.pose.pos.clone(), new THREE.Vector3()));
      },
    });
    expect(crossed).not.toBeNull();
    expect(remotes.get(1).frame).toBeNull();
    // drawn as the snapshots have it, it would leap kilometres in a frame; blended, it never steps more than its motion
    // (riding the planet's turning: ~2.5 km/s here) and the blend's few hundred metres a second
    const leap = Math.max(...steps(raw));
    expect(leap).toBeGreaterThan(SNAP_M);
    expect(Math.max(...steps(drawn))).toBeLessThan(leap / 10);
    expect(drawn.at(-1).distanceTo(raw.at(-1))).toBeLessThan(1);
  });
});

describe('RemoteEntities: late snapshots', () => {
  it('blends a late snapshot in where extrapolating went astray', () => {
    const { game } = world();
    const remotes = new RemoteEntities(game, { view: view() });
    // turning hard (300 m/s round a 400 m circle) in the Waystation's frame; the snapshots of 0.3 s go missing and then
    // come together, after 250 ms of extrapolating along a straight line
    const R = 400;
    const W = 300 / R;
    const at = (t) => [
      {
        id: 1,
        kind: 'ship',
        frame: frameId('station'),
        pos: [R * Math.cos(W * t), 0, R * Math.sin(W * t)],
        quat: Q,
        vel: [-R * W * Math.sin(W * t), 0, R * W * Math.cos(W * t)],
      },
    ];
    const drawn = [];
    const raw = [];
    play(remotes, game, at, {
      from: 400,
      to: 402,
      trip: (t) => (t > 400.8 && t < 401.1 ? 401.1 - t + 0.03 : 0.03),
      watch: () => {
        const r = remotes.get(1);
        if (!r?.shown) return;
        drawn.push(r.pos.clone());
        raw.push(r.pose.pos.clone());
      },
    });
    // the second difference of where it is drawn frame to frame: 6 cm on the circle
    // (from half a second in, once it is under way): 6 cm on the circle, 7 m where the late samples take over from the
    // straight line, a quarter of a metre blended
    const bends = (list) =>
      list
        .slice(2)
        .map((p, k) => p.clone().sub(list[k + 1]).sub(list[k + 1]).add(list[k]).length())
        .slice(30);
    expect(Math.max(...bends(raw))).toBeGreaterThan(5);
    expect(Math.max(...bends(drawn))).toBeLessThan(0.5);
  });
});

describe('RemoteEntities: following Net', () => {
  it('ingests each snapshot Net applies (without the player itself), and starts over on a welcome', () => {
    const { game } = world();
    game.place(500);
    const handlers = new Map();
    const net = {
      entityId: 9,
      store: { entities: new Map(), time: 0 },
      serverTime: () => 500.05,
      on(type, fn) {
        handlers.set(type, fn);
        return () => handlers.delete(type);
      },
    };
    const remotes = new RemoteEntities(game, { view: view() });
    remotes.attach(net);
    const e = (id) => ({ id, kind: 'player', mode: 'ship', frame: frameId('station'), pos: [id, 0, 0], quat: Q, vel: [0, 0, 0] });
    net.store = { entities: new Map([[9, e(9)], [3, e(3)]]), time: 500 };
    handlers.get('snapshot')({ tick: 1 });
    expect(remotes.get(3)).toBeDefined();
    expect(remotes.get(9)).toBeUndefined();
    // the trip is timed on Net's estimate of the server's clock (50 ms), the render time runs on world time, which the
    // bodies stand at, less the trip and the delay
    remotes.update(DT);
    expect(remotes.renderTime).toBeCloseTo(500 - 0.05 - 0.1, 9);
    handlers.get('welcome')({});
    expect(remotes.list).toEqual([]);
    remotes.detach();
    expect(handlers.size).toBe(0);
  });
});
