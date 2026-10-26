// The skill web's rules (P1.E07.T01, DESIGN 9.1): points, fragments and unlocks, the tier levels and prerequisites of a
// purchase, the two bars, respec, and that 152 points own the whole web exactly. Every rule is pure: inputs are frozen.
import { describe, expect, it } from 'vitest';
import { BRANCHES, deepFreeze, FRAGMENT_WORLDS, HULLS, PEOPLES, SKILL_NODES, SKILL_RULES, webPointCost, type Requirement } from '../src/data/index.ts';
import {
  applySkillOp,
  BAR_SLOTS,
  buyError,
  buyNode,
  contextOf,
  emptySkillState,
  FRAGMENT_BRANCHES,
  fragmentBalance,
  grantFragments,
  grantPoints,
  GROUND_SLOTS,
  levelPoints,
  MAX_GRANTED_POINTS,
  newSkillState,
  nodeStatus,
  parseSkillOp,
  parseSkillState,
  pointsOf,
  respecCost,
  respecNodes,
  setAvailablePoints,
  SHIP_SLOTS,
  skillStateProblem,
  skillStateSchema,
  slotNode,
  unlockVia,
  unlockWithFragments,
  unslotNode,
  usableSlots,
  WEB_REQUIREMENTS,
  type SkillContext,
  type SkillResult,
  type SkillState,
} from '../src/skills/index.ts';

const REACHES: Requirement = { kind: 'faction_rank', faction: 'reaches', rank: 'deckhand' };
const ctx = (level = 50, opts: { shipSlots?: number; meets?: boolean } = {}): SkillContext => ({
  level,
  shipSlots: opts.shipSlots ?? 2,
  meets: () => opts.meets ?? false,
});

function ok<T extends object>(r: SkillResult<T>): Extract<SkillResult<T>, { ok: true }> {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r;
}

function code(r: SkillResult): string | null {
  return r.ok ? null : r.error.code;
}

/** A state frozen, so a rule that mutated its input would throw. */
function frozen(s: SkillState): SkillState {
  return deepFreeze(JSON.parse(JSON.stringify(s)) as SkillState);
}

/** `ids` unlocked (by the developer route) and bought in order, with enough points; the state frozen. */
function owning(ids: string[], level = 50, base: SkillState = emptySkillState()): SkillState {
  let s = ok(setAvailablePoints(base, level, 200)).state;
  for (const id of ids) {
    if (!s.unlocked.includes(id)) s = ok(unlockVia(s, ctx(level), id, { kind: 'dev' })).state;
    s = ok(buyNode(s, ctx(level, { meets: true }), id)).state;
  }
  return frozen(s);
}

