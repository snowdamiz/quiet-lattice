// The three peoples' home systems (DESIGN 5.1): which systems they are, the home worlds and capitals forced on them, the
// mild toxic world's air, and that nothing else in the galaxy changes.
import { describe, expect, it } from 'vitest';
import { PEOPLES, PEOPLE_IDS as DATA_PEOPLE_IDS } from '../src/data/index.ts';
import { PeopleId } from '../src/protocol/index.ts';
import {
  GALAXY_SEED,
  Galaxy,
  HOME_WORLDS,
  PEOPLE_IDS,
  STATION,
  TerrainSampler,
  createPlanetParams,
  describeGalaxySystem,
  describeSystem,
  galaxySystemOptions,
  homeNeighbours,
  homeSystemAt,
  homeSystems,
  layoutCity,
  mistHazard,
  planCities,
  planKind,
  streetDistance,
  streetPlan,
  type GalaxySystem,
  type Mist,
  type PlanetParams,
  type SystemDescription,
} from '../src/world/index.ts';
import { planSurface } from './surface.ts';

// (shared is typed without Node or the DOM; vitest runs it under Node, which has a console)
declare const console: { log(message: string): void };

const galaxy = new Galaxy(GALAXY_SEED);
const homes = homeSystems();
/** A system as its seed alone makes it (with the galaxy's name and class): nothing forced. */
const natural = (i: number) => describeSystem(galaxy.systems[i].seed, { name: galaxy.systems[i].name, cls: galaxy.systems[i].cls });

