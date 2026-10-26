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
  SENSORS,
  SENSOR_IDS,
  SKILL_NODES,
  SKILL_RULES,
  STEALTH,
  STEALTH_IDS,
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
  getItem,
  getRecipe,
  getResource,
  getSensor,
  getSkillNode,
  getStealth,
  getWeapon,
  hullSchema,
  itemSchema,
  metersSchema,
  nodeCostSchema,
  mobSchema,
  peopleSchema,
  rankAt,
  recipeSchema,
  resourceSchema,
  salvageYield,
  scaleByLevel,
  sensorSchema,
  skillNodeSchema,
  skillRulesSchema,
  stealthSchema,
  temperamentSchema,
  trainerSchema,
  webPointCost,
  weaponSchema,
} from '../src/data/index.ts';
import type { HullVenue, NodeCooldown, NodeCost, ResourceId, SkillNode, Stat, StatMod, Weapon } from '../src/data/index.ts';
// Read as text through Vite's ?raw import, so the shared package's tests need no Node types.
import DESIGN from '../../../docs/DESIGN.md?raw';

/** The rows of each markdown table under a heading (up to the next heading), as trimmed cells, without header and separator. */
function designTables(heading: string): string[][][] {
  const lines = DESIGN.split('\n');
  const start = lines.findIndex((l) => l.startsWith('#') && l.includes(heading));
  if (start < 0) throw new Error(`DESIGN.md has no heading ${heading}`);
  const tables: string[][][] = [];
  let rows: string[][] | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    if (line.startsWith('|')) {
      if (!rows) tables.push((rows = []));
      rows.push(
        line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim()),
      );
    } else rows = null;
  }
  return tables.map((t) => t.slice(2));
}

/** The rows of the first table under a heading. */
const designTable = (heading: string) => designTables(heading)[0];

/** The paragraph under a heading that starts with this text. */
function designParagraph(heading: string, startsWith: string): string {
  const lines = DESIGN.split('\n');
  const start = lines.findIndex((l) => l.startsWith('#') && l.includes(heading));
  const line = lines.slice(start + 1).find((l) => l.startsWith(startsWith));
  if (!line) throw new Error(`DESIGN.md ${heading} has no paragraph starting "${startsWith}"`);
  return line;
}

/** "50 di-hydrogen + 20 tritium + 5 cobalt" as resource ids and amounts. */
function designInputs(text: string): Record<string, number> {
  return Object.fromEntries(
    text.split(' + ').map((part) => {
      const m = part.trim().match(/^(\d+) (.+)$/);
      const resource = RESOURCES.find((r) => r.name.toLowerCase() === m?.[2].toLowerCase());
      if (!m || !resource) throw new Error(`unparsed recipe input "${part}"`);
      return [resource.id, Number(m[1])];
    }),
  );
}

const inputsOf = (id: string) => Object.fromEntries(getRecipe(id).inputs.map((i) => [i.resource, i.amount]));

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

/**
 * A node's cost and cooldown as DESIGN writes them: the Cost / CD column of 9.2–9.6 ("15 heat / 10 s", "32 heat/s",
 * "sets heat 100 / 40 s", "20 heat / shares Well", "30 heat / once per world"), or inline in the effect text for the
 * tables without that column (Pilot's "40 charge, 30 s", Field Repair's "for 20 ferrite") and for Unmake's "costs 15
 * health" and Unremembered's "Once a day".
 */
function designCost(cell: string, text: string): { cost: NodeCost | null; cooldown: NodeCooldown | null } {
  const cost: NodeCost = {};
  let cooldown: NodeCooldown | null = null;
  const [spend, cd] = cell ? cell.split(' / ') : [];
  if (spend) {
    const m = spend.match(/^(?:(\d+) (heat\/s|heat|charge)|sets heat (\d+))$/);
    if (!m) throw new Error(`unparsed cost "${cell}"`);
    if (m[3]) cost.setsHeat = Number(m[3]);
    else cost[m[2] === 'heat/s' ? 'heatPerS' : (m[2] as 'heat' | 'charge')] = Number(m[1]);
  }
  if (cd) {
    const m = cd.match(/^(?:(\d+) s|shares (\w+)|once per (\w+))$/);
    if (!m) throw new Error(`unparsed cooldown "${cell}"`);
    if (m[1]) cooldown = { kind: 'seconds', seconds: Number(m[1]) };
    else if (m[2]) cooldown = { kind: 'shared', node: SKILL_NODES.find((n) => n.name === m[2])?.id ?? m[2] };
    else cooldown = { kind: 'once_per', per: m[3] as 'world' | 'day' };
  }
  const inline = text.match(/(\d+) charge, (\d+(?:\.\d+)?) s$/);
  if (inline) {
    cost.charge = Number(inline[1]);
    cooldown = { kind: 'seconds', seconds: Number(inline[2]) };
  }
  const health = text.match(/costs (\d+) health/);
  if (health) cost.health = Number(health[1]);
  const material = text.match(/for (\d+) (\w+)$/);
  if (material && RESOURCE_IDS.has(material[2])) cost.resources = [{ resource: material[2] as ResourceId, amount: Number(material[1]) }];
  if (/^Once a day/.test(text)) cooldown = { kind: 'once_per', per: 'day' };
  return { cost: Object.keys(cost).length ? cost : null, cooldown };
}