describe('skill state', () => {
  it('has the fragment branches the monolith table names, six ground slots and as many ship slots as the roomiest hull', () => {
    const named = new Set(Object.values(FRAGMENT_WORLDS));
    expect([...FRAGMENT_BRANCHES]).toEqual(BRANCHES.filter((b) => named.has(b)));
    expect(GROUND_SLOTS).toBe(6);
    expect(SHIP_SLOTS).toBe(Math.max(...HULLS.map((h) => h.abilitySlots)));
    expect(SHIP_SLOTS).toBe(5);
    expect(BAR_SLOTS).toEqual({ ground: 6, ship: 5 });
  });

  it('starts a character with its people’s node unlocked and nothing else', () => {
    for (const p of PEOPLES) {
      const s = newSkillState(p.id);
      expect(skillStateSchema.parse(s)).toEqual(s);
      expect(s.unlocked).toEqual([p.preUnlocked.node]);
      expect(s.bought).toEqual([]);
      expect(s.granted).toBe(0);
      expect(s.slots).toEqual({ ground: Array(6).fill(null), ship: Array(5).fill(null) });
      for (const b of FRAGMENT_BRANCHES) expect(s.fragments[b]).toEqual({ earned: 0, spent: 0 });
    }
    expect(newSkillState('thalune').unlocked).toEqual(['second_lung']);
    expect(newSkillState('ixari').unlocked).toEqual(['pulse']);
    expect(newSkillState('ulgani').unlocked).toEqual(['cartridge_recycler']);
  });

  it('refuses values that break the web: unknown, repeated or unowned nodes, wrong bars, fragment ledgers that do not add up', () => {
    const s = owning(['pull', 'pull_many', 'tractor_beam']);
    expect(parseSkillState(s).ok).toBe(true);
    const bad: unknown[] = [
      { ...s, bought: [...s.bought, 'warp'] },
      { ...s, bought: [...s.bought, 'pull'] },
      { ...s, unlocked: [...s.unlocked, 'pull'] },
      { ...s, bought: [...s.bought, 'slam'] },
      { ...s, slots: { ...s.slots, ground: ['slam', null, null, null, null, null] } },
      { ...s, slots: { ...s.slots, ground: ['tractor_beam', null, null, null, null, null] } },
      { ...s, slots: { ...s.slots, ground: ['pull_many', null, null, null, null, null] } },
      { ...s, slots: { ...s.slots, ground: ['pull', 'pull', null, null, null, null] } },
      { ...s, slots: { ...s.slots, ship: [null, null] } },
      { ...s, fragments: { ...s.fragments, thermal: { earned: 2, spent: 3 } } },
      { ...s, fragments: { ...s.fragments, exosuit: { earned: 0, spent: 0 } } },
      { ...s, granted: -1 },
      { ...s, granted: MAX_GRANTED_POINTS + 1 },
      { ...s, skillPoints: 3 },
    ];
    for (const b of bad) expect(parseSkillState(b), JSON.stringify(b).slice(0, 120)).toMatchObject({ ok: false, error: { code: 'invalid_state' } });
  });

  it('refuses a value whose owned nodes lack their prerequisites', () => {
    const s = owning(['pull', 'pull_many']);
    // Pull Many without Pull: the schema holds, the web's rules do not
    const orphan = { ...s, bought: ['pull_many'] };
    expect(skillStateSchema.safeParse(orphan).success).toBe(true);
    expect(skillStateProblem(orphan)).toMatch(/Pull Many is owned without .*Pull/);
    expect(parseSkillState(orphan)).toMatchObject({ ok: false, error: { code: 'invalid_state' } });
    expect(skillStateProblem({ ...s, bought: ['slam'], unlocked: ['slam'] })).toMatch(/Tier I gravitic/);
    expect(skillStateProblem(s)).toBeNull();
  });
});

describe('skill points', () => {
  it('are one per level, plus those granted, less what owned nodes cost (1, capstones 3, conjunctions 2)', () => {
    expect(levelPoints(1)).toBe(1);
    expect(levelPoints(15)).toBe(15);
    expect(levelPoints(50)).toBe(50);
    expect(levelPoints(51)).toBe(50);
    const s = frozen({ ...emptySkillState(), granted: 4 });
    expect(pointsOf(s, 10)).toEqual({ fromLevels: 10, granted: 4, earned: 14, spent: 0, available: 14 });
    const built = owning(['pull', 'slam', 'anchor', 'singularity', 'lance', 'flare', 'collapse_star']);
    expect(pointsOf(built, 50).spent).toBe(1 + 1 + 1 + 3 + 1 + 1 + 2);
  });

  it('are granted in whole points, and set to what is available without ever taking back what levels give', () => {
    const s = frozen(emptySkillState());
    expect(ok(grantPoints(s, 3)).state.granted).toBe(3);
    for (const n of [0, -1, 1.5, NaN]) expect(code(grantPoints(s, n))).toBe('bad_count');
    expect(code(grantPoints(frozen({ ...s, granted: MAX_GRANTED_POINTS }), 1))).toBe('bad_count');

    const set = ok(setAvailablePoints(s, 10, 25));
    expect(set.state.granted).toBe(15);
    expect(set.available).toBe(25);
    // below what the levels give: the grant goes to zero and the level's points stay
    const low = ok(setAvailablePoints(frozen({ ...s, granted: 7 }), 10, 3));
    expect(low.state.granted).toBe(0);
    expect(low.available).toBe(10);
    // spent points count: having spent 4 at level 10, 152 available needs 146 granted
    const built = owning(['pull', 'slam', 'well', 'dense_bones'], 15);
    const all = ok(setAvailablePoints(built, 10, 152));
    expect(pointsOf(all.state, 10)).toMatchObject({ spent: 4, available: 152 });
    expect(code(setAvailablePoints(s, 10, -1))).toBe('bad_count');
    expect(code(setAvailablePoints(s, 1, MAX_GRANTED_POINTS + 2))).toBe('bad_count');
  });
});

