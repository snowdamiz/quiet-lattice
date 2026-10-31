// Reputation's shared rules (P2.E18.T01, DESIGN 14.4): standing per faction held to 0–1000, ranks at 200, 500 and 800 that
// follow standing both ways, each rank's title earned the first time it is reached and kept for good (held by its rank,
// the three cities' alike-named ranks apart), quests' titles once each (one naming a rank's title is that rank's, so a
// chain's last quest never adds a second), the opposed acts DESIGN names with their Count tags, the stored value
// reconciled with the faction table, the schemas' bounds and the view the client is sent.
import { describe, expect, it } from 'vitest';
import { FACTION_IDS, FACTION_RULES, FACTIONS } from '../src/data/index.ts';
import {
  clampRep,
  earnTitle,
  emptyReputation,
  meetsRank,
  moveStanding,
  questTitle,
  rankIdAt,
  rankOfTitle,
  reconcileReputation,
  REP_ACT_IDS,
  REP_ACTS,
  REP_MAX,
  REP_MIN,
  reputationSchema,
  reputationView,
  reputationViewSchema,
  setStanding,
  standingOf,
  titleName,
  TITLES_MAX,
  type RepAct,
  type Reputation,
} from '../src/reputation/index.ts';

const at = (rep: Partial<Record<string, number>>): Reputation => ({ rep: { ...rep } as Reputation['rep'], titles: [] });

describe('reputation: standing and ranks', () => {
  it('runs 0–1000 per faction (DESIGN 14.4), none at 0, and holds every change to those bounds', () => {
    expect([REP_MIN, REP_MAX]).toEqual([0, 1000]);
    const r = emptyReputation();
    expect(standingOf(r, 'compact')).toBe(0);
    expect(moveStanding(r, 'compact', 990)).toMatchObject({ from: 0, to: 990 });
    expect(moveStanding(r, 'compact', 50)).toMatchObject({ from: 990, to: 1000 });
    expect(moveStanding(r, 'compact', 1)).toMatchObject({ from: 1000, to: 1000 });
    expect(moveStanding(r, 'reaches', -25)).toMatchObject({ from: 0, to: 0 });
    expect(moveStanding(r, 'compact', -1200)).toMatchObject({ from: 1000, to: 0 });
    expect(setStanding(r, 'chorus', 4000).to).toBe(1000);
    expect(setStanding(r, 'chorus', -3).to).toBe(0);
    // whole points: a bonus of 1.5 rounds
    expect(moveStanding(r, 'belost', 37.5).to).toBe(38);
    expect([clampRep(-0.4), clampRep(1000.4), clampRep(499.5)]).toEqual([0, 1000, 500]);
    expect(reputationSchema.safeParse(r).success).toBe(true);
  });

  it('ranks at exactly 200, 500 and 800 for every faction (the data tables’ thresholds)', () => {
    expect(FACTION_RULES.rankThresholds).toEqual([200, 500, 800]);
    for (const f of FACTIONS) {
      expect(f.ranks.map((r) => r.rep)).toEqual([200, 500, 800]);
      const [first, second, third] = f.ranks.map((r) => r.id);
      expect([0, 199, 200, 499, 500, 799, 800, 1000].map((rep) => rankIdAt(f.id, rep))).toEqual([null, null, first, first, second, second, third, third]);
    }
    expect(meetsRank(at({ compact: 499 }), 'compact', 'factor')).toBe(false);
    expect(meetsRank(at({ compact: 500 }), 'compact', 'factor')).toBe(true);
    expect(meetsRank(at({ compact: 500 }), 'compact', 'hand')).toBe(true);
    expect(meetsRank(at({ compact: 1000 }), 'compact', 'no_such_rank')).toBe(false);
  });

  it('reports the rank reached or lost, and follows standing down as well as up', () => {
    const r = at({ compact: 199 });
    expect(moveStanding(r, 'compact', 1)).toMatchObject({ from: 199, to: 200, rankFrom: null, rankTo: 'hand' });
    expect(moveStanding(r, 'compact', -1)).toMatchObject({ from: 200, to: 199, rankFrom: 'hand', rankTo: null, titles: [] });
    expect(moveStanding(r, 'compact', 300)).toMatchObject({ from: 199, to: 499, rankFrom: null, rankTo: 'hand' });
    expect(moveStanding(r, 'compact', 1)).toMatchObject({ to: 500, rankFrom: 'hand', rankTo: 'factor' });
    expect(moveStanding(r, 'compact', 10)).toMatchObject({ rankFrom: 'factor', rankTo: 'factor', titles: [] });
  });
});