/** Today's values the effect texts are written against ("Heat capacity 125" is +25 on 100; "×2 (deposits 360 m)" is 360 on 180). */
const BASELINES: Partial<Record<Stat, number>> = {
  'player.health_max': 100,
  'heat.capacity': 100,
  'suit.cartridge_restore': 40,
  'ship.weapon_cooldown': 0.12,
  'ship.shield_max': 100,
  'ship.hull_max': 100,
  'scan.deposit_range': 180,
  'fragments.per_monolith': 1,
};
/** Number words an effect text uses for values a node carries ("one target", "half damage", "count double", "No hazard drain"). */
const NUMBER_WORDS: Record<string, number> = { no: 0, half: 0.5, a: 1, an: 1, one: 1, single: 1, two: 2, second: 2, double: 2, twice: 2, three: 3, triple: 3 };
/** Values a node carries that its text states without a number or word: Resonant Hull's "under fire" is a regen delay of 0. */
const STATED_WITHOUT_NUMBER = new Set(['resonant_hull ship.shield_regen_delay']);
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** One number a node carries and the values its text may state it as. Costs and cooldowns are checked against DESIGN's column, so the text need not repeat them. */
interface Carried {
  what: string;
  forms: number[];
  mustBeStated: boolean;
}

function carried(n: SkillNode): Carried[] {
  const out: Carried[] = [];
  for (const [k, v] of Object.entries(n.params)) {
    // Living Ship's "returns to 100" states a full-hull fraction as today's 100
    if (typeof v === 'number') out.push({ what: `params.${k} = ${v}`, forms: k === 'hullRestoreFraction' ? [v, v * 100] : [v], mustBeStated: true });
  }
  for (const m of n.mods) {
    const base = BASELINES[m.stat];
    const forms = [m.value];
    if (base !== undefined) forms.push(m.op === 'add' ? base + m.value : m.op === 'mul' ? base * m.value : m.value / base);
    out.push({ what: `${m.stat} ${m.op} ${m.value}`, forms, mustBeStated: !STATED_WITHOUT_NUMBER.has(`${n.id} ${m.stat}`) });
  }
  const walk = (x: unknown, path: string): void => {
    if (typeof x === 'number') out.push({ what: path, forms: [x], mustBeStated: false });
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`);
  };
  walk(n.cost, 'cost');
  if (n.cooldown?.kind === 'seconds') out.push({ what: 'cooldown', forms: [n.cooldown.seconds], mustBeStated: false });
  return out;
}

/** Today's values in an effect text are not the node's: "(today …)" asides, the "from" side of "a → b", and "instead of n". */
const withoutToday = (text: string) =>
  text
    .replace(/\(today[^)]*\)/gi, '')
    .replace(/\d+(?:\.\d+)? → /g, '')
    .replace(/ instead of \d+(?:\.\d+)?/g, '');

/**
 * The numbers an effect text states, read in the direction the text gives them: "+N%" is 1 + N/100; "−N%", "N% less" and
 * "N% slower" are 1 − N/100; a bare "N%" is N/100; "÷N" is 1/N; "×N" and "N×" are N; "N km" is metres; "N min" is minutes
 * or seconds.
 */
function statedNumbers(text: string): { token: string; value: number[] }[] {
  const re = /([+−-])?([÷×])?(\d+(?:\.\d+)?)(×)?\s*(%|km|min)?( (?:less|slower)\b)?/g;
  return [...withoutToday(text).matchAll(re)].map(([token, sign, op, digits, , unit, less]) => {
    const v = Number(digits);
    let value: number[];
    if (unit === '%') value = [sign === '+' ? 1 + v / 100 : sign || less ? 1 - v / 100 : v / 100];
    else if (op === '÷') value = [1 / v];
    else if (unit === 'km') value = [v * 1000];
    else if (unit === 'min') value = [v, v * 60];
    else value = [v];
    return { token: token.trim(), value: value.map(round) };
  });
}

/** The values number words in a text stand for. */
const statedWords = (text: string) =>
  [
    ...withoutToday(text)
      .toLowerCase()
      .matchAll(/\b([a-z]+)\b/g),
  ]
    .map(([, w]) => NUMBER_WORDS[w])
    .filter((v): v is number => v !== undefined);

describe('every table parses with its schema', () => {
  const cases: [string, z.ZodType, unknown][] = [
    ['resources', z.array(resourceSchema), RESOURCES],
    ['items', z.array(itemSchema), ITEMS],
    ['weapons', z.array(weaponSchema), WEAPONS],
    ['hulls', z.array(hullSchema), HULLS],
    ['sensors', z.array(sensorSchema), SENSORS],
    ['stealth', z.array(stealthSchema), STEALTH],
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
      SENSORS,
      STEALTH,
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

  it('a node cost names at least one thing spent', () => {
    expect(nodeCostSchema.safeParse({}).success).toBe(false);
    expect(nodeCostSchema.safeParse({ heat: 0 }).success).toBe(true);
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
  it('8 weapons, matching every column of DESIGN 10.3', () => {
    expect(WEAPONS).toHaveLength(8);
    const rows = designTable('10.3 Weapons');
    expect(rows).toHaveLength(8);
    const ammoKind: Record<string, string> = { none: 'none', Charge: 'charge', ammo: 'item' };
    rows.forEach(([name, size, behaviour, best, ammo], i) => {
      const w = WEAPONS[i];
      expect([w.name, w.size, w.behaviour, w.bestAgainst.join(', ')]).toEqual([name, size, behaviour, best]);
      expect(w.ammo.kind, name).toBe(ammoKind[ammo]);
    });
  });

  it("each behaviour DESIGN 10.3 states is in the weapon's params", () => {
    // [pattern in the behaviour text, check on the weapon given the match]
    const rules: [RegExp, (w: Weapon, m: RegExpMatchArray) => unknown, unknown][] = [
      [/(\d+(?:\.\d+)?) km/, (w) => w.params.rangeM, null],
      [/silences ship abilities (\d+) s/, (w) => w.params.silenceS, null],
      [/(\d+) per rack/, (w) => w.params.magazine, null],
      [/yield ×(\d+)/, (w) => w.params.asteroidYieldMult, null],
      [/hitscan/, (w) => w.params.hitscan, true],
      [/pair/, (w) => w.params.barrels, 2],
      [/continuous/, (w) => w.params.continuous, true],
      [/homing/, (w) => w.params.homing, true],
      [/drops shields/, (w) => w.params.dropsShields, true],
      [/pull loot/, (w) => w.params.pullsLoot, true],
      [/burst of fragments/, (w) => (w.params.fragments ?? 0) > 1, true],
      [/area damage/, (w) => (w.params.radiusM ?? 0) > 0, true],
      [/weak against hulls/, (w) => (w.params.hullDamageMult ?? 1) < 1, true],
      [/charged shot/, (w) => (w.params.chargeTimeS ?? 0) > 0, true],
      [/drains Charge while held/, (w) => w.ammo.kind === 'charge' && (w.ammo.perSecond ?? 0) > 0, true],
      [/fast cooldown/, (w) => (w.params.cooldownS ?? Infinity) <= 0.12, true],
      [/slow/, (w) => (w.params.cooldownS ?? 0) >= 2, true],
    ];
    for (const w of WEAPONS) {
      for (const [pattern, read, want] of rules) {
        const m = w.behaviour.match(pattern);
        if (!m) continue;
        const expected = want ?? (pattern.source.includes('km') ? Number(m[1]) * 1000 : Number(m[1]));
        expect(read(w, m), `${w.id}: "${m[0]}"`).toBe(expected);
      }
    }
    // DESIGN 10.1 and 9.7: today's pair of pulse lasers reach 1500 m with a 0.12 s cooldown
    expect(getWeapon('pulse_lasers').params).toMatchObject({ rangeM: 1500, cooldownS: 0.12 });
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
  it('13 hulls, matching every column of DESIGN 10.2', () => {
    expect(HULLS).toHaveLength(13);
    const rows = designTable('10.2 Hull roster');
    expect(rows).toHaveLength(13);
    const venues: Record<string, HullVenue> = {
      'any Waystation': { kind: 'waystation' },
      Waystations: { kind: 'waystation' },
      'A Ship of Your Own': { kind: 'quest', quest: 'a_ship_of_your_own' },
      Quavel: { kind: 'capital', capital: 'quavel' },
      Belost: { kind: 'capital', capital: 'belost' },
      Sarelun: { kind: 'capital', capital: 'sarelun' },
      Compact: { kind: 'faction', faction: 'compact', vendor: 'Compact' },
      'Free Reaches quartermaster': { kind: 'faction', faction: 'reaches', vendor: 'Free Reaches quartermaster' },
      'Chorus sanctuary': { kind: 'faction', faction: 'chorus', vendor: 'Chorus sanctuary' },
      'Edge expedition drops': { kind: 'drop', source: 'Edge expedition drops' },
    };
    rows.forEach(([name, tier, role, speed, boost, hull, shield, charge, pods, signature, hardpoints, slots, where, price], i) => {
      const h = HULLS[i];
      // signature, including the Husk's split value
      const split = signature.match(/^([\d.]+) to the Hollow, ([\d.]+) to everyone else$/);
      expect(h.signature, name).toEqual(split ? { base: Number(split[2]), vsHollow: Number(split[1]) } : { base: Number(signature) });
      // where: every venue DESIGN names, in order (the Husk's craft venue comes from 15.7 and is checked against the recipe)
      expect(
        h.sold.filter((v) => v.kind !== 'craft'),
        name,
      ).toEqual(where.split(', ').map((part) => venues[part] ?? `unmapped venue "${part}"`));
      // price: units ("8k"), credit, raid, "+ rep", and what the parenthesis says is built in
      const k = price.match(/^(\d+)k/);
      expect(h.price.units, name).toBe(k ? Number(k[1]) * 1000 : null);
      expect(h.price.credit, name).toBe(price === 'credit');
      expect(h.price.raid, name).toBe(price === 'raid');
      expect(h.price.rep !== null, name).toBe(price.includes('+ rep'));
      const builtIn = [...price.matchAll(/([A-Z][\w -]*?) built in/g)].map(([, node]) => SKILL_NODES.find((n) => n.name === node)?.id ?? node);
      expect(h.builtIn.nodes, name).toEqual(builtIn);
      expect(h.builtIn.flags.includes('charge_regen_anywhere'), name).toBe(price.includes('Charge regen anywhere'));
      const hazardMods = h.builtIn.mods.filter((m) => m.stat.startsWith('ship.hazard_damage_'));
      expect(hazardMods.length, name).toBe(price.includes('base hazard resist ×2') ? 6 : 0);
      for (const m of hazardMods) expect(m).toMatchObject({ op: 'mul', value: 0.5 });
      const scan = h.builtIn.mods.filter((m) => m.stat === 'ship.scan_range');
      expect(scan, name).toEqual(price.includes('scan range ×2') ? [{ stat: 'ship.scan_range', op: 'mul', value: 2 }] : []);
      // the numeric columns
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

  it("every node's cost and cooldown match DESIGN (the Cost / CD column, or inline in the effect)", () => {
    const sections = ['9.2 Gravitic', '9.3 Thermal', '9.4 Resonance', '9.5 Symbiotic', '9.6 Void', '9.7 Pilot', '9.8 Exo-suit'];
    const rows = sections.flatMap((s) => designTable(s));
    expect(rows).toHaveLength(126);
    for (const [name, , , text, cell = ''] of rows) {
      const n = SKILL_NODES.find((x) => x.name === name);
      expect({ cost: n?.cost, cooldown: n?.cooldown }, name).toEqual(designCost(cell, text));
    }
    for (const n of SKILL_NODES.filter((x) => x.branch === 'conjunction')) expect([n.cost, n.cooldown], n.id).toEqual([null, null]);
  });

  it("every number in a node's effect text is carried in the direction the text gives, and every value it carries is stated", () => {
    for (const n of SKILL_NODES) {
      const values = carried(n);
      const carriedForms = new Set(values.flatMap((c) => c.forms.map(round)));
      const stated = statedNumbers(n.text);
      for (const { token, value } of stated) {
        expect(
          value.some((v) => carriedForms.has(v)),
          `${n.id}: "${token}" in "${n.text}" reads as ${value.join(' or ')}; carries ${values.map((c) => c.what).join(', ')}`,
        ).toBe(true);
      }
      const statedForms = new Set([...stated.flatMap((x) => x.value), ...statedWords(n.text)]);
      for (const c of values.filter((x) => x.mustBeStated)) {
        expect(
          c.forms.some((v) => statedForms.has(round(v))),
          `${n.id}: ${c.what} is not stated in "${n.text}"`,
        ).toBe(true);
      }
    }
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

  it('fragment worlds match DESIGN 9.1, including the Symbiotic survey rule', () => {
    expect(Object.keys(FRAGMENT_WORLDS).sort()).toEqual([...WORLD_TYPES].sort());
    expect(FRAGMENT_WORLDS.gas).toBeNull();
    const line = DESIGN.split('\n').find((l) => l.includes('**Memory fragments.**')) ?? '';
    for (const branch of ['gravitic', 'thermal', 'resonance', 'symbiotic', 'void']) {
      const clause = line
        .split(`${branch[0].toUpperCase()}${branch.slice(1)} on `)[1]
        .split(';')[0]
        .split('(')[0];
      const worlds = clause
        .replace(/ worlds?/g, '')
        .split(/, | and /)
        .map((w) => (w.trim() === 'exotic' ? 'alien' : w.trim()));
      const mapped = Object.entries(FRAGMENT_WORLDS)
        .filter(([, b]) => b === branch)
        .map(([w]) => w);
      expect(worlds.sort(), branch).toEqual(mapped.sort());
    }
    for (const o of SKILL_RULES.fragmentOverrides) expect(line).toContain(`${o.branch[0].toUpperCase()}${o.branch.slice(1)} on lush worlds (and ${o.text})`);
    expect(line).toContain('Tier I nodes unlock with 1 fragment of the branch, Tier II with 3, Tier III with 6');
    expect(SKILL_RULES.fragments).toEqual({ 1: 1, 2: 3, 3: 6 });
  });

  it('respec trainers exist and offer the respec DESIGN 9.1 gives them', () => {
    const respec = DESIGN.split('\n').find((l) => l.startsWith('**Respec.**')) ?? '';
    expect(respec).toContain(`Any Chorus listener, ${SKILL_RULES.respec.unitsPerPoint} units per point refunded, Void nodes only at a Reaches quartermaster`);
    expect(TRAINER_IDS.has(SKILL_RULES.respec.trainer)).toBe(true);
    expect(TRAINER_IDS.has(SKILL_RULES.respec.voidTrainer)).toBe(true);
    expect(TRAINERS.find((t) => t.id === SKILL_RULES.respec.trainer)?.respec).toBe('all_but_void');
    expect(TRAINERS.find((t) => t.id === SKILL_RULES.respec.voidTrainer)?.respec).toBe('void');
    expect(TRAINERS.filter((t) => t.respec !== null).map((t) => t.id)).toEqual([SKILL_RULES.respec.trainer, SKILL_RULES.respec.voidTrainer]);
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

  it('consumables match DESIGN 15.7: inputs, output counts, field crafting and what a cartridge restores', () => {
    const [consumables] = designTables('15.7 Crafting');
    const recipesFor: Record<string, string[]> = {
      'Warp cell': ['warp_cell'],
      'Pulse fuel cell': ['pulse_fuel_cell'],
      'Oxygen / sodium cartridge': ['oxygen_cartridge', 'sodium_cartridge'],
      'Flak ammo (50)': ['flak_ammo'],
      'Torpedo (1)': ['torpedo'],
      'Catalysts (30 min buffs)': ['frostglass_catalyst', 'stormquartz_catalyst', 'gamma_catalyst', 'acidsalt_catalyst'],
    };
    expect(consumables.map((r) => r[0])).toEqual(Object.keys(recipesFor));
    for (const [name, recipe, notes] of consumables.filter((r) => !r[0].startsWith('Catalysts'))) {
      const count = Number(name.match(/\((\d+)\)$/)?.[1] ?? 1);
      for (const id of recipesFor[name]) {
        const r = getRecipe(id);
        expect(inputsOf(id), id).toEqual(designInputs(recipe.replace('oxygen or sodium', id.split('_')[0])));
        expect(r.output, id).toEqual({ kind: 'item', item: id, count });
        const field = notes.match(/field-craftable(?: at Tier (\d)\+)?/);
        if (field) expect(r.field, id).toEqual({ minTier: Number(field[1] ?? 0) });
        const restores = notes.match(/refills restore (\d+)/);
        if (restores) expect(getItem(id).restores?.amount, id).toBe(Number(restores[1]));
      }
    }
    expect(getItem('oxygen_cartridge').restores?.meter).toBe('life_support');
    expect(getItem('sodium_cartridge').restores?.meter).toBe('hazard_protection');
  });

  it('catalysts match DESIGN 15.7: one resource each, the effect, 30-minute buffs, sanctuary recipes', () => {
    const [name, cell, notes] = designTables('15.7 Crafting')[0].find((r) => r[0].startsWith('Catalysts'))!;
    const minutes = Number(name.match(/\((\d+) min buffs\)/)?.[1]);
    expect(notes).toBe('sanctuary recipes');
    const statOf: Record<string, Pick<StatMod, 'stat' | 'branch' | 'nodes'>> = {
      'heat capacity': { stat: 'heat.capacity' },
      'Charge regen': { stat: 'charge.regen' },
      'Void heat costs': { stat: 'heat.cost', branch: 'void' },
      'Spore and Rot': { stat: 'ability.power', nodes: ['spore', 'rot'] },
    };
    const parts = cell.split('; ');
    expect(parts).toHaveLength(RECIPES.filter((r) => r.line === 'catalyst').length);
    for (const part of parts) {
      const m = part.match(/^(.+?) → (.+) ([+−])(\d+)(%|\/s)?$/);
      if (!m) throw new Error(`unparsed catalyst "${part}"`);
      const resource = RESOURCES.find((r) => r.name.toLowerCase() === m[1])!.id;
      const recipe = RECIPES.find((r) => r.line === 'catalyst' && r.inputs.length === 1 && r.inputs[0].resource === resource);
      expect(recipe, part).toBeDefined();
      expect(recipe!.output.kind === 'item' ? recipe!.output.count : 0, part).toBe(1);
      expect(recipe!.fabricators, part).toEqual(['sanctuary']);
      const item = getItem(recipe!.output.kind === 'item' ? recipe!.output.item : '');
      const n = Number(m[4]);
      const change = m[5] === '%' ? { op: 'mul', value: m[3] === '+' ? 1 + n / 100 : 1 - n / 100 } : { op: 'add', value: n };
      expect(item.mods, part).toEqual([{ ...statOf[m[2]], ...change }]);
      expect(item.durationS, part).toBe(minutes * 60);
    }
  });

  it('modules match DESIGN 15.7: inputs, one module per craft, and the Tier column', () => {
    const modules = designTables('15.7 Crafting')[1];
    let checked = 0;
    for (const [name, recipe, tier] of modules) {
      const names = name.replace(/ \(.*\)$/, '').split(' / ');
      const each = recipe.match(/^(.*) \+ (.+) each$/);
      const parts = each ? each[1].split(' / ').map((x) => `${x} + ${each[2]}`) : [recipe];
      expect(parts.length, name).toBe(names.length);
      const [lo, hi = lo] = tier.split('–').map(Number);
      names.forEach((moduleName, i) => {
        const r = RECIPES.find((x) => x.line === 'module' && x.name === moduleName);
        expect(r, moduleName).toBeDefined();
        expect(inputsOf(r!.id), moduleName).toEqual(designInputs(parts[i]));
        expect(r!.output, moduleName).toEqual({ kind: 'item', item: r!.id, count: 1 });
        if (lo === hi) expect(r!.tier, `${moduleName} tier`).toBe(lo);
        else {
          expect(r!.tier, `${moduleName} tier`).toBeGreaterThanOrEqual(lo);
          expect(r!.tier, `${moduleName} tier`).toBeLessThanOrEqual(hi);
        }
        checked++;
      });
    }
    expect(checked).toBe(RECIPES.filter((r) => r.line === 'module').length);
  });

  it('cosmetics and the Husk hull match DESIGN 15.7, and every recipe is one DESIGN lists', () => {
    const para = designParagraph('15.7 Crafting', 'Suit glyphs');
    const [lo, hi] = (para.match(/Count residue \((\d+)–(\d+) each, patterns from boss drops\)/) ?? []).slice(1).map(Number);
    for (const id of ['suit_glyph', 'hull_glyph_seams']) {
      const r = getRecipe(id);
      expect(
        r.inputs.map((i) => i.resource),
        id,
      ).toEqual(['count_residue']);
      expect(r.inputs[0].amount >= lo && r.inputs[0].amount <= hi, id).toBe(true);
      expect(r.output, id).toEqual({ kind: 'item', item: id, count: 1 });
      expect(r.learnedFrom, id).toBe('boss');
    }
    const husk = para.match(/the \*\*Husk hull\*\* assembled at the Scrapyard from the Hive Heart's core \+ (.+)\.$/);
    expect(inputsOf('husk_hull')).toEqual(designInputs(husk?.[1] ?? ''));
    expect(getRecipe('husk_hull')).toMatchObject({
      output: { kind: 'hull', hull: 'husk' },
      components: [{ item: 'hive_heart_core', count: 1 }],
      fabricators: ['scrapyard'],
    });
    // 6 consumables, 4 catalysts, 12 modules, 2 cosmetics and the Husk hull: every recipe is compared above
    const lines = Object.fromEntries(['consumable', 'catalyst', 'module', 'cosmetic', 'endgame'].map((l) => [l, RECIPES.filter((r) => r.line === l).length]));
    expect(lines).toEqual({ consumable: 6, catalyst: 4, module: 12, cosmetic: 2, endgame: 1 });
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

describe('sensors and stealth', () => {
  it('a row per sensor and per stealth effect, and lookups throw on unknown ids', () => {
    expect(SENSORS.map((s) => s.id)).toEqual([...SENSOR_IDS]);
    expect(STEALTH.map((s) => s.id)).toEqual([...STEALTH_IDS]);
    expect(getSensor('hollow').rangeM).toBe(1000);
    expect(getStealth('cloak').hidesFrom).toContain('pirate');
    expect(Object.isFrozen(SENSORS[0])).toBe(true);
    expect(() => getSensor('no_such_sensor' as never)).toThrow(/sensor/);
    expect(() => getStealth('no_such_effect' as never)).toThrow(/stealth/);
  });

  it('every ship-hunting space mob flies one set of sensors, of its own kind', () => {
    const hunters = ['pirate_scouts', 'pirate_wing', 'raiders', 'hollow_drifter', 'hollow_swarm', 'hollow_husk', 'compact_convoy'];
    const named = SENSORS.flatMap((s) => s.mobs);
    expect(new Set(named).size).toBe(named.length);
    expect(new Set(named)).toEqual(new Set(hunters));
    for (const s of SENSORS)
      for (const id of s.mobs) {
        const mob = MOBS.find((m) => m.id === id);
        expect(mob?.group, `${s.id}: ${id}`).toBe('space');
        const kind = id.startsWith('hollow_') ? 'hollow' : id === 'compact_convoy' ? 'compact' : 'pirate';
        expect(s.kind, `${s.id}: ${id}`).toBe(kind);
      }
    expect(getSensor('ship')).toMatchObject({ kind: 'player', mobs: [] });
  });

  it('ranges agree with the distances DESIGN gives', () => {
    // the drifter turns within 1 km (12.7): the Hollow's detection distance for a Lark (signature 1.0)
    const drifter = MOBS.find((m) => m.id === 'hollow_drifter')!;
    expect(getSensor('hollow').rangeM * getHull('lark').signature.base).toBe(drifter.params.aggroRadiusM);
    // Deep Sweep's radar reaches past a ship's unaided sensors, and both past the Pulse Lasers
    const sweep = getSkillNode('deep_sweep').params?.radarRangeM;
    expect(sweep).toBeGreaterThan(getSensor('ship').rangeM);
    expect(getSensor('ship').rangeM).toBeGreaterThan(getWeapon('pulse_lasers').params.rangeM!);
  });

  it('stealth effects are skill nodes, hiding the ship from what their text says', () => {
    for (const s of STEALTH) expect(getSkillNode(s.id).id).toBe(s.id);
    expect(getSkillNode('veil').text).toMatch(/to the Hollow/);
    expect(getStealth('veil').hidesFrom).toEqual(['hollow']);
    // "no markers" hides you from players, "no raids" from pirates
    for (const id of ['cloak', 'silent_running'] as const) {
      expect(getSkillNode(id).text).toMatch(/no markers/i);
      expect(getSkillNode(id).text).toMatch(/no raids/i);
      expect(getStealth(id).hidesFrom).toEqual(expect.arrayContaining(['player', 'pirate']));
    }
    // Silent Running is Veil's ship form, so it hides from the Hollow as Veil does
    expect(getSkillNode('silent_running').augments).toBe('veil');
    expect(getStealth('silent_running').hidesFrom).toContain('hollow');
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

  it('temperaments match every column of DESIGN 12.2, and the numbers in their behaviour', () => {
    const rows = designTable('12.2 Planet fauna');
    expect(rows.map((r) => r[0])).toEqual(TEMPERAMENTS.map((t) => t.name));
    rows.forEach(([name, behaviour, plans, appears], i) => {
      const t = TEMPERAMENTS[i];
      expect(t.behaviour, name).toBe(behaviour);
      const wantPlans =
        plans === 'all'
          ? 'all'
          : plans.split(', ').map((x) => {
              const m = x.match(/^(\w+)(?: \((\w+)\))?$/);
              return m?.[2] ? { plan: m[1], role: m[2] } : { plan: m?.[1] };
            });
      expect(t.bodyPlans, name).toEqual(wantPlans);
      expect(t.minTier, `${name} appears`).toBe(appears === 'everywhere' ? 0 : Number(appears.match(/^Tier (\d)\+/)?.[1]));
      expect(t.boss !== undefined, name).toBe(appears.includes('world boss'));
      const params = Object.values(t.params).filter((v): v is number => typeof v === 'number');
      const stated = [...behaviour.matchAll(/\d+(?:\.\d+)?/g)].map(([d]) => Number(d));
      for (const n of stated) expect(params, `${name}: ${n} in "${behaviour}"`).toContain(n);
      const statedAll = [...stated, ...statedWords(behaviour)];
      for (const v of params) expect(statedAll, `${name}: param ${v} not in "${behaviour}"`).toContain(v);
    });
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

  it('space mobs match every column of DESIGN 12.7: tier, behaviour, the ships it names, its numbers and counter', () => {
    const rows = designTable('12.7 Space');
    const space = MOBS.filter((m) => m.group === 'space');
    expect(rows.map((r) => r[0])).toEqual(space.map((m) => m.name));
    const hullByName = Object.fromEntries(HULLS.map((h) => [h.name, h.id]));
    rows.forEach(([name, tier, behaviour, counter], i) => {
      const m = space[i];
      expect(m.text, name).toBe(behaviour);
      expect(m.counter?.text ?? '', name).toBe(counter);
      if (tier === 'event') expect(m.event, name).toBe(true);
      else if (tier.startsWith('Act ')) {
        expect(m.act, name).toBe({ I: 1, II: 2, III: 3, IV: 4 }[tier.slice(4)]);
        expect(m.tier, name).toBeNull();
      } else {
        const [lo, hi] = tier.split('–').map(Number);
        expect(m.tier?.min, `${name} tier`).toBe(lo);
        if (hi !== undefined) expect(m.tier?.max, `${name} tier`).toBe(hi);
      }
      // the hulls it names, with their counts ("2 Darts", "3 Kestrels + 1 Bulwark", "Mules and Caravels with Kestrel escorts")
      const named = [...behaviour.matchAll(/(?:(\d+) )?(Dart|Kestrel|Bulwark|Ghost|Mule|Caravel)s?\b/g)];
      const ships = m.hulls.filter((h) => h.hull !== null);
      expect(new Set(ships.map((h) => h.hull)), name).toEqual(new Set(named.map(([, , hull]) => hullByName[hull])));
      for (const [, count, hull] of named)
        if (count) expect(ships.find((h) => h.hull === hullByName[hull])?.count, `${name}: ${count} ${hull}`).toBe(Number(count));
      const husked = /^(one husked ship|a full ship with no pilot)/.test(behaviour);
      expect(
        m.hulls.filter((h) => h.hull === null),
        name,
      ).toEqual(husked ? [{ hull: null, count: 1, husked: true }] : []);
      // the numbers its behaviour states
      const breakOff = behaviour.match(/break off at (\d+)% hull/);
      expect(m.params.breakOffAtHull, name).toBe(breakOff ? Number(breakOff[1]) / 100 : undefined);
      const within = behaviour.match(/within (\d+) km/);
      expect(m.params.aggroRadiusM, name).toBe(within ? Number(within[1]) * 1000 : undefined);
      const over = behaviour.match(/over (\d+) min/);
      expect(m.params.durationS, name).toBe(over ? Number(over[1]) * 60 : undefined);
    });
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