describe('fragments and unlocks', () => {
  it('keeps a ledger per fragment branch; Pilot and Exo-suit have none', () => {
    let s = frozen(emptySkillState());
    s = ok(grantFragments(s, 'gravitic', 2)).state;
    s = ok(grantFragments(s, 'gravitic', 1)).state;
    expect(s.fragments.gravitic).toEqual({ earned: 3, spent: 0 });
    expect(fragmentBalance(s, 'gravitic')).toBe(3);
    expect(fragmentBalance(s, 'pilot')).toBe(0);
    expect(code(grantFragments(s, 'pilot', 1))).toBe('no_fragments');
    expect(code(grantFragments(s, 'exosuit', 1))).toBe('no_fragments');
    expect(code(grantFragments(s, 'conjunction', 1))).toBe('no_fragments');
    for (const n of [0, -2, 0.5]) expect(code(grantFragments(s, 'thermal', n))).toBe('bad_count');
  });

  it('unlocks a node by spending its tier’s fragments of its branch: Tier I 1, Tier II 3, Tier III 6', () => {
    let s = frozen(ok(grantFragments(emptySkillState(), 'gravitic', 10)).state);
    const pull = ok(unlockWithFragments(s, ctx(1), 'pull'));
    expect(pull).toMatchObject({ branch: 'gravitic', spent: 1 });
    s = frozen(pull.state);
    expect(s.unlocked).toEqual(['pull']);
    s = frozen(ok(unlockWithFragments(s, ctx(1), 'well')).state);
    expect(s.fragments.gravitic).toEqual({ earned: 10, spent: 4 });
    s = frozen(ok(unlockWithFragments(s, ctx(1), 'anchor')).state);
    expect(fragmentBalance(s, 'gravitic')).toBe(0);
    // unlocking needs no level: only buying does
    expect(s.unlocked).toEqual(['pull', 'well', 'anchor']);
    expect(code(unlockWithFragments(s, ctx(1), 'slam'))).toBe('fragments');
    expect(code(unlockWithFragments(s, ctx(1), 'pull'))).toBe('already_unlocked');
    expect(code(unlockWithFragments(s, ctx(1), 'warp'))).toBe('unknown_node');
  });

  it('never unlocks with fragments what the world unlocks another way: Pilot, Exo-suit, capstones, conjunctions', () => {
    const rich = frozen(FRAGMENT_BRANCHES.reduce((s, b) => ok(grantFragments(s, b, 1000)).state, emptySkillState()));
    for (const id of ['throttle_tuning', 'pack_mule', 'singularity', 'corona', 'collapse_star', 'second_skin', 'ace'])
      expect(code(unlockWithFragments(rich, ctx(50, { meets: true }), id)), id).toBe('no_route');
  });

  it('holds Void behind Free Reaches standing (DESIGN 9.6), whichever way it is unlocked', () => {
    const s = frozen(ok(grantFragments(emptySkillState(), 'void', 5)).state);
    expect(WEB_REQUIREMENTS).toEqual([REACHES]);
    expect(code(unlockWithFragments(s, ctx(1), 'phase'))).toBe('requirement');
    expect(code(unlockVia(s, ctx(1), 'phase', { kind: 'trainer', trainer: 'reaches_quartermaster' }))).toBe('requirement');
    const standing: SkillContext = { ...ctx(1), meets: (r) => r.faction === 'reaches' && r.rank === 'deckhand' };
    expect(fragmentBalance(ok(unlockWithFragments(s, standing, 'phase')).state, 'void')).toBe(4);
    expect(ok(unlockVia(s, standing, 'phase', { kind: 'trainer', trainer: 'reaches_quartermaster' })).state.unlocked).toEqual(['phase']);
    // fragments of the branch still gather without standing
    expect(ok(grantFragments(s, 'void', 1)).state.fragments.void.earned).toBe(6);
  });

  it('unlocks from the world only by a route the node lists', () => {
    const s = frozen(emptySkillState());
    const c = ctx(1);
    // trainers: a city master teaches Exo-suit and Symbiotic; a Waystation outfitter Pilot and Thermal's ship forms only
    expect(ok(unlockVia(s, c, 'pack_mule', { kind: 'trainer', trainer: 'city_master' })).state.unlocked).toEqual(['pack_mule']);
    expect(code(unlockVia(s, c, 'pack_mule', { kind: 'trainer', trainer: 'waystation_outfitter' }))).toBe('no_route');
    expect(ok(unlockVia(s, c, 'focused_lasers', { kind: 'trainer', trainer: 'waystation_outfitter' })).ok).toBe(true);
    expect(code(unlockVia(s, c, 'lance', { kind: 'trainer', trainer: 'waystation_outfitter' }))).toBe('no_route');
    // story chapters: capstones, at their chapter or later
    expect(code(unlockVia(s, c, 'singularity', { kind: 'chapter', chapter: 12 }))).toBe('no_route');
    expect(ok(unlockVia(s, c, 'singularity', { kind: 'chapter', chapter: 13 })).ok).toBe(true);
    expect(ok(unlockVia(s, c, 'ace', { kind: 'chapter', chapter: 26 })).ok).toBe(true);
    expect(code(unlockVia(s, c, 'pull', { kind: 'chapter', chapter: 26 }))).toBe('no_route');
    // discoveries: conjunctions; quests: the quest that teaches it; peoples: their own node
    expect(ok(unlockVia(s, c, 'collapse_star', { kind: 'discovery' })).ok).toBe(true);
    expect(code(unlockVia(s, c, 'pull', { kind: 'discovery' }))).toBe('no_route');
    expect(ok(unlockVia(s, c, 'hazard_weave', { kind: 'quest', quest: 'the_apothecarys_sodium' })).ok).toBe(true);
    expect(code(unlockVia(s, c, 'hazard_weave', { kind: 'quest', quest: 'another' }))).toBe('no_route');
    expect(ok(unlockVia(s, c, 'pulse', { kind: 'people', people: 'ixari' })).ok).toBe(true);
    expect(code(unlockVia(s, c, 'pulse', { kind: 'people', people: 'thalune' }))).toBe('no_route');
    // the developer route takes anything, Void included
    expect(ok(unlockVia(s, c, 'unremembered', { kind: 'dev' })).ok).toBe(true);
    expect(code(unlockVia(newSkillState('thalune'), c, 'second_lung', { kind: 'dev' }))).toBe('already_unlocked');
    expect(code(unlockVia(s, c, 'nothing', { kind: 'dev' }))).toBe('unknown_node');
  });
});