describe('reputation: titles', () => {
  it('earns a rank’s title the first time the rank is reached, every rank passed on the way, and keeps them when standing falls', () => {
    const r = emptyReputation();
    expect(moveStanding(r, 'compact', 199).titles).toEqual([]);
    expect(moveStanding(r, 'compact', 1).titles).toEqual([{ faction: 'compact', rank: 'hand' }]);
    expect(moveStanding(r, 'compact', -200).titles).toEqual([]);
    // reached again: nothing more
    expect(moveStanding(r, 'compact', 200).titles).toEqual([]);
    // one jump through two thresholds earns both, lowest first
    expect(setStanding(r, 'compact', 850).titles).toEqual([
      { faction: 'compact', rank: 'factor' },
      { faction: 'compact', rank: 'lanewarden' },
    ]);
    setStanding(r, 'compact', 0);
    expect(r.titles.map(titleName)).toEqual(['Hand', 'Factor', 'Lanewarden']);
  });

  it('holds a rank’s title by its rank, the three cities’ alike-named ranks apart, and a quest’s title once by its name', () => {
    const r = emptyReputation();
    setStanding(r, 'sarelun', 200);
    setStanding(r, 'belost', 200);
    expect(r.titles).toEqual([
      { faction: 'sarelun', rank: 'guest' },
      { faction: 'belost', rank: 'guest' },
    ]);
    expect(r.titles.map(titleName)).toEqual(['Guest', 'Guest']);
    expect(earnTitle(r, { title: 'Unlisted', quest: 'forty_names' })).toBe(true);
    expect(earnTitle(r, { title: 'Unlisted', quest: 'another' })).toBe(false);
    expect(r.titles).toHaveLength(3);
    expect(reputationSchema.safeParse(r).success).toBe(true);
  });

  it('gives a quest’s title that names a rank’s as that rank’s, so a chain’s last quest never adds a second one', () => {
    // a unique name is its rank's; a city's is the rank of the faction the quest pays, else stays the quest's own
    expect(rankOfTitle('Hand')).toEqual({ faction: 'compact', rank: 'hand' });
    expect(rankOfTitle("Captain's Ear", ['compact'])).toEqual({ faction: 'reaches', rank: 'captains_ear' });
    expect(rankOfTitle('Guest')).toBeNull();
    expect(rankOfTitle('Guest', ['belost', 'compact'])).toEqual({ faction: 'belost', rank: 'guest' });
    expect(rankOfTitle('Guest', ['belost', 'sarelun'])).toBeNull();
    expect(rankOfTitle('Unlisted', ['compact'])).toBeNull();
    expect(questTitle('Hand', 'compact_chain_1')).toEqual({ faction: 'compact', rank: 'hand' });
    expect(questTitle('Unlisted', 'forty_names')).toEqual({ title: 'Unlisted', quest: 'forty_names' });

    // the threshold first, then the chain's last quest naming its title: held once
    const r = emptyReputation();
    setStanding(r, 'compact', 200);
    expect(earnTitle(r, questTitle('Hand', 'compact_chain_1', ['compact']))).toBe(false);
    // even a quest's title of that name it cannot place is held already
    expect(earnTitle(r, { title: 'Hand', quest: 'odd' })).toBe(false);
    expect(r.titles).toEqual([{ faction: 'compact', rank: 'hand' }]);

    // the quest first, then the threshold: the rank's title, once
    const q = emptyReputation();
    expect(earnTitle(q, questTitle('Guest', 'belost_chain_1', ['belost']))).toBe(true);
    expect(setStanding(q, 'belost', 250).titles).toEqual([]);
    expect(q.titles).toEqual([{ faction: 'belost', rank: 'guest' }]);
    // a quest's title it could not place takes the rank's place once the rank names it
    const u = emptyReputation();
    expect(earnTitle(u, { title: 'Guest', quest: 'a_city_job' })).toBe(true);
    expect(setStanding(u, 'quavel', 200).titles).toEqual([{ faction: 'quavel', rank: 'guest' }]);
    expect(u.titles).toEqual([{ faction: 'quavel', rank: 'guest' }]);
  });

  it('keeps at most TITLES_MAX titles', () => {
    const r = emptyReputation();
    for (let i = 0; i < TITLES_MAX; i++) expect(earnTitle(r, { title: `T${i}` })).toBe(true);
    expect(earnTitle(r, { title: 'One more' })).toBe(false);
    expect(setStanding(r, 'chorus', 1000).titles).toEqual([]);
    expect(r.titles).toHaveLength(TITLES_MAX);
  });
});

