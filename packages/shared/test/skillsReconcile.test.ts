// Skills stored under an older skill web (P1.E07.T15): a fixture web renames, re-tiers and removes nodes, moves one to the
// other bar and resizes the bars, and a state stored under it is reconciled with the new one: unknown ids dropped with the
// fragments their unlocks paid given back, owned nodes that lost a prerequisite refunded deepest first, the bars resized.
// Only structure and a newer web are refused. The component's v1 states gain a web and a record of what unlocks paid.
import { describe, expect, it } from 'vitest';
import { SKILL_NODES, type Branch, type SkillNode } from '../src/data/index.ts';
import {
  BAR_SLOTS,
  emptySkillState,
  migrateSkillsV1,
  pointsOf,
  reconcileSkills,
  SKILL_WEB,
  SKILL_WEB_VERSION,
  skillStateOf,
  skillStateSchema,
  skillWeb,
  storedSkills,
  storedSkillsProblem,
  storedSkillsSchema,
  type Bar,
  type SkillReconcileChange,
  type SkillWeb,
  type StoredSkills,
  type UnlocksPaid,
} from '../src/skills/index.ts';

/** A node of a fixture web: Gravitic unless said, needing a node of the tier below in its branch, and an augment its target. */
function node(id: string, tier: SkillNode['tier'], opts: { branch?: Branch; slot?: Bar | null; augments?: string } = {}): SkillNode {
  const branch = opts.branch ?? 'gravitic';
  const below = tier === 'capstone' ? 3 : tier === 'conjunction' ? 2 : tier - 1;
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1).replace(/_/g, ' '),
    branch,
    tier,
    type: opts.augments ? 'augment' : opts.slot === 'ship' ? 'ship' : opts.slot ? 'active' : 'passive',
    slot: opts.slot ?? null,
    pointCost: tier === 'capstone' ? 3 : 1,
    level: 1,
    prereq: { tiers: below ? [{ branch, tier: below as 1 | 2 | 3 }] : [], nodes: opts.augments ? [opts.augments] : [] },
    augments: opts.augments ?? null,
    unlock: { anyOf: [{ kind: 'trainer', trainer: 'city_master', rank: null }], allOf: [] },
    text: id,
    cost: null,
    cooldown: null,
    params: {},
    mods: [],
    flags: [],
    refs: [],
  };
}

const OLD_NODES: SkillNode[] = [
  node('pull', 1, { slot: 'ground' }),
  node('brace', 1),
  node('tug', 1, { slot: 'ship' }),
  node('slam', 2, { slot: 'ground' }),
  node('well', 2, { slot: 'ground' }),
  node('pull_many', 2, { augments: 'pull' }),
  node('anchor', 3, { slot: 'ground' }),
  node('aftershock', 3, { augments: 'slam' }),
  node('singularity', 'capstone', { slot: 'ground' }),
  node('throttle', 1, { branch: 'pilot' }),
];
const OLD = skillWeb(1, OLD_NODES, { ground: 6, ship: 5 });

/** The old web with `change` made to it, as version 2. */
function changed(change: (nodes: SkillNode[]) => SkillNode[], slots: Record<Bar, number> = { ground: 6, ship: 5 }): SkillWeb {
  return skillWeb(2, change(OLD_NODES.map((n) => JSON.parse(JSON.stringify(n)) as SkillNode)), slots);
}

/** A state stored under the old web: `owned` unlocked and bought (with `unlocked` unlocked only), each paid as `paid` says. */
function stored(p: { owned?: string[]; unlocked?: string[]; paid?: UnlocksPaid; ground?: (string | null)[]; ship?: (string | null)[] } = {}): StoredSkills {
  const owned = p.owned ?? [];
  const paid = p.paid ?? {};
  const spent = Object.values(paid).reduce((sum, x) => sum + (x.branch === 'gravitic' ? x.count : 0), 0);
  const empty = emptySkillState();
  const s: StoredSkills = {
    web: 1,
    ...empty,
    granted: 20,
    unlocked: [...owned, ...(p.unlocked ?? [])],
    bought: owned,
    fragments: { ...empty.fragments, gravitic: { earned: spent + 2, spent } },
    slots: { ground: p.ground ?? Array(6).fill(null), ship: p.ship ?? Array(5).fill(null) },
    paid,
  };
  // what the test starts from is a state the old web accepts
  expect(storedSkillsSchema.parse(s)).toEqual(s);
  expect(storedSkillsProblem(s, OLD)).toBeNull();
  return s;
}