describe('buying', () => {
  const unlocked = (ids: string[], base: SkillState = emptySkillState()) =>
    frozen(ids.reduce((s, id) => ok(unlockVia(s, ctx(), id, { kind: 'dev' })).state, base));

  it('needs the node unlocked, not owned, and the points', () => {
    const s = unlocked(['pull', 'heavy_footing']);
    expect(code(buyNode(s, ctx(1), 'tractor_beam'))).toBe('not_unlocked');
    const one = ok(buyNode(s, ctx(1), 'pull'));
    expect(one.points).toBe(1);
    expect(code(buyNode(frozen(one.state), ctx(1), 'pull'))).toBe('already_owned');
    // level 1 gives one point, now spent
    expect(code(buyNode(frozen(one.state), ctx(1), 'heavy_footing'))).toBe('points');
    expect(buyError(frozen(one.state), ctx(1), 'heavy_footing')?.message).toMatch(/costs 1 points; you have 0/);
    expect(ok(buyNode(frozen(one.state), ctx(2), 'heavy_footing')).state.bought).toEqual(['pull', 'heavy_footing']);
    expect(code(buyNode(s, ctx(1), 'warp'))).toBe('unknown_node');
  });

  it('gates each tier by level: Tier I from 1, Tier II from 15, Tier III from 30, capstones from 45, conjunctions from 15', () => {
    const cases: [string[], string, number][] = [
      [['pull'], 'slam', 15],
      [['pull', 'slam'], 'anchor', 30],
      [['pull', 'slam', 'anchor'], 'singularity', 45],
      [['pull', 'slam', 'lance', 'flare'], 'collapse_star', 15],
    ];
    for (const [owned, id, level] of cases) {
      const s = frozen(ok(unlockVia(owning(owned, 50), ctx(), id, { kind: 'dev' })).state);
      const rich = frozen({ ...s, granted: 100 });
      expect(code(buyNode(rich, ctx(level - 1), id)), id).toBe('level');
      expect(ok(buyNode(rich, ctx(level), id)).state.bought).toContain(id);
    }
  });

  it('needs a node of the tier below in its branch (any), an augment its target, a conjunction Tier II in both branches', () => {
    const rich = (owned: string[], id: string) => frozen({ ...ok(unlockVia(owning(owned), ctx(), id, { kind: 'dev' })).state, granted: 100 });
    expect(code(buyNode(rich([], 'slam'), ctx(), 'slam'))).toBe('prerequisite');
    // a Tier I of another branch does not count; any Tier I of this one does
    expect(code(buyNode(rich(['lance'], 'slam'), ctx(), 'slam'))).toBe('prerequisite');
    expect(ok(buyNode(rich(['heavy_footing'], 'slam'), ctx(), 'slam')).ok).toBe(true);
    expect(code(buyNode(rich(['heavy_footing'], 'anchor'), ctx(), 'anchor'))).toBe('prerequisite');
    // Pull Many augments Pull: another Tier I is not enough
    expect(buyError(rich(['heavy_footing'], 'pull_many'), ctx(), 'pull_many')).toMatchObject({ code: 'prerequisite', message: /Pull Many needs Pull/ });
    expect(ok(buyNode(rich(['pull'], 'pull_many'), ctx(), 'pull_many')).ok).toBe(true);
    // the capstone needs a Tier III
    expect(code(buyNode(rich(['pull', 'slam'], 'singularity'), ctx(), 'singularity'))).toBe('prerequisite');
    // Collapse Star joins Gravitic and Thermal: Tier II of both
    expect(code(buyNode(rich(['pull', 'slam'], 'collapse_star'), ctx(), 'collapse_star'))).toBe('prerequisite');
    expect(buyError(rich(['pull', 'lance', 'flare'], 'collapse_star'), ctx(), 'collapse_star')?.message).toMatch(/Tier II gravitic/);
    expect(ok(buyNode(rich(['pull', 'slam', 'lance', 'flare'], 'collapse_star'), ctx(), 'collapse_star')).points).toBe(2);
  });

  it('holds Void behind standing when buying too', () => {
    const s = frozen({ ...ok(unlockVia(emptySkillState(), ctx(), 'phase', { kind: 'dev' })).state, granted: 5 });
    expect(code(buyNode(s, ctx(), 'phase'))).toBe('requirement');
    expect(ok(buyNode(s, ctx(50, { meets: true }), 'phase')).ok).toBe(true);
  });

  it('owns the whole web with exactly 152 points, and not with 151', () => {
    const everything = frozen(SKILL_NODES.reduce((s, n) => ok(unlockVia(s, ctx(), n.id, { kind: 'dev' })).state, emptySkillState()));
    const buyAll = (points: number): SkillState => {
      let s = ok(setAvailablePoints(everything, 50, points)).state;
      const c = ctx(50, { meets: true });
      for (let bought = true; bought;) {
        bought = false;
        for (const n of SKILL_NODES) {
          const r = buyNode(s, c, n.id);
          if (r.ok) {
            s = r.state;
            bought = true;
          }
        }
      }
      return s;
    };
    expect(webPointCost()).toBe(152);
    const all = buyAll(152);
    expect(all.bought).toHaveLength(SKILL_NODES.length);
    expect(pointsOf(all, 50)).toEqual({ fromLevels: 50, granted: 102, earned: 152, spent: 152, available: 0 });
    expect(skillStateProblem(all)).toBeNull();
    const short = buyAll(151);
    expect(short.bought.length).toBeLessThan(SKILL_NODES.length);
    expect(pointsOf(short, 50).available).toBeLessThan(Math.min(...SKILL_NODES.filter((n) => !short.bought.includes(n.id)).map((n) => n.pointCost)));
  });

  it('tells the web screen how each node stands', () => {
    let s = frozen(ok(grantFragments(newSkillState('thalune'), 'gravitic', 1)).state);
    const c = ctx(1);
    expect(nodeStatus(s, c, 'second_lung')).toBe('buyable');
    expect(nodeStatus(s, c, 'pull')).toBe('unlockable');
    expect(nodeStatus(s, c, 'slam')).toBe('locked');
    expect(nodeStatus(s, c, 'pack_mule')).toBe('locked');
    s = frozen(ok(buyNode(s, c, 'second_lung')).state);
    expect(nodeStatus(s, c, 'second_lung')).toBe('owned');
    s = frozen(ok(unlockWithFragments(s, c, 'pull')).state);
    // unlocked, but level 1's one point is spent
    expect(nodeStatus(s, c, 'pull')).toBe('unlocked');
  });
});