describe('home systems, seed 424242 (golden)', () => {
  it('are system 0 and the two neighbours closest together with it: Thalune lush, Ixari exotic, Ulgani mild toxic', () => {
    const table = homes.map((h) => {
      const d = describeGalaxySystem(galaxy.systems[h.systemIndex]);
      const ly = galaxy.distance(galaxy.systems[h.systemIndex], galaxy.systems[0]);
      return `${h.people.padEnd(7)} system ${String(h.systemIndex).padStart(2)} ${d.name.padEnd(10)} seed ${h.systemSeed} body ${h.homePlanetIndex} ${d.bodies[h.homePlanetIndex].name.padEnd(14)} ${h.type}${h.mild ? ' (mild)' : ''} · ${h.capital.name} (${h.capital.plan}) · ${ly.toFixed(2)} ly`;
    });
    const [a, b, c] = homes.map((h) => galaxy.systems[h.systemIndex]);
    const sides = `${a.id}–${b.id} ${galaxy.distance(a, b).toFixed(2)} ly, ${a.id}–${c.id} ${galaxy.distance(a, c).toFixed(2)} ly, ${b.id}–${c.id} ${galaxy.distance(b, c).toFixed(2)} ly`;
    console.log(`home systems of galaxy ${GALAXY_SEED}:\n  ${table.join('\n  ')}\n  apart: ${sides}`);
    expect(table).toEqual([
      'thalune system  0 Orxa       seed 2981198913 body 1 Orxa II        lush · Sarelun (radial) · 0.00 ly',
      'ixari   system 59 Kaial      seed 2853974035 body 3 Kaial III      alien · Quavel (spiral) · 9.55 ly',
      'ulgani  system  1 Ostrhekai  seed 4277949890 body 1 Ostrhekai II   toxic (mild) · Belost (grid) · 9.91 ly',
    ]);
    expect(sides).toBe('0–59 9.55 ly, 0–1 9.91 ly, 59–1 12.18 ly');
    expect(
      homes.map(({ people, systemIndex, systemSeed, homePlanetIndex, type, mild }) => ({ people, systemIndex, systemSeed, homePlanetIndex, type, mild })),
    ).toEqual([
      { people: 'thalune', systemIndex: 0, systemSeed: 2981198913, homePlanetIndex: 1, type: 'lush', mild: false },
      { people: 'ixari', systemIndex: 59, systemSeed: 2853974035, homePlanetIndex: 3, type: 'alien', mild: false },
      { people: 'ulgani', systemIndex: 1, systemSeed: 4277949890, homePlanetIndex: 1, type: 'toxic', mild: true },
    ]);
    expect(homes.map((h) => [h.capital.name, h.capital.plan, h.capital.people])).toEqual([
      ['Sarelun', 'radial', 'thalune'],
      ['Quavel', 'spiral', 'ixari'],
      ['Belost', 'grid', 'ulgani'],
    ]);
  });

  it('make the smallest triangle with system 0 (its longest side the shortest of any pair), the nearer one the Ixari’s', () => {
    const [first, near, far] = homes.map((h) => galaxy.systems[h.systemIndex]);
    const longest = (p: GalaxySystem, q: GalaxySystem) => Math.max(galaxy.distance(first, p), galaxy.distance(first, q), galaxy.distance(p, q));
    const side = longest(near, far);
    const rest = galaxy.systems.slice(1);
    for (const p of rest)
      for (const q of rest) if (p.id < q.id && !(p === near && q === far) && !(p === far && q === near)) expect(longest(p, q)).toBeGreaterThan(side);
    expect(galaxy.distance(first, near)).toBeLessThanOrEqual(galaxy.distance(first, far));
    expect(homeNeighbours(galaxy)).toEqual([near, far]);
    // about one warp apart, all three (DESIGN 5.1: "within ~10 ly of each other")
    expect(side).toBeLessThan(12.5);
  });

  it('are worked out once, frozen, and the same for the same seed', () => {
    expect(homeSystems(GALAXY_SEED)).toBe(homes);
    expect(Object.isFrozen(homes) && homes.every((h) => Object.isFrozen(h) && Object.isFrozen(h.capital))).toBe(true);
    const other = homeSystems(1234);
    expect(other.map((h) => h.people)).toEqual([...PEOPLE_IDS]);
    expect(other[0].systemIndex).toBe(0);
    expect(new Set(other.map((h) => h.systemIndex)).size).toBe(3);
    // (the home world index is where describeSystem puts the habitable world)
    const g = new Galaxy(1234);
    for (const h of other) expect(describeGalaxySystem(g.systems[h.systemIndex]).home).toBe(h.homePlanetIndex);
    // (a system is looked up in its own galaxy, the game's when it does not say, and one from another galaxy is refused)
    expect(homeSystemAt(g.systems[0])).toBe(other[0]);
    expect(homeSystemAt({ id: 0, seed: galaxy.systems[0].seed })).toBe(homes[0]);
    expect(() => homeSystemAt({ id: 0, seed: g.systems[0].seed })).toThrow(RangeError);
  });

  it('agree with the peoples’ data table and the protocol', () => {
    expect([...PEOPLE_IDS]).toEqual([...DATA_PEOPLE_IDS]);
    expect([...PEOPLE_IDS]).toEqual(PeopleId.options);
    for (const p of PEOPLES) {
      const w = HOME_WORLDS[p.id];
      expect({ type: w.type, mild: w.mild, capital: w.capital.name, plan: w.capital.plan, people: w.capital.people }).toEqual({
        type: p.homeWorld.archetype,
        mild: p.homeWorld.mild,
        capital: p.capital.name,
        plan: p.capital.plan,
        people: p.id,
      });
    }
  });
});