/** Reconciles with `web` and checks the result is a value that web accepts. */
function reconciled(s: StoredSkills, web: SkillWeb) {
  const r = reconcileSkills(s, web);
  expect(storedSkillsSchema.parse(r.stored)).toEqual(r.stored);
  expect(storedSkillsProblem(r.stored, web)).toBeNull();
  return r;
}

const refunds = (changes: SkillReconcileChange[]) => changes.filter((c) => c.change === 'refunded').map((c) => c.node);

const g = (count: number) => ({ branch: 'gravitic' as const, count });

describe('reconciling stored skills with the web', () => {
  it('drops a renamed node’s old id, gives back what its unlock paid, and refunds what needed it, keeping the rest', () => {
    // Pull is renamed Yank: a new id. Pull Many augments it, so it now needs Yank, which this character does not own; Slam
    // still has Brace for its Tier I, and Anchor still has Slam
    const web = changed((nodes) =>
      nodes.map((n) =>
        n.id === 'pull' ? { ...n, id: 'yank', name: 'Yank' } : n.id === 'pull_many' ? { ...n, prereq: { ...n.prereq, nodes: ['yank'] }, augments: 'yank' } : n,
      ),
    );
    const s = stored({
      owned: ['pull', 'brace', 'slam', 'pull_many', 'anchor'],
      paid: { pull: g(1), slam: g(3), anchor: g(6) },
      ground: ['pull', 'slam', null, 'anchor', null, null],
    });
    const { stored: out, changes } = reconciled(s, web);
    expect(changes).toEqual([
      { change: 'removed', node: 'pull', owned: true, fragments: g(1) },
      { change: 'refunded', node: 'pull_many', missing: ['Yank'] },
    ]);
    expect(out.unlocked).toEqual(['brace', 'slam', 'pull_many', 'anchor']);
    expect(out.bought).toEqual(['brace', 'slam', 'anchor']);
    expect(out.slots.ground).toEqual([null, 'slam', null, 'anchor', null, null]);
    // Pull's one fragment back; the rest stay paid, Pull Many stays unlocked
    expect(out.fragments.gravitic).toEqual({ earned: 12, spent: 9 });
    expect(out.paid).toEqual({ slam: g(3), anchor: g(6) });
    expect(out.web).toBe(2);
    // the points come back with the nodes: they are counted from what is owned
    expect(pointsOf(skillStateOf(s), 1).spent - pointsOf(skillStateOf(out), 1).spent).toBe(2);
    // a name changed under the same id changes nothing but the web
    const renamed = reconciled(
      s,
      changed((nodes) => nodes.map((n) => (n.id === 'pull' ? { ...n, name: 'Yank' } : n))),
    );
    expect(renamed.changes).toEqual([]);
    expect(renamed.stored).toEqual({ ...s, web: 2 });
  });

  it('refunds, deepest first, every node a removed node held up, down the whole chain', () => {
    // Pull goes: no Tier I is left, so Slam and Pull Many go, then the Tier IIIs, then the capstone
    const web = changed((nodes) => nodes.filter((n) => n.id !== 'pull').map((n) => (n.id === 'pull_many' ? { ...n, prereq: { ...n.prereq, nodes: [] } } : n)));
    const s = stored({
      owned: ['pull', 'slam', 'pull_many', 'anchor', 'aftershock', 'singularity', 'throttle'],
      paid: { pull: g(1), slam: g(3), anchor: g(6) },
      ground: ['singularity', 'pull', 'slam', 'anchor', null, null],
    });
    const { stored: out, changes } = reconciled(s, web);
    expect(changes[0]).toEqual({ change: 'removed', node: 'pull', owned: true, fragments: g(1) });
    // the capstone, the Tier IIIs (the later bought first), the Tier IIs (likewise): the order a respec could refund them
    expect(refunds(changes)).toEqual(['singularity', 'aftershock', 'anchor', 'pull_many', 'slam']);
    expect(changes.find((c) => c.change === 'refunded' && c.node === 'anchor')).toEqual({
      change: 'refunded',
      node: 'anchor',
      missing: ['a Tier II gravitic node'],
    });
    expect(changes).toHaveLength(6);
    expect(out.bought).toEqual(['throttle']);
    expect(out.unlocked).toEqual(['slam', 'pull_many', 'anchor', 'aftershock', 'singularity', 'throttle']);
    expect(out.slots.ground).toEqual(Array(6).fill(null));
    expect(out.fragments.gravitic).toEqual({ earned: 12, spent: 9 });
  });

  it('removes nodes unlocked any way: only fragment unlocks give fragments back, and an unowned unlock goes too', () => {
    const web = changed((nodes) => nodes.filter((n) => n.id !== 'tug' && n.id !== 'well'));
    // Tug was unlocked with fragments and slotted; Well came from a trainer and was never bought
    const s = stored({ owned: ['pull', 'tug'], unlocked: ['well'], paid: { tug: g(1) }, ship: ['tug', null, null, null, null] });
    const { stored: out, changes } = reconciled(s, web);
    expect(changes).toEqual([
      { change: 'removed', node: 'tug', owned: true, fragments: g(1) },
      { change: 'removed', node: 'well', owned: false, fragments: null },
    ]);
    expect(out.unlocked).toEqual(['pull']);
    expect(out.slots.ship).toEqual(Array(5).fill(null));
    expect(out.fragments.gravitic).toEqual({ earned: 3, spent: 0 });
    expect(out.paid).toEqual({});
  });

  it('re-tiers: a node that moved keeps what it paid; a node left without the tier below is refunded, deepest first', () => {
    // Anchor drops to Tier II: it now needs a Tier I, which Brace is; nothing changes but the web. What it paid at Tier III
    // stays paid.
    const down = changed((nodes) =>
      nodes.map((n) =>
        n.id === 'anchor' ? { ...n, tier: 2 as const, prereq: { ...n.prereq, tiers: [{ branch: 'gravitic' as const, tier: 1 as const }] } } : n,
      ),
    );
    const s = stored({ owned: ['brace', 'slam', 'anchor'], paid: { slam: g(3), anchor: g(6) } });
    const kept = reconciled(s, down);
    expect(kept.changes).toEqual([]);
    expect(kept.stored).toEqual({ ...s, web: 2 });

    // Brace rises to Tier II: no Tier I is left, so Brace and Slam go; then Anchor, whose Tier II held it up
    const up = changed((nodes) =>
      nodes.map((n) =>
        n.id === 'brace' ? { ...n, tier: 2 as const, prereq: { ...n.prereq, tiers: [{ branch: 'gravitic' as const, tier: 1 as const }] } } : n,
      ),
    );
    const r = reconciled(s, up);
    expect(refunds(r.changes)).toEqual(['anchor', 'slam', 'brace']);
    expect(r.stored.bought).toEqual([]);
    expect(r.stored.unlocked).toEqual(['brace', 'slam', 'anchor']);
    expect(r.stored.paid).toEqual({ slam: g(3), anchor: g(6) });
    expect(r.stored.fragments).toEqual(s.fragments);
  });

  it('resizes the bars to the hulls’ and takes off a node past a bar’s end or on a bar it no longer goes on', () => {
    // a roomier ground bar, a hull with five ability slots gone, and Well now a ship form
    const web = changed((nodes) => nodes.map((n) => (n.id === 'well' ? { ...n, type: 'ship' as const, slot: 'ship' as const } : n)), { ground: 7, ship: 4 });
    const s = stored({ owned: ['pull', 'tug', 'well'], ground: ['pull', 'well', null, null, null, null], ship: [null, null, null, null, 'tug'] });
    const { stored: out, changes } = reconciled(s, web);
    expect(changes).toEqual([
      { change: 'unslotted', node: 'well', bar: 'ground' },
      { change: 'resized', bar: 'ground', from: 6, to: 7 },
      { change: 'unslotted', node: 'tug', bar: 'ship' },
      { change: 'resized', bar: 'ship', from: 5, to: 4 },
    ]);
    expect(out.slots).toEqual({ ground: ['pull', null, null, null, null, null, null], ship: [null, null, null, null] });
    // still owned, only off the bar
    expect(out.bought).toEqual(['pull', 'tug', 'well']);
    // a node on its bar within the new size keeps its slot
    const kept = reconciled(stored({ owned: ['tug'], ship: [null, 'tug', null, null, null] }), web);
    expect(kept.stored.slots.ship).toEqual([null, 'tug', null, null]);
    expect(kept.changes).toEqual([
      { change: 'resized', bar: 'ground', from: 6, to: 7 },
      { change: 'resized', bar: 'ship', from: 5, to: 4 },
    ]);
  });

  it('gives back a value already in line as it is, stamps an older web’s, and never touches a newer web’s', () => {
    const s = stored({ owned: ['pull', 'slam'], paid: { pull: g(1) } });
    expect(reconcileSkills(s, OLD)).toEqual({ stored: s, changes: [] });
    expect(reconcileSkills(s, OLD).stored).toBe(s);
    const same = changed((nodes) => nodes);
    expect(reconciled(s, same)).toEqual({ stored: { ...s, web: 2 }, changes: [] });
    // stored by a server with a newer web: this one does not know its nodes, so it must not strip them, and refuses it
    const newer = { ...s, unlocked: [...s.unlocked, 'warp'], web: 3 };
    expect(reconcileSkills(newer, same)).toEqual({ stored: newer, changes: [] });
    expect(storedSkillsProblem(newer, same)).toMatch(/newer server/);
    expect(storedSkillsProblem({ ...s, web: 1 }, same)).toMatch(/not reconciled/);
  });

  it('refuses only what no web explains: repeated, unowned or unpaid-for nodes, overspent ledgers, a bad shape', () => {
    const s = stored({ owned: ['pull', 'tug'], paid: { pull: g(1) }, ground: ['pull', null, null, null, null, null] });
    const bad: unknown[] = [
      { ...s, bought: ['pull', 'pull'] },
      { ...s, bought: [...s.bought, 'slam'] },
      { ...s, slots: { ...s.slots, ground: ['slam', null] } },
      { ...s, slots: { ...s.slots, ground: ['pull', 'pull'] } },
      { ...s, paid: { ...s.paid, slam: g(3) } },
      { ...s, paid: { pull: g(5) } },
      { ...s, fragments: { ...s.fragments, gravitic: { earned: 0, spent: 1 } } },
      { ...s, web: -1 },
      { ...s, paid: undefined },
      skillStateOf(s),
      { ...s, slots: { ground: Array(17).fill(null), ship: [] } },
    ];
    for (const b of bad) expect(storedSkillsSchema.safeParse(b).success, JSON.stringify(b).slice(0, 120)).toBe(false);
    // what a web change explains is the reconcile's, not the schema's: unknown ids, any bar size, a node on the other bar
    const odd = { ...s, unlocked: [...s.unlocked, 'warp'], slots: { ground: ['tug'], ship: [] } };
    expect(storedSkillsSchema.safeParse(odd).success).toBe(true);
    expect(skillStateSchema.safeParse(skillStateOf(odd)).success).toBe(false);
  });

  it('stores a state for this build’s web, and reads the state back out of it', () => {
    const state = emptySkillState();
    const s = storedSkills(state, { pull: g(1) });
    expect(s).toEqual({ web: SKILL_WEB_VERSION, ...state, paid: { pull: g(1) } });
    expect(skillStateOf(s)).toEqual(state);
    expect(SKILL_WEB.slots).toEqual(BAR_SLOTS);
    expect(SKILL_WEB.node('pull')?.id).toBe('pull');
  });
});