describe('the bars', () => {
  const s = owning(['pull', 'heavy_footing', 'tractor_beam', 'slam', 'well', 'pull_many', 'inertial_brake', 'lance', 'chain']);

  it('slot owned actives on their own bar: ground actives on the ground, ship forms on the ship', () => {
    const c = ctx(50, { shipSlots: 2 });
    let next = ok(slotNode(s, c, 'ground', 0, 'pull')).state;
    next = ok(slotNode(frozen(next), c, 'ship', 1, 'tractor_beam')).state;
    expect(next.slots).toEqual({ ground: ['pull', null, null, null, null, null], ship: [null, 'tractor_beam', null, null, null] });
    expect(code(slotNode(s, c, 'ground', 0, 'anchor'))).toBe('not_owned');
    expect(code(slotNode(s, c, 'ground', 0, 'heavy_footing'))).toBe('not_slottable');
    expect(code(slotNode(s, c, 'ground', 0, 'pull_many'))).toBe('not_slottable');
    expect(code(slotNode(s, c, 'ground', 0, 'tractor_beam'))).toBe('wrong_bar');
    expect(code(slotNode(s, c, 'ship', 0, 'pull'))).toBe('wrong_bar');
    expect(code(slotNode(s, c, 'ground', 0, 'nothing'))).toBe('unknown_node');
  });

  it('have six ground slots and as many working ship slots as the flown hull has ability slots', () => {
    expect(ok(slotNode(s, ctx(), 'ground', 5, 'lance')).state.slots.ground[5]).toBe('lance');
    expect(code(slotNode(s, ctx(), 'ground', 6, 'lance'))).toBe('bad_slot');
    expect(code(slotNode(s, ctx(), 'ground', -1, 'lance'))).toBe('bad_slot');
    // a Lark works two ship slots, a Wayfarer four; with no ship, none
    expect(code(slotNode(s, ctx(50, { shipSlots: 2 }), 'ship', 2, 'tractor_beam'))).toBe('bad_slot');
    expect(ok(slotNode(s, ctx(50, { shipSlots: 4 }), 'ship', 3, 'tractor_beam')).ok).toBe(true);
    expect(code(slotNode(s, ctx(50, { shipSlots: 0 }), 'ship', 0, 'tractor_beam'))).toBe('bad_slot');
    expect(usableSlots(ctx(50, { shipSlots: 9 }), 'ship')).toBe(5);
    expect(usableSlots(ctx(50, { shipSlots: 3 }), 'ground')).toBe(6);
  });

  it('move a node already on the bar, swapping it with what is there, and replace anything else', () => {
    let b = frozen(ok(slotNode(s, ctx(), 'ground', 0, 'pull')).state);
    b = frozen(ok(slotNode(b, ctx(), 'ground', 1, 'slam')).state);
    expect(ok(slotNode(b, ctx(), 'ground', 1, 'pull')).state.slots.ground.slice(0, 2)).toEqual(['slam', 'pull']);
    expect(ok(slotNode(b, ctx(), 'ground', 3, 'pull')).state.slots.ground.slice(0, 4)).toEqual([null, 'slam', null, 'pull']);
    expect(ok(slotNode(b, ctx(), 'ground', 0, 'well')).state.slots.ground.slice(0, 2)).toEqual(['well', 'slam']);
    expect(ok(slotNode(b, ctx(), 'ground', 0, 'pull')).state).toBe(b);
  });

  it('unslot any slot of the bar, a ship slot the hull does not work included', () => {
    const b = frozen(ok(slotNode(s, ctx(50, { shipSlots: 4 }), 'ship', 3, 'inertial_brake')).state);
    const r = ok(unslotNode(b, 'ship', 3));
    expect(r.node).toBe('inertial_brake');
    expect(r.state.slots.ship).toEqual([null, null, null, null, null]);
    expect(code(unslotNode(b, 'ship', 2))).toBe('empty_slot');
    expect(code(unslotNode(b, 'ship', 5))).toBe('bad_slot');
    expect(code(unslotNode(b, 'ground', 6))).toBe('bad_slot');
  });
});