describe('the forced home worlds', () => {
  it.each(homes)('$people: $type home world with its capital $capital.name, and the Waystation orbiting it', (h) => {
    const d = describeGalaxySystem(galaxy.systems[h.systemIndex]);
    const world = d.bodies[h.homePlanetIndex];
    expect(d.home).toBe(h.homePlanetIndex);
    expect(world.kind).toBe('planet');
    expect({ type: world.type, paramsType: world.params.type }).toEqual({ type: HOME_WORLDS[h.people].type, paramsType: HOME_WORLDS[h.people].type });
    const p = world.params as PlanetParams;
    expect(p.capital).toEqual(h.capital);
    expect(p.cityCount).toBeGreaterThanOrEqual(1);

    // the capital is the first city, on a planned plain, named and laid out as its people build
    const { cities } = planSurface(p);
    const capital = cities[0];
    expect(capital.name).toBe(h.capital.name);
    expect(capital.capital).toEqual(h.capital);
    expect(capital.radius).toBeGreaterThanOrEqual(1100);
    expect(capital.radius).toBeLessThanOrEqual(2100);
    expect(cities.slice(1).every((c) => !c.capital && c.name !== h.capital.name)).toBe(true);
    const plan = streetPlan(capital);
    expect(planKind(plan)).toBe(h.capital.plan);
    const layout = layoutCity(capital, plan);
    expect(layout.buildings.length).toBeGreaterThan(500);
    for (const b of layout.buildings) expect(streetDistance(plan, b[0], b[1])).toBeGreaterThanOrEqual(plan.width / 2 + b[2]);

    // its Waystation, in low orbit round the home world
    expect(d.station).toMatchObject({ name: `${d.name} Waystation`, parent: h.homePlanetIndex, orbitRadius: world.radius + STATION.altitude });
  });

  it('only the Ulgani world is mild: no ship hazard, and air caustic only above a mist line its capital stands below', () => {
    for (const h of homes) {
      const p = describeGalaxySystem(galaxy.systems[h.systemIndex]).bodies[h.homePlanetIndex].params as PlanetParams;
      if (!h.mild) {
        expect(p.mist).toBeUndefined();
        continue;
      }
      expect(p.hazard).toBeNull();
      const mist = p.mist!;
      expect(mist.line).toBeGreaterThan(0);
      const { cities, sampler } = planSurface(p);
      // the capital's plain, and the ground it was levelled from, breathe
      expect(cities[0].base + cities[0].relief).toBeLessThan(mist.line);
      expect(mistHazard(mist, cities[0].base).foot).toBe(0);
      // the lowlands breathe; the hills and ranges above the line do not
      let land = 0;
      let above = 0;
      for (let i = 0; i < 4000; i++) {
        const y = 1 - (2 * (i + 0.5)) / 4000;
        const r = Math.sqrt(1 - y * y);
        const a = i * Math.PI * (3 - Math.sqrt(5));
        const ht = sampler.height(Math.cos(a) * r, y, Math.sin(a) * r);
        if (ht > 0) land++;
        if (ht > mist.line) above++;
      }
      expect(above / land).toBeGreaterThan(0.02);
      expect(above / land).toBeLessThan(0.3);
    }
  });

  it('changes nothing else in the three systems', () => {
    const rest = (d: SystemDescription) => ({ ...d, bodies: d.bodies.filter((b) => b.index !== d.home) });
    for (const h of homes) expect(rest(describeGalaxySystem(galaxy.systems[h.systemIndex]))).toStrictEqual(rest(natural(h.systemIndex)));
  });

  it('changes no other system in the galaxy', () => {
    const homeIds = new Set(homes.map((h) => h.systemIndex));
    for (const s of galaxy.systems) {
      if (homeIds.has(s.id)) continue;
      expect(galaxySystemOptions(s)).toEqual({ name: s.name, cls: s.cls });
      expect(describeGalaxySystem(s)).toStrictEqual(natural(s.id));
    }
  });

  it('hands out copies: changing the options changes no home', () => {
    const opts = galaxySystemOptions(galaxy.systems[homes[2].systemIndex]);
    opts.capital!.name = 'Elsewhere';
    expect(homeSystems()[2].capital.name).toBe('Belost');
    expect(galaxySystemOptions(galaxy.systems[homes[2].systemIndex]).capital!.name).toBe('Belost');
  });
});

