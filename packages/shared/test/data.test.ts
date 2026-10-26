// The data suite (P1.E02.T07): every table parses with its schema, counts match DESIGN's tables, ids are unique, and every
// cross-reference resolves. Where DESIGN.md has a table, the suite also reads it and compares, so the doc stays true.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BODY_PLANS,
  BOSSES,
  BRANCHES,
  COMBAT,
  CONDITIONS,
  DENSITY,
  FABRICATORS,
  FACTION_RULES,
  FACTIONS,
  FAUNA_SPAWNING,
  FRAGMENT_WORLDS,
  HULLS,
  ITEMS,
  METERS,
  MOBS,
  PEOPLES,
  RECIPES,
  RESOURCES,
  SKILL_NODES,
  SKILL_RULES,
  TEMPERAMENTS,
  TRAINERS,
  WEAPON_SIZES,
  WEAPONS,
  WORLD_TYPES,
  bodyPlanSchema,
  bossSchema,
  branchOf,
  conditionSchema,
  densitySchema,
  fabricatorSchema,
  factionSchema,
  getHull,
  getResource,
  getSkillNode,
  hullSchema,
  itemSchema,
  metersSchema,
  mobSchema,
  peopleSchema,
  rankAt,
  recipeSchema,
  resourceSchema,
  salvageYield,
  scaleByLevel,
  skillNodeSchema,
  skillRulesSchema,
  temperamentSchema,
  trainerSchema,
  webPointCost,
  weaponSchema,
} from '../src/data/index.ts';
import type { SkillNode, StatMod } from '../src/data/index.ts';
// Read as text through Vite's ?raw import, so the shared package's tests need no Node types.
import DESIGN from '../../../docs/DESIGN.md?raw';

/** The rows of the first markdown table under a heading, as trimmed cells, without the header and separator. */
function designTable(heading: string): string[][] {
  const lines = DESIGN.split('\n');
  const start = lines.findIndex((l) => l.startsWith('#') && l.includes(heading));
  if (start < 0) throw new Error(`DESIGN.md has no heading ${heading}`);
  const rows: string[][] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    if (line.startsWith('|')) {
      inTable = true;
      rows.push(
        line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim()),
      );
    } else if (inTable) break;
  }
  return rows.slice(2);
}

const ids = <T extends { id: string }>(rows: readonly T[]) => new Set(rows.map((r) => r.id));
const RESOURCE_IDS = ids(RESOURCES);
const ITEM_IDS = ids(ITEMS);
const NODE_IDS = ids(SKILL_NODES);
const WEAPON_IDS = ids(WEAPONS);
const HULL_IDS = ids(HULLS);
const MOB_IDS = ids(MOBS);
const BOSS_IDS = ids(BOSSES);
const TEMPERAMENT_IDS = ids(TEMPERAMENTS);
const RECIPE_IDS = ids(RECIPES);
const CONDITION_IDS = ids(CONDITIONS);
const TRAINER_IDS = ids(TRAINERS);

const tierNumber = { 1: 'I', 2: 'II', 3: 'III', capstone: 'cap' } as const;

function checkMods(mods: readonly StatMod[], where: string) {
  for (const m of mods) {
    if (m.when) expect(CONDITION_IDS.has(m.when), `${where}: condition ${m.when}`).toBe(true);
    for (const n of m.nodes ?? []) expect(NODE_IDS.has(n), `${where}: node ${n}`).toBe(true);
  }
}