describe('respec', () => {
  const s = owning(['pull', 'heavy_footing', 'slam', 'pull_many', 'anchor', 'singularity', 'phase']);
  const slotted = frozen(ok(slotNode(s, ctx(), 'ground', 2, 'slam')).state);

  it('refunds owned nodes for 500 units a point at a Chorus listener, and takes them off the bars', () => {
    const r = ok(respecNodes(slotted, ['slam', 'anchor', 'singularity']));
    expect(r).toMatchObject({ points: 5, units: 2500, trainers: ['chorus_listener'] });
    expect(r.state.bought).toEqual(['pull', 'heavy_footing', 'pull_many', 'phase']);
    expect(r.state.slots.ground).toEqual(Array(6).fill(null));
    // unlocks stay unlocked; the points come back
    expect(r.state.unlocked).toEqual(slotted.unlocked);
    expect(pointsOf(r.state, 50).available - pointsOf(slotted, 50).available).toBe(5);
    expect(respecCost(['singularity'])).toBe(SKILL_RULES.respec.unitsPerPoint * 3);
  });

  it('refunds Void nodes only at a Free Reaches quartermaster', () => {
    expect(ok(respecNodes(s, ['phase'])).trainers).toEqual(['reaches_quartermaster']);
    expect(ok(respecNodes(s, ['phase', 'pull_many'])).trainers.sort()).toEqual(['chorus_listener', 'reaches_quartermaster']);
  });

  it('keeps every node it leaves with its prerequisites', () => {
    // Slam needs a Tier I gravitic node: Heavy Footing still is one, so Pull may go only with Pull Many
    expect(respecNodes(s, ['pull'])).toMatchObject({ ok: false, error: { code: 'needed', message: /Pull Many would be left without Pull/ } });
    expect(ok(respecNodes(s, ['pull', 'pull_many'])).state.bought).toEqual(['heavy_footing', 'slam', 'anchor', 'singularity', 'phase']);
    expect(code(respecNodes(s, ['pull', 'pull_many', 'heavy_footing']))).toBe('needed');
    expect(code(respecNodes(s, ['anchor']))).toBe('needed');
  });

  it('refuses nodes not owned, unknown or named twice, and an empty list', () => {
    expect(code(respecNodes(s, ['lance']))).toBe('not_owned');
    expect(code(respecNodes(s, ['nope']))).toBe('unknown_node');
    expect(code(respecNodes(s, ['singularity', 'singularity']))).toBe('duplicate');
    expect(code(respecNodes(s, []))).toBe('invalid_op');
  });
});