describe('the skills component’s v1 values', () => {
  it('are stored under web 0 and credited what their ledger says their fragment unlocks paid, never more than was spent', () => {
    const v1 = {
      ...emptySkillState(),
      // Second Lung came with the people, Pull and Slam took 4 gravitic fragments, Long Ear 1 resonance; Well was taught
      unlocked: ['second_lung', 'pull', 'well', 'slam', 'long_ear', 'cartridge_recycler'],
      fragments: { ...emptySkillState().fragments, gravitic: { earned: 9, spent: 4 }, resonance: { earned: 1, spent: 1 } },
    };
    const out = migrateSkillsV1(v1) as StoredSkills;
    expect(out).toEqual({ web: 0, ...v1, paid: { pull: g(1), well: g(3), long_ear: { branch: 'resonance', count: 1 } } });
    // Well is credited Slam's three (both Tier II gravitic): the branch's total is right, and never above what was spent
    expect(storedSkillsSchema.parse(out)).toEqual(out);
    // the reconcile then stamps it with this web, changing nothing else
    expect(reconcileSkills(out)).toEqual({ stored: { ...out, web: SKILL_WEB_VERSION }, changes: [] });
    // a value that is not one is left for the schema to refuse
    for (const junk of ['everything', null, [1, 2], 7]) expect(migrateSkillsV1(junk)).toBe(junk);
    expect(storedSkillsSchema.safeParse(migrateSkillsV1({ unlocked: 'pull' })).success).toBe(false);
  });

  it('credit a people’s free node last, so it never takes another unlock’s payment and a removal mints nothing', () => {
    const symbiotic = (spent: number) => ({ ...emptySkillState().fragments, symbiotic: { earned: 2, spent } });
    // Thalune's Second Lung came free, first in the list; the one symbiotic fragment spent bought Bond
    const thalune = migrateSkillsV1({ ...emptySkillState(), unlocked: ['second_lung', 'bond'], fragments: symbiotic(1) }) as StoredSkills;
    expect(thalune.paid).toEqual({ bond: { branch: 'symbiotic', count: 1 } });
    // Second Lung leaves the web: nothing comes back for it, and Bond keeps its payment
    const without = skillWeb(
      SKILL_WEB_VERSION + 1,
      SKILL_NODES.filter((n) => n.id !== 'second_lung'),
    );
    const r = reconcileSkills(thalune, without);
    expect(r.changes).toEqual([{ change: 'removed', node: 'second_lung', owned: false, fragments: null }]);
    expect(r.stored.fragments.symbiotic).toEqual({ earned: 2, spent: 1 });
    expect(r.stored.paid).toEqual({ bond: { branch: 'symbiotic', count: 1 } });
    // Ixari's Pulse likewise; Long Ear took the resonance fragment
    const ixari = migrateSkillsV1({
      ...emptySkillState(),
      unlocked: ['pulse', 'long_ear'],
      fragments: { ...emptySkillState().fragments, resonance: { earned: 1, spent: 1 } },
    }) as StoredSkills;
    expect(ixari.paid).toEqual({ long_ear: { branch: 'resonance', count: 1 } });
    // what the others leave, a people's node may still have paid (another people unlocked it with a fragment)
    const both = migrateSkillsV1({ ...emptySkillState(), unlocked: ['second_lung', 'bond'], fragments: symbiotic(2) }) as StoredSkills;
    expect(both.paid).toEqual({ bond: { branch: 'symbiotic', count: 1 }, second_lung: { branch: 'symbiotic', count: 1 } });
  });
});