describe('the mild variant’s air: mistHazard', () => {
  const mist: Mist = { line: 700, band: 150, rate: 1.2 };

  it('is breathable at and below the mist line, at sea level and under it', () => {
    for (const alt of [-200, 0, 120, 699.9, 700]) expect(mistHazard(mist, alt)).toEqual({ foot: 0, ship: null });
  });

  it('turns caustic across the band above the line, smoothly and only upward, as harsh as a toxic world at the top', () => {
    let last = 0;
    for (let alt = 700; alt <= 850; alt += 5) {
      const { foot } = mistHazard(mist, alt);
      expect(foot).toBeGreaterThanOrEqual(last);
      expect(foot - last).toBeLessThan(0.08);
      last = foot;
    }
    expect(mistHazard(mist, 775).foot).toBeCloseTo(0.6, 12);
    for (const alt of [850, 1200, 9000, 1e6]) expect(mistHazard(mist, alt).foot).toBe(1.2);
  });

  it('is never a ship hazard', () => {
    for (let alt = -100; alt < 20000; alt += 250) expect(mistHazard(mist, alt).ship).toBeNull();
  });

  it('is what a mild world is made with, and a world made mild keeps everything else', () => {
    for (let seed = 1; seed < 40; seed++) {
      const own = createPlanetParams(seed, 'toxic', 95000);
      const mild = createPlanetParams(seed, 'toxic', 95000, { mild: true });
      expect(mild.hazard).toBeNull();
      expect(mild.mist).toEqual({ line: own.mountainHeight * 0.3 + 400, band: 150, rate: 1.2 });
      const { hazard: h1, mist: m1, ...a } = own;
      const { hazard: h2, mist: m2, ...b } = mild;
      expect(b).toEqual(a);
      expect([h2, m1]).toEqual([null, undefined]);
      expect(h1 === null || h1.kind === 'acid').toBe(true);
      expect(m2).toBeDefined();
    }
  });
});

describe('a spiral street plan', () => {
  const plan = { ...streetPlan({ seed: 5, capital: { plan: 'spiral' } }) };

  it('winds its arms out from the plaza, a ring gap apart, crossed by its spokes', () => {
    expect(planKind(plan)).toBe('spiral');
    expect(plan.radial).toBe(true);
    for (const arms of [1, 2]) {
      const p = { ...plan, arms };
      for (let k = 0; k < 400; k++) {
        const a = -Math.PI + (k / 400) * Math.PI * 2;
        for (let n = 1; n < 6; n++) {
          const r = p.plaza + p.ringGap * (n + (arms * a) / (Math.PI * 2));
          expect(streetDistance(p, Math.cos(a) * r, Math.sin(a) * r)).toBeLessThan(1e-6);
        }
      }
      // halfway between two turns, away from the spokes, the nearest street is half a gap off
      const seg = (Math.PI * 2) / p.spokes;
      const a = seg / 2;
      const r = p.plaza + p.ringGap * (3.5 + (arms * a) / (Math.PI * 2));
      expect(streetDistance(p, Math.cos(a) * r, Math.sin(a) * r)).toBeCloseTo(p.ringGap / 2, 6);
    }
  });

  it('only for a capital: other cities draw their plans as they always have', () => {
    for (let seed = 1; seed < 200; seed++) {
      const own = streetPlan({ seed });
      expect(own.arms).toBeUndefined();
      expect(planKind(own)).toBe(own.radial ? 'radial' : 'grid');
      for (const kind of ['radial', 'grid', 'spiral'] as const) {
        const forced = streetPlan({ seed, capital: { plan: kind } });
        expect(planKind(forced)).toBe(kind);
        expect({ plaza: forced.plaza, width: forced.width, ringGap: forced.ringGap, block: forced.block, angle: forced.angle }).toEqual({
          plaza: own.plaza,
          width: own.width,
          ringGap: own.ringGap,
          block: own.block,
          angle: own.angle,
        });
      }
    }
  });

  it('plans a capital on any world it is forced on', () => {
    const p = createPlanetParams(77, 'alien', 100000, { capital: { name: 'Quavel', plan: 'spiral', people: 'ixari' } });
    const cities = planCities(p, new TerrainSampler(p));
    expect(cities[0]).toMatchObject({ name: 'Quavel', capital: { name: 'Quavel', plan: 'spiral', people: 'ixari' } });
  });
});