describe('requests', () => {
  it('parse untrusted input and apply the same rules the server does', () => {
    expect(parseSkillOp({ op: 'buy', node: 'pull' })).toEqual({ ok: true, op: { op: 'buy', node: 'pull' } });
    for (const bad of [null, { op: 'grant', points: 9 }, { op: 'buy' }, { op: 'buy', node: 'Pull' }, { op: 'slot', bar: 'ground', index: 6, node: 'pull' }])
      expect(code(parseSkillOp(bad) as SkillResult)).toBe('invalid_op');
    let s = frozen(ok(grantFragments(newSkillState('thalune'), 'gravitic', 1)).state);
    const c = ctx(3);
    s = frozen(ok(applySkillOp(s, c, { op: 'unlock', node: 'pull' })).state);
    s = frozen(ok(applySkillOp(s, c, { op: 'buy', node: 'pull' })).state);
    s = frozen(ok(applySkillOp(s, c, { op: 'slot', bar: 'ground', index: 0, node: 'pull' })).state);
    expect(s.slots.ground[0]).toBe('pull');
    s = frozen(ok(applySkillOp(s, c, { op: 'unslot', bar: 'ground', index: 0 })).state);
    expect(ok(applySkillOp(s, c, { op: 'respec', nodes: ['pull'] })).state.bought).toEqual([]);
  });

  it('predict from the view the server sends', () => {
    const view = { state: emptySkillState(), level: 16, shipSlots: 3, met: [REACHES] };
    const c = contextOf(view);
    expect(c.level).toBe(16);
    expect(c.shipSlots).toBe(3);
    expect(c.meets(REACHES)).toBe(true);
    expect(c.meets({ kind: 'faction_rank', faction: 'reaches', rank: 'cutter' })).toBe(false);
    expect(contextOf({ ...view, met: [] }).meets(REACHES)).toBe(false);
  });
});