/** What a stored state reads of the web, as a short hash: ids, branches, tiers, bars, prerequisites, and the bars' sizes. */
function webFingerprint(nodes: readonly SkillNode[], slots: Readonly<Record<Bar, number>>): string {
  const rows = nodes
    .map((n) => [n.id, n.branch, n.tier, n.slot, n.prereq.tiers.map((t) => `${t.branch}${t.tier}`).join('+'), n.prereq.nodes.join('+')].join(':'))
    .sort();
  const text = [...rows, `ground:${slots.ground}`, `ship:${slots.ship}`].join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** The fingerprint of each web version: a new version adds its own. */
const WEB_FINGERPRINTS: Record<number, string> = { 1: 'd5cffe36' };

describe('the skill web’s version', () => {
  it('names the web as it is: a change a stored state reads raises SKILL_WEB_VERSION', () => {
    // When this fails, the web changed in a way stored states read (an id, a branch, a tier, a bar, a prerequisite, a bar's
    // size): raise SKILL_WEB_VERSION in packages/shared/src/skills/schema.ts and add the new fingerprint above, so a server
    // rolled back refuses the states this one writes instead of stripping nodes it does not know.
    expect(webFingerprint(SKILL_NODES, BAR_SLOTS), `skill web ${SKILL_WEB_VERSION}`).toBe(WEB_FINGERPRINTS[SKILL_WEB_VERSION]);
    // the hash sees each thing it covers
    const base = webFingerprint(SKILL_NODES, BAR_SLOTS);
    const edits: ((n: SkillNode) => SkillNode)[] = [
      (n) => ({ ...n, id: `${n.id}_x` }),
      (n) => ({ ...n, tier: 2 }),
      (n) => ({ ...n, slot: 'ship' }),
      (n) => ({ ...n, branch: 'thermal' }),
      (n) => ({ ...n, prereq: { ...n.prereq, nodes: ['slam'] } }),
    ];
    for (const edit of edits) expect(webFingerprint([edit(SKILL_NODES[0]!), ...SKILL_NODES.slice(1)], BAR_SLOTS)).not.toBe(base);
    expect(webFingerprint(SKILL_NODES, { ...BAR_SLOTS, ship: 4 })).not.toBe(base);
    expect(webFingerprint([{ ...SKILL_NODES[0]!, text: 'reworded' }, ...SKILL_NODES.slice(1)], BAR_SLOTS)).toBe(base);
  });
});