describe('every table parses with its schema', () => {
  const cases: [string, z.ZodType, unknown][] = [
    ['resources', z.array(resourceSchema), RESOURCES],
    ['items', z.array(itemSchema), ITEMS],
    ['weapons', z.array(weaponSchema), WEAPONS],
    ['hulls', z.array(hullSchema), HULLS],
    ['meters', metersSchema, METERS],
    ['conditions', z.array(conditionSchema), CONDITIONS],
    ['trainers', z.array(trainerSchema), TRAINERS],
    ['factions', z.array(factionSchema), FACTIONS],
    ['peoples', z.array(peopleSchema), PEOPLES],
    ['skill nodes', z.array(skillNodeSchema), SKILL_NODES],
    ['skill rules', skillRulesSchema, SKILL_RULES],
    ['recipes', z.array(recipeSchema), RECIPES],
    ['fabricators', z.array(fabricatorSchema), FABRICATORS],
    ['body plans', z.array(bodyPlanSchema), BODY_PLANS],
    ['temperaments', z.array(temperamentSchema), TEMPERAMENTS],
    ['mobs', z.array(mobSchema), MOBS],
    ['density', z.array(densitySchema), DENSITY],
    ['bosses', z.array(bossSchema), BOSSES],
  ];
  it.each(cases)('%s', (_name, schema, rows) => {
    const result = schema.safeParse(rows);
    expect(result.success ? 'ok' : z.prettifyError(result.error)).toBe('ok');
  });

  it('ids are unique in every table', () => {
    const tables: (readonly { id: string }[])[] = [
      RESOURCES,
      ITEMS,
      WEAPONS,
      HULLS,
      CONDITIONS,
      TRAINERS,
      FACTIONS,
      PEOPLES,
      SKILL_NODES,
      RECIPES,
      FABRICATORS,
      BODY_PLANS,
      TEMPERAMENTS,
      MOBS,
      BOSSES,
    ];
    for (const rows of tables) expect(ids(rows).size).toBe(rows.length);
    for (const f of FACTIONS) expect(ids(f.ranks).size).toBe(3);
    const variants = BOSSES.flatMap((b) => b.variants.map((v) => v.id));
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('tables are frozen and lookups throw on unknown ids', () => {
    expect(Object.isFrozen(SKILL_NODES)).toBe(true);
    expect(Object.isFrozen(SKILL_NODES[0].unlock.anyOf)).toBe(true);
    expect(Object.isFrozen(METERS.heat.worldModifiers)).toBe(true);
    expect(getResource('dihydrogen').basePrice).toBe(34);
    expect(getHull('lark').hull).toBe(100);
    expect(() => getSkillNode('no_such_node')).toThrow(/skill node/);
  });
});

describe('resources', () => {
  it('19 resources, matching DESIGN 15.3', () => {
    expect(RESOURCES).toHaveLength(19);
    const rows = designTable('15.3 Resources');
    expect(rows).toHaveLength(19);
    rows.forEach(([name, tier, , base], i) => {
      const r = RESOURCES[i];
      expect(r.name).toBe(name);
      expect(r.basePrice).toBe(Number(base.replace(',', '')));
      const [min, max] = tier.endsWith('+')
        ? [Number(tier.slice(0, -1)), 5]
        : tier
            .split('–')
            .map(Number)
            .concat(Number(tier.split('–').at(-1)));
      expect([r.tier.min, r.tier.max]).toEqual([min, max]);
    });
  });

  it("the demo's nine keep the inventory's ids and prices", () => {
    const demo = { carbon: 12, ferrite: 14, sodium: 41, oxygen: 34, dihydrogen: 34, copper: 110, cobalt: 198, tritium: 6, gold: 202 };
    expect(
      RESOURCES.filter((r) => r.demo)
        .map((r) => r.id)
        .sort(),
    ).toEqual(Object.keys(demo).sort());
    for (const [id, price] of Object.entries(demo)) expect(getResource(id).basePrice).toBe(price);
  });
});

describe('weapons and items', () => {
  it('8 weapons, matching DESIGN 10.3', () => {
    expect(WEAPONS).toHaveLength(8);
    const rows = designTable('10.3 Weapons');
    expect(rows.map(([name, size]) => [name, size])).toEqual(WEAPONS.map((w) => [w.name, w.size]));
  });

  it('every weapon has its module item, every module points at a weapon, every ammo item exists', () => {
    for (const w of WEAPONS) {
      const item = ITEMS.find((i) => i.id === w.id);
      expect(item?.kind, w.id).toBe('module');
      expect(item?.weapon).toBe(w.id);
      if (w.ammo.kind === 'item') expect(ITEMS.find((i) => i.id === (w.ammo.kind === 'item' ? w.ammo.item : ''))?.kind, w.id).toBe('ammo');
    }
    for (const i of ITEMS) {
      if (i.weapon) expect(WEAPON_IDS.has(i.weapon)).toBe(true);
      checkMods(i.mods ?? [], i.id);
    }
  });

  it('laser-type weapons are the ones Focused Lasers and Plasma Volley reach', () => {
    expect(WEAPONS.filter((w) => w.laser).map((w) => w.id)).toEqual(['pulse_lasers', 'mining_laser', 'beam_lance']);
  });
});

describe('hulls', () => {
  it('13 hulls, matching DESIGN 10.2', () => {
    expect(HULLS).toHaveLength(13);
    const rows = designTable('10.2 Hull roster');
    expect(rows).toHaveLength(13);
    rows.forEach(([name, tier, role, speed, boost, hull, shield, charge, pods, , hardpoints, slots], i) => {
      const h = HULLS[i];
      expect(h.name).toBe(name);
      expect(String(h.tier)).toBe(tier);
      expect(h.role).toBe(role);
      expect(`${h.speed.space}/${h.speed.atmo}`).toBe(speed);
      expect(h.boost).toBe(Number(boost));
      expect(h.hull).toBe(Number(hull));
      expect(h.shield).toBe(Number(shield));
      expect(h.charge === 'count' ? 'from the Count' : String(h.charge)).toBe(charge);
      expect(h.cargoPods).toBe(Number(pods));
      expect(h.abilitySlots).toBe(Number(slots));
      const sizes = hardpoints.split(' ').flatMap((g) => Array<string>(Number(g.slice(0, -1))).fill(g.slice(-1)));
      expect(h.hardpoints).toEqual(sizes);
    });
  });

  it('hardpoint sizes are weapon sizes, and every hull can fit a weapon', () => {
    for (const h of HULLS) {
      for (const s of h.hardpoints) expect(WEAPON_SIZES).toContain(s);
      expect(
        WEAPONS.some((w) => h.hardpoints.includes(w.size)),
        h.id,
      ).toBe(true);
    }
  });

  it('venues, prices and built-ins resolve', () => {
    for (const h of HULLS) {
      for (const n of h.builtIn.nodes) expect(NODE_IDS.has(n), `${h.id}: ${n}`).toBe(true);
      checkMods(h.builtIn.mods, h.id);
      if (h.people) {
        const capital = PEOPLES.find((p) => p.id === h.people)?.capital.id;
        expect(
          h.sold.some((v) => v.kind === 'capital' && v.capital === capital),
          h.id,
        ).toBe(true);
      }
      for (const v of h.sold) if (v.kind === 'craft') expect(RECIPES.find((r) => r.id === v.recipe)?.output).toEqual({ kind: 'hull', hull: h.id });
      if (h.price.rep) {
        const { faction, rank } = h.price.rep;
        const unlocks = FACTIONS.find((f) => f.id === faction)?.ranks.find((r) => r.id === rank)?.unlocks ?? [];
        expect(unlocks, h.id).toContainEqual({ kind: 'hull', hull: h.id });
      }
      // DESIGN 10.2: Tier 0–1 hulls sell at every Waystation
      if (h.tier === 0 || h.tier === 1) expect(h.sold).toContainEqual({ kind: 'waystation' });
    }
  });
});

describe('the skill web', () => {
  it('132 nodes: 7 branches × 18 (3 + 6 + 8 + 1) and 6 conjunctions', () => {
    expect(SKILL_NODES).toHaveLength(7 * 18 + 6);
    for (const b of BRANCHES) {
      const nodes = branchOf(b);
      expect(nodes, b).toHaveLength(18);
      const tiers = [1, 2, 3, 'capstone'].map((t) => nodes.filter((n) => n.tier === t).length);
      expect(tiers, b).toEqual([3, 6, 8, 1]);
    }
    expect(SKILL_NODES.filter((n) => n.branch === 'conjunction')).toHaveLength(6);
  });

  it('owning everything costs 7 × 20 + 6 × 2 = 152 points', () => {
    for (const b of BRANCHES) expect(webPointCost(branchOf(b)), b).toBe(20);
    expect(webPointCost()).toBe(7 * 20 + 6 * 2);
    expect(webPointCost()).toBe(152);
  });

  it('DESIGN 9.1 states the same totals', () => {
    expect(DESIGN).toContain('7 × 18 + 6 conjunctions = 132 nodes');
    expect(DESIGN).toContain('7 × 20 + 6 × 2 = 152 points');
  });

  it('every node matches its row in DESIGN 9.2–9.9', () => {
    const sections: [string, string][] = [
      ['9.2 Gravitic', 'gravitic'],
      ['9.3 Thermal', 'thermal'],
      ['9.4 Resonance', 'resonance'],
      ['9.5 Symbiotic', 'symbiotic'],
      ['9.6 Void', 'void'],
      ['9.7 Pilot', 'pilot'],
      ['9.8 Exo-suit', 'exosuit'],
    ];
    for (const [heading, branch] of sections) {
      const rows = designTable(heading);
      expect(rows.map(([name, tier, type, text]) => [name, tier, type, text])).toEqual(
        branchOf(branch as (typeof BRANCHES)[number]).map((n) => [n.name, tierNumber[n.tier as keyof typeof tierNumber], n.type, n.text]),
      );
    }
    const conj = designTable('9.9 Conjunctions');
    expect(conj.map(([name, branches, text]) => [name, branches, text])).toEqual(
      SKILL_NODES.filter((n) => n.branch === 'conjunction').map((n) => [n.name, n.branches!.map((b) => b[0].toUpperCase() + b.slice(1)).join(' + '), n.text]),
    );
  });

  it('tier rules: point cost, level and prerequisites', () => {
    const levels = { 1: 1, 2: 15, 3: 30, capstone: 45, conjunction: 15 } as const;
    const costs = { 1: 1, 2: 1, 3: 1, capstone: 3, conjunction: 2 } as const;
    for (const n of SKILL_NODES) {
      expect(n.level, n.id).toBe(levels[n.tier]);
      expect(n.pointCost, n.id).toBe(costs[n.tier]);
      if (n.tier === 'conjunction') {
        expect(n.branches?.[0]).not.toBe(n.branches?.[1]);
        expect(n.prereq.tiers).toEqual(n.branches!.map((branch) => ({ branch, tier: 2 })));
      } else {
        const below = n.tier === 'capstone' ? 3 : n.tier - 1;
        expect(n.prereq.tiers, n.id).toEqual(below ? [{ branch: n.branch, tier: below }] : []);
      }
    }
  });

  it('augments name a lower-tier active of their own branch, and require it', () => {
    for (const n of SKILL_NODES.filter((x) => x.type === 'augment' && x.branch !== 'conjunction')) {
      const target = getSkillNode(n.augments ?? '');
      expect(target.branch, n.id).toBe(n.branch);
      expect(['active', 'ship'], n.id).toContain(target.type);
      expect(Number(target.tier), n.id).toBeLessThan(Number(n.tier));
      expect(n.prereq.nodes, n.id).toEqual([target.id]);
    }
    for (const n of SKILL_NODES.filter((x) => x.type !== 'augment')) expect(n.augments, n.id).toBeNull();
  });

  it('references resolve: refs, shared cooldowns, conjunction targets, stat conditions', () => {
    for (const n of SKILL_NODES) {
      for (const r of [...n.refs, ...n.prereq.nodes]) expect(NODE_IDS.has(r), `${n.id} → ${r}`).toBe(true);
      if (n.cooldown?.kind === 'shared') expect(NODE_IDS.has(n.cooldown.node)).toBe(true);
      checkMods(n.mods, n.id);
      if (n.branch === 'conjunction') {
        for (const r of n.refs) expect(n.branches, `${n.id} → ${r}`).toContain(getSkillNode(r).branch);
      }
    }
  });

  it('slots follow costs: heat on the ground bar, Charge on the ship bar, nothing for always-on nodes', () => {
    for (const n of SKILL_NODES) {
      if (n.cost?.charge !== undefined) expect(n.slot, n.id).toBe('ship');
      else if (n.cost) expect(n.slot, n.id).toBe('ground');
      else expect(n.slot, n.id).toBe(n.type === 'active' ? 'ground' : null);
      if (n.type === 'active') expect(n.slot, n.id).not.toBeNull();
    }
  });

  it('unlock routes follow DESIGN 9.1', () => {
    const fragmentBranches = new Set(Object.values(FRAGMENT_WORLDS).filter(Boolean));
    expect([...fragmentBranches].sort()).toEqual(['gravitic', 'resonance', 'symbiotic', 'thermal', 'void']);
    for (const n of SKILL_NODES) {
      expect(n.unlock.anyOf.length, n.id).toBeGreaterThan(0);
      const routes = n.unlock.anyOf;
      const fragments = routes.filter((r) => r.kind === 'fragments');
      const chapters = routes.filter((r) => r.kind === 'chapter');
      if (n.tier === 1 || n.tier === 2 || n.tier === 3) {
        if (fragmentBranches.has(n.branch as never))
          expect(fragments, n.id).toEqual([{ kind: 'fragments', branch: n.branch, count: { 1: 1, 2: 3, 3: 6 }[n.tier] }]);
        else expect(fragments, n.id).toEqual([]);
        expect(chapters, n.id).toEqual([]);
      }
      if (n.tier === 'capstone') {
        expect(chapters, n.id).toEqual([{ kind: 'chapter', chapter: SKILL_RULES.capstoneChapters[n.branch as (typeof BRANCHES)[number]] }]);
        expect(fragments, n.id).toEqual([]);
      }
      if (n.tier === 'conjunction') expect(routes.map((r) => r.kind)).toEqual(['discovery']);
      expect(n.unlock.allOf, n.id).toEqual(n.branch === 'void' ? [{ kind: 'faction_rank', faction: 'reaches', rank: 'deckhand' }] : []);
    }
  });

  it('capstones unlock at the chapters 9.1 names, all within 1–26', () => {
    expect(SKILL_RULES.capstoneChapters).toEqual({ gravitic: 13, thermal: 13, resonance: 17, symbiotic: 20, void: 16, pilot: 23, exosuit: 23 });
    for (const c of Object.values(SKILL_RULES.capstoneChapters)) expect(c >= 1 && c <= 26).toBe(true);
    const sentence = DESIGN.split('\n').find((l) => l.includes('**Story.** Capstones unlock'));
    for (const [b, c] of Object.entries(SKILL_RULES.capstoneChapters)) {
      const name = b === 'exosuit' ? 'Exo-suit' : b[0].toUpperCase() + b.slice(1);
      expect(sentence, b).toMatch(new RegExp(`${name}[^.]*?ch\\. ${c}`));
    }
  });

  it('trainer routes are granted by the faction rank they name', () => {
    for (const n of SKILL_NODES) {
      for (const r of n.unlock.anyOf) {
        if (r.kind !== 'trainer') continue;
        expect(TRAINER_IDS.has(r.trainer)).toBe(true);
        const trainer = TRAINERS.find((t) => t.id === r.trainer)!;
        expect(
          trainer.teaches.some((x) => x.branch === n.branch && (!x.types || x.types.includes(n.type))),
          `${n.id} ← ${r.trainer}`,
        ).toBe(true);
        if (r.rank === null) continue;
        const grants = trainer.factions.map((f) => FACTIONS.find((x) => x.id === f)!.ranks.find((k) => k.id === r.rank));
        for (const rank of grants)
          expect(rank?.unlocks, `${n.id} ← ${r.trainer} ${r.rank}`).toContainEqual({ kind: 'trainer', trainer: r.trainer, tier: n.tier });
      }
    }
    // Pilot and Exo-suit drop no fragments, so a trainer must teach every non-capstone node.
    for (const n of SKILL_NODES.filter((x) => (x.branch === 'pilot' || x.branch === 'exosuit') && x.tier !== 'capstone')) {
      expect(
        n.unlock.anyOf.some((r) => r.kind === 'trainer'),
        n.id,
      ).toBe(true);
    }
  });

  it('conjunction discoveries reference real resources, worlds, bosses and events', () => {
    for (const n of SKILL_NODES.filter((x) => x.branch === 'conjunction')) {
      const route = n.unlock.anyOf[0];
      if (route.kind !== 'discovery') throw new Error(n.id);
      const c = route.condition;
      if (c.kind === 'mine') expect(RESOURCE_IDS.has(c.resource)).toBe(true);
      if (c.kind === 'mine' || c.kind === 'attune') expect(WORLD_TYPES).toContain(c.world);
      if (c.kind === 'kill_boss') expect(BOSS_IDS.has(c.boss)).toBe(true);
      if (c.kind === 'survive_event') expect(MOBS.find((m) => m.id === c.event)?.event).toBe(true);
    }
  });

  it('every world type maps to at most one fragment branch, and every fragment branch has worlds', () => {
    expect(Object.keys(FRAGMENT_WORLDS).sort()).toEqual([...WORLD_TYPES].sort());
    expect(FRAGMENT_WORLDS.gas).toBeNull();
  });
});

describe('peoples', () => {
  it('three peoples, each with a Tier I node pre-unlocked in the branch DESIGN 5.1 names', () => {
    const expected = {
      thalune: ['symbiotic', 'second_lung', 'lush'],
      ixari: ['resonance', 'pulse', 'alien'],
      ulgani: ['exosuit', 'cartridge_recycler', 'toxic'],
    };
    expect(PEOPLES.map((p) => p.id)).toEqual(Object.keys(expected));
    for (const p of PEOPLES) {
      const [branch, node, world] = expected[p.id];
      const n: SkillNode = getSkillNode(p.preUnlocked.node);
      expect(n.tier).toBe(1);
      expect(n.branch).toBe(branch);
      expect(p.preUnlocked).toEqual({ branch, node });
      expect(n.unlock.anyOf).toContainEqual({ kind: 'people', people: p.id });
      expect(p.homeWorld.archetype).toBe(world);
      checkMods(p.perk.mods, p.id);
      const city = FACTIONS.find((f) => f.id === p.capital.id);
      expect(city?.people).toBe(p.id);
      expect(city?.ranks.flatMap((r) => r.unlocks)).toContainEqual({ kind: 'quest_chain', chain: p.anchorChain.id });
    }
    const rows = designTable('5.1 Principles');
    expect(rows.map((r) => [r[0], r[7]])).toEqual([
      ['Thalune', 'Symbiotic: Second Lung'],
      ['Ixari', 'Resonance: Pulse'],
      ['Ulgani', 'Exo-suit: Cartridge Recycler'],
    ]);
  });
});

describe('factions and ranks', () => {
  it('rep 0–1000 with ranks at 200, 500, 800 in ascending order', () => {
    expect(FACTION_RULES.rankThresholds).toEqual([200, 500, 800]);
    expect(FACTIONS.map((f) => f.id)).toEqual(['compact', 'reaches', 'chorus', 'sarelun', 'quavel', 'belost']);
    for (const f of FACTIONS) {
      const reps = f.ranks.map((r) => r.rep);
      expect(reps).toEqual(FACTION_RULES.rankThresholds);
      for (let i = 1; i < reps.length; i++) expect(reps[i]).toBeGreaterThan(reps[i - 1]);
    }
    expect(rankAt('reaches', 199)).toBeNull();
    expect(rankAt('reaches', 500)?.name).toBe('Cutter');
    expect(rankAt('chorus', 1000)?.name).toBe('Voice');
  });

  it('rank names match DESIGN 14.4', () => {
    const rows = designTable('14.4 Faction chains');
    const names = Object.fromEntries(FACTIONS.map((f) => [f.id, f.ranks.map((r) => r.name).join(' → ')]));
    expect(rows.map((r) => r[1])).toEqual([names.compact, names.reaches, names.chorus, names.sarelun]);
    expect(names.quavel).toBe(names.sarelun);
    expect(names.belost).toBe(names.sarelun);
  });

  it('every unlock resolves', () => {
    for (const f of FACTIONS) {
      for (const rank of f.ranks) {
        for (const u of rank.unlocks) {
          const where = `${f.id}.${rank.id}`;
          if (u.kind === 'skill_node') expect(NODE_IDS.has(u.node), where).toBe(true);
          if (u.kind === 'item') expect(ITEM_IDS.has(u.item), where).toBe(true);
          if (u.kind === 'hull') expect(getHull(u.hull).price.rep, where).toEqual({ faction: f.id, rank: rank.id });
          if (u.kind === 'trainer') expect(TRAINERS.find((t) => t.id === u.trainer)?.factions, where).toContain(f.id);
        }
      }
    }
    expect(FACTIONS.find((f) => f.id === 'reaches')?.ranks[0].unlocks).toContainEqual({ kind: 'branch_access', branch: 'void' });
  });
});

describe('recipes', () => {
  it('inputs are resources, components and outputs are items or hulls', () => {
    for (const r of RECIPES) {
      for (const i of r.inputs) expect(RESOURCE_IDS.has(i.resource), `${r.id}: ${i.resource}`).toBe(true);
      for (const c of r.components) expect(ITEM_IDS.has(c.item), `${r.id}: ${c.item}`).toBe(true);
      if (r.output.kind === 'item') expect(ITEM_IDS.has(r.output.item), r.id).toBe(true);
      else expect(HULL_IDS.has(r.output.hull), r.id).toBe(true);
      if (r.boss) expect(BOSS_IDS.has(r.boss), r.id).toBe(true);
    }
  });

  it('matches DESIGN 15.7 amounts', () => {
    const want: Record<string, Record<string, number>> = {
      warp_cell: { dihydrogen: 50, tritium: 20, cobalt: 5 },
      pulse_fuel_cell: { tritium: 30, dihydrogen: 10 },
      oxygen_cartridge: { oxygen: 20, ferrite: 5 },
      sodium_cartridge: { sodium: 20, ferrite: 5 },
      flak_ammo: { ferrite: 20, carbon: 10 },
      torpedo: { cobalt: 5, tritium: 5, cinderglass: 2 },
      pulse_lasers: { copper: 30, ferrite: 20 },
      mining_laser: { copper: 20, ferrite: 20, dihydrogen: 10 },
      flak_cannon: { ferrite: 40, copper: 20, carbon: 10 },
      beam_lance: { gold: 20, copper: 20, cinderglass: 10 },
      emp_pod: { cobalt: 20, stormquartz: 10 },
      railgun: { iridium: 20, gold: 10, stormquartz: 10 },
      torpedo_rack: { cobalt: 20, cinderglass: 10, iridium: 10 },
      thermal_plating_module: { cinderglass: 30, ferrite: 20 },
      pressure_hull_module: { murkpearl: 20, ferrite: 20 },
      hazard_coating_module: { acidsalt: 30, ferrite: 20 },
      cargo_pod: { ferrite: 40, copper: 10 },
      husk_plating: { husk_alloy: 20, count_residue: 10 },
      husk_hull: { husk_alloy: 60, glyphstone: 20 },
    };
    for (const [id, inputs] of Object.entries(want)) {
      const r = RECIPES.find((x) => x.id === id);
      expect(Object.fromEntries(r?.inputs.map((i) => [i.resource, i.amount]) ?? []), id).toEqual(inputs);
    }
    expect(RECIPES.find((r) => r.id === 'flak_ammo')?.output).toEqual({ kind: 'item', item: 'flak_ammo', count: 50 });
    expect(RECIPES.find((r) => r.id === 'husk_hull')?.components).toEqual([{ item: 'hive_heart_core', count: 1 }]);
  });

  it('no recipe is below the tier where its rarest input is common, and fabricators can make it', () => {
    const fab = Object.fromEntries(FABRICATORS.map((f) => [f.id, f]));
    for (const r of RECIPES) {
      const rarest = Math.max(...r.inputs.map((i) => getResource(i.resource).tier.min));
      expect(r.tier, r.id).toBeGreaterThanOrEqual(rarest);
      for (const f of r.fabricators) {
        const max = fab[f].maxTier;
        if (max !== null) expect(r.tier, `${r.id} at ${f}`).toBeLessThanOrEqual(max);
      }
      expect(r.fabricators.includes('sanctuary'), r.id).toBe(r.line === 'catalyst');
    }
  });

  it('only ammo and cartridges are field-craftable', () => {
    const field = RECIPES.filter((r) => r.field).map((r) => r.id);
    expect(field.sort()).toEqual(['flak_ammo', 'oxygen_cartridge', 'pulse_fuel_cell', 'sodium_cartridge', 'torpedo']);
    expect(RECIPES.find((r) => r.id === 'torpedo')?.field).toEqual({ minTier: 2 });
  });

  it('salvage returns a third of a module, rounded down', () => {
    const lasers = RECIPES.find((r) => r.id === 'pulse_lasers')!;
    expect(salvageYield(lasers)).toEqual([
      { resource: 'copper', amount: 10 },
      { resource: 'ferrite', amount: 6 },
    ]);
    expect(salvageYield(RECIPES.find((r) => r.id === 'warp_cell')!)).toEqual([]);
    for (const r of RECIPES.filter((x) => x.line === 'module')) expect(salvageYield(r).length, r.id).toBeGreaterThan(0);
  });
});

describe('meters and conditions', () => {
  it('heat and charge follow DESIGN 9.1', () => {
    expect(METERS.heat).toMatchObject({ capacity: 100, beamPerS: 32, coolingIdlePerS: 20, coolingChannellingPerS: 8, overheatAt: 100, recoverBelow: 25 });
    expect(METERS.heat.worldModifiers.map((m) => m.coolingMult)).toEqual([1.5, 0.6, 2, 1.1]);
    expect(METERS.charge).toMatchObject({ capacity: 100, pulseBurnNearBodiesPerS: 0.35 });
    for (const m of [...METERS.heat.worldModifiers, ...METERS.charge.regen]) expect(CONDITION_IDS.has(m.when), m.when).toBe(true);
  });
});

describe('mobs and bosses', () => {
  const fightable = new Set([...MOB_IDS, ...TEMPERAMENT_IDS, ...BOSS_IDS]);

  it('combat scaling: health = base × (1 + 0.12 × level)', () => {
    expect(COMBAT.perLevel).toBe(0.12);
    expect(scaleByLevel(100, 10)).toBeCloseTo(220);
    expect(scaleByLevel(25, 50)).toBeCloseTo(175);
    expect(COMBAT.threat).toEqual({ min: 1, max: 5 });
  });

  it('temperaments match DESIGN 12.2 and use real body plans', () => {
    const rows = designTable('12.2 Planet fauna');
    expect(rows.map((r) => r[0])).toEqual(TEMPERAMENTS.map((t) => t.name));
    for (const t of TEMPERAMENTS) {
      if (t.bodyPlans !== 'all') for (const b of t.bodyPlans) expect(ids(BODY_PLANS).has(b.plan)).toBe(true);
      if (t.boss) expect(BOSS_IDS.has(t.boss)).toBe(true);
    }
    for (const b of BODY_PLANS) for (const a of b.attacks) for (const n of a.interruptedBy) expect(NODE_IDS.has(n)).toBe(true);
  });

  it('every mob references real body plans, hulls, mobs, nodes, weapons and bosses', () => {
    for (const m of MOBS) {
      expect(m.tier !== null || m.act !== undefined, m.id).toBe(true);
      if (m.bodyPlan) expect(ids(BODY_PLANS).has(m.bodyPlan)).toBe(true);
      for (const h of m.hulls) if (h.hull) expect(HULL_IDS.has(h.hull), m.id).toBe(true);
      for (const i of m.includes) expect(MOB_IDS.has(i), m.id).toBe(true);
      for (const n of m.counter?.nodes ?? []) expect(NODE_IDS.has(n), `${m.id}: ${n}`).toBe(true);
      for (const w of m.counter?.weapons ?? []) expect(WEAPON_IDS.has(w), `${m.id}: ${w}`).toBe(true);
      for (const r of m.resistances) {
        const table = r.kind === 'branch' ? new Set<string>(BRANCHES) : r.kind === 'node' ? NODE_IDS : WEAPON_IDS;
        expect(table.has(r.id), `${m.id}: ${r.id}`).toBe(true);
        for (const e of r.except ?? []) expect(NODE_IDS.has(e)).toBe(true);
      }
      for (const role of m.roles ?? []) for (const n of role.nodes) expect(getSkillNode(n).branch, `${m.id}.${role.id}`).toBe(role.branch);
      if (m.boss) expect(BOSS_IDS.has(m.boss), m.id).toBe(true);
      if (m.group === 'space' && m.hulls.length) expect(m.baseHealth, m.id).toBeNull();
    }
  });

  it('space mobs match DESIGN 12.7', () => {
    const rows = designTable('12.7 Space');
    expect(rows.map((r) => r[0])).toEqual(MOBS.filter((m) => m.group === 'space').map((m) => m.name));
  });

  it('density covers tiers 0–5 and names real mobs, at tiers where they appear', () => {
    expect(DENSITY.map((d) => d.tier)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(designTable('12.8 Density')).toHaveLength(6);
    for (const d of DENSITY) {
      for (const cell of [d.living, d.lifeless, d.space, d.night]) {
        for (const ref of cell.refs) {
          expect(fightable.has(ref), `tier ${d.tier}: ${ref}`).toBe(true);
          const mob = MOBS.find((m) => m.id === ref);
          if (mob?.tier) expect(d.tier >= mob.tier.min && d.tier <= mob.tier.max, `tier ${d.tier}: ${ref}`).toBe(true);
          const temperament = TEMPERAMENTS.find((t) => t.id === ref);
          if (temperament) expect(d.tier, ref).toBeGreaterThanOrEqual(temperament.minTier);
        }
      }
      const min = FAUNA_SPAWNING.hostileSpeciesMin.filter((h) => d.tier >= h.fromTier).at(-1)?.count ?? 0;
      expect(d.living.hostileSpeciesMin, `tier ${d.tier}`).toBe(min);
    }
  });

  it('bosses match DESIGN 13 and reference real mobs, nodes, weapons, hulls and loot', () => {
    const rows = designTable('13. Bosses');
    expect(rows).toHaveLength(BOSSES.length);
    for (const b of BOSSES) {
      for (const m of b.mobs) expect(fightable.has(m), `${b.id}: ${m}`).toBe(true);
      for (const n of [...b.uses, ...b.counter.nodes]) expect(NODE_IDS.has(n), `${b.id}: ${n}`).toBe(true);
      for (const w of b.counter.weapons) expect(WEAPON_IDS.has(w)).toBe(true);
      if (b.hull) expect(HULL_IDS.has(b.hull)).toBe(true);
      if (b.bodyPlan) expect(ids(BODY_PLANS).has(b.bodyPlan)).toBe(true);
      for (const i of b.loot.items) expect(ITEM_IDS.has(i), `${b.id}: ${i}`).toBe(true);
      for (const r of b.loot.recipes) expect(RECIPE_IDS.has(r), `${b.id}: ${r}`).toBe(true);
      expect(b.kind === 'space_boss' ? b.hull : 'n/a', b.id).not.toBeNull();
      expect(b.killable || b.baseHealth === null, b.id).toBe(true);
      for (const c of b.chapters ?? []) expect(c >= 1 && c <= 26).toBe(true);
    }
    expect(BOSSES.find((b) => b.id === 'sentinel_prime')?.variants).toHaveLength(3);
    expect(BOSSES.find((b) => b.id === 'wardens')?.variants).toHaveLength(4);
  });
});