describe('reputation: acts against an opposed faction', () => {
  it('raiding a convoy costs Compact rep, escorting one costs Reaches rep (DESIGN 14.4), each act with its Count tag', () => {
    expect(REP_ACT_IDS.sort()).toEqual(['convoy_escorted', 'convoy_raided']);
    const sign = (act: RepAct) => Object.fromEntries(REP_ACTS[act].deltas.map((d) => [d.faction, Math.sign(d.amount)]));
    expect(sign('convoy_raided')).toEqual({ reaches: 1, compact: -1 });
    expect(sign('convoy_escorted')).toEqual({ compact: 1, reaches: -1 });
    // (P2.E22.T01's counted actions: a convoy escorted Feeds, one raided Breaks)
    expect([REP_ACTS.convoy_escorted.counted, REP_ACTS.convoy_raided.counted]).toEqual(['feed', 'break']);
    for (const act of REP_ACT_IDS) {
      const [gain, loss] = REP_ACTS[act].deltas;
      // the side helped gains, the side gone against loses (less than the gain: a pilot who changes sides is never locked out)
      expect(gain!.amount).toBeGreaterThan(0);
      expect(loss!.amount).toBeLessThan(0);
      expect(-loss!.amount).toBeLessThan(gain!.amount);
      for (const d of REP_ACTS[act].deltas) expect(FACTION_IDS).toContain(d.faction);
    }
    expect(Object.isFrozen(REP_ACTS.convoy_raided.deltas)).toBe(true);
  });
});

describe('reputation: stored values', () => {
  it('drops standing with a faction the table no longer has, and the titles of ranks it no longer has; keeps the rest as it is', () => {
    const fine = at({ compact: 300, belost: 30 });
    fine.titles.push({ faction: 'compact', rank: 'hand' });
    expect(reconcileReputation(fine)).toEqual({ reputation: fine, dropped: [] });
    expect(reconcileReputation(fine).reputation).toBe(fine);

    const old = reputationSchema.parse({
      rep: { compact: 300, quiet_table: 900, old_guild: 10 },
      titles: [
        { faction: 'compact', rank: 'hand' },
        { faction: 'quiet_table', rank: 'whisper' },
        { faction: 'compact', rank: 'old_rank' },
        { title: 'Unlisted', quest: 'forty_names' },
      ],
    });
    const r = reconcileReputation(old);
    expect(r.dropped).toEqual(['compact:old_rank', 'old_guild', 'quiet_table']);
    expect(r.reputation).toEqual({
      rep: { compact: 300 },
      titles: [
        { faction: 'compact', rank: 'hand' },
        { title: 'Unlisted', quest: 'forty_names' },
      ],
    });
  });

  it('refuses what no rule writes: standing out of 0–1000 or fractional, a title held twice or of a rank and a quest at once', () => {
    const bad = [
      { rep: { compact: 1001 }, titles: [] },
      { rep: { compact: -1 }, titles: [] },
      { rep: { compact: 2.5 }, titles: [] },
      { rep: { 'Not An Id': 5 }, titles: [] },
      {
        rep: {},
        titles: [
          { faction: 'compact', rank: 'hand' },
          { faction: 'compact', rank: 'hand' },
        ],
      },
      {
        rep: {},
        titles: [{ title: 'Unlisted' }, { title: 'Unlisted', quest: 'q' }],
      },
      { rep: {}, titles: [{ faction: 'compact', rank: 'hand', quest: 'q' }] },
      { rep: {}, titles: [{ title: 'Hand', faction: 'compact' }] },
      { rep: {}, titles: [{ title: '' }] },
      { rep: {}, titles: [], extra: true },
      { rep: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`f${i}`, 1])), titles: [] },
    ];
    for (const b of bad) expect(reputationSchema.safeParse(b).success, JSON.stringify(b).slice(0, 80)).toBe(false);
  });

  it('shows every faction of the table, in its order, with its standing and rank, and the titles by name', () => {
    const r = at({ belost: 230, compact: 800 });
    r.titles.push({ faction: 'belost', rank: 'guest' }, { faction: 'quiet_table', rank: 'whisper' });
    earnTitle(r, { title: 'Unlisted', quest: 'forty_names' });
    const v = reputationView(r);
    expect(reputationViewSchema.parse(v)).toEqual(v);
    expect(v.factions.map((f) => f.faction)).toEqual([...FACTION_IDS]);
    expect(v.factions.find((f) => f.faction === 'belost')).toEqual({ faction: 'belost', rep: 230, rank: 'guest' });
    expect(v.factions.find((f) => f.faction === 'compact')).toEqual({ faction: 'compact', rep: 800, rank: 'lanewarden' });
    expect(v.factions.find((f) => f.faction === 'chorus')).toEqual({ faction: 'chorus', rep: 0, rank: null });
    // (a rank the table does not have is not shown)
    expect(v.titles).toEqual([
      { title: 'Guest', faction: 'belost', rank: 'guest' },
      { title: 'Unlisted', quest: 'forty_names' },
    ]);
    // the wire refuses a faction the table lacks, standing past 1000, and a rank's title without its rank
    expect(reputationViewSchema.safeParse({ factions: [{ faction: 'old_guild', rep: 1, rank: null }], titles: [] }).success).toBe(false);
    expect(reputationViewSchema.safeParse({ factions: [{ faction: 'compact', rep: 1001, rank: null }], titles: [] }).success).toBe(false);
    expect(reputationViewSchema.safeParse({ factions: [], titles: [{ title: 'Hand', faction: 'compact' }] }).success).toBe(false);
  });
});
