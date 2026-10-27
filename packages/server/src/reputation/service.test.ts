// The reputation service (P2.E18.T01, ARCHITECTURE §24): it holds the characters in play; a grant moves one faction held
// to 0–1000 and tells the session its rank and title events, then its state; an act moves the opposed faction too; a gain
// earned by a counted action earns the underdog's bonus while the Count favours it; set is the admin CLI's; a quest's
// title is kept once; a character out of play is declined (null) and nothing is told; a listener that throws is logged.
import { describe, expect, it } from 'vitest';
import type { PersistenceLog } from '../persistence/registry.ts';
import { ReputationService, type ReputationPush } from './service.ts';

function logger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { log, lines };
}

function world(count?: () => number) {
  const { log, lines } = logger();
  const rep = new ReputationService({ log, ...(count ? { count } : {}) });
  const pushes: { character: string; push: ReputationPush }[] = [];
  rep.subscribe((character, push) => pushes.push({ character, push }));
  rep.open('c1');
  return { rep, pushes, lines, last: () => pushes.at(-1)!.push };
}

const standing = (push: ReputationPush, faction: string) => push.state.factions.find((f) => f.faction === faction)!;

describe('the reputation service', () => {
  it('moves one faction’s standing, tells a rank reached and its title, then the state', () => {
    const w = world();
    expect(w.rep.grant('c1', 'compact', 150, { reason: 'quest:a' })).toMatchObject({ from: 0, to: 150, rankFrom: null, rankTo: null });
    expect(w.last().events).toEqual([]);
    expect(standing(w.last(), 'compact')).toEqual({ faction: 'compact', rep: 150, rank: null });

    expect(w.rep.grant('c1', 'compact', 60, { reason: 'quest:wing_over_rolis_iii' })).toMatchObject({ from: 150, to: 210, rankTo: 'hand' });
    expect(w.last().events).toEqual([
      { kind: 'rank', faction: 'compact', rank: 'hand', from: null },
      { kind: 'title', title: { title: 'Hand', faction: 'compact' } },
    ]);
    expect(w.last().state.titles).toEqual([{ title: 'Hand', faction: 'compact' }]);
    expect(w.rep.rankOf('c1', 'compact')).toBe('hand');
    expect(w.rep.meetsRank('c1', 'compact', 'hand')).toBe(true);
    expect(w.rep.meetsRank('c1', 'compact', 'factor')).toBe(false);
    expect(w.lines).toContainEqual(
      expect.objectContaining({ level: 'info', msg: 'rank changed', obj: expect.objectContaining({ reason: 'quest:wing_over_rolis_iii' }) }),
    );

    // a loss below the threshold loses the rank, not the title
    w.rep.grant('c1', 'compact', -20, { reason: 'test' });
    expect(w.last().events).toEqual([{ kind: 'rank', faction: 'compact', rank: null, from: 'hand' }]);
    expect(w.last().state.titles).toEqual([{ title: 'Hand', faction: 'compact' }]);
    expect(w.rep.rankOf('c1', 'compact')).toBeNull();
  });

  it('holds standing to 0 and 1000, telling nothing when nothing moved', () => {
    const w = world();
    w.rep.grant('c1', 'chorus', 2000, { reason: 'test' });
    expect(w.rep.standing('c1', 'chorus')).toBe(1000);
    expect(w.last().events.filter((e) => e.kind === 'title')).toHaveLength(3);
    const n = w.pushes.length;
    expect(w.rep.grant('c1', 'chorus', 5, { reason: 'test' })).toMatchObject({ from: 1000, to: 1000 });
    expect(w.rep.grant('c1', 'reaches', -5, { reason: 'test' })).toMatchObject({ from: 0, to: 0 });
    expect(w.pushes).toHaveLength(n);
    w.rep.grant('c1', 'chorus', -5000, { reason: 'test' });
    expect(w.rep.standing('c1', 'chorus')).toBe(0);
  });

  it('applies an act to both sides: the side helped gains, the opposed side loses, in one push', () => {
    const w = world();
    w.rep.set('c1', 'compact', 210);
    const n = w.pushes.length;
    const changes = w.rep.act('c1', 'convoy_raided')!;
    expect(changes.map((c) => [c.faction, c.from, c.to])).toEqual([
      ['reaches', 0, 50],
      ['compact', 210, 185],
    ]);
    expect(w.pushes).toHaveLength(n + 1);
    expect(w.last().events).toEqual([{ kind: 'rank', faction: 'compact', rank: null, from: 'hand' }]);
    expect(standing(w.last(), 'reaches').rep).toBe(50);
    w.rep.act('c1', 'convoy_escorted', { scale: 2 });
    expect([w.rep.standing('c1', 'compact'), w.rep.standing('c1', 'reaches')]).toEqual([285, 0]);
    expect(() => w.rep.act('c1', 'convoy_escorted', { scale: -1 })).toThrow(RangeError);
  });

  it('pays the underdog’s bonus on gains a counted action earned while the Count favours its side, never on losses', () => {
    let count = 800;
    const w = world(() => count);
    // Break pulls a high Count back: its gain is ×1.5, the loss it costs is not
    w.rep.act('c1', 'convoy_raided', { counted: 'break' });
    expect([w.rep.standing('c1', 'reaches'), w.rep.standing('c1', 'compact')]).toEqual([75, 0]);
    w.rep.grant('c1', 'compact', 100, { reason: 'test', counted: 'feed' });
    expect(w.rep.standing('c1', 'compact')).toBe(100);
    w.rep.grant('c1', 'compact', -10, { reason: 'test', counted: 'break' });
    expect(w.rep.standing('c1', 'compact')).toBe(90);
    // in the middle: no bonus
    count = 500;
    w.rep.grant('c1', 'chorus', 100, { reason: 'test', counted: 'hold' });
    expect(w.rep.standing('c1', 'chorus')).toBe(100);
    // uncounted gains: never
    count = 100;
    w.rep.grant('c1', 'chorus', 100, { reason: 'test' });
    expect(w.rep.standing('c1', 'chorus')).toBe(200);
    w.rep.grant('c1', 'chorus', 100, { reason: 'test', counted: 'feed' });
    expect(w.rep.standing('c1', 'chorus')).toBe(350);
  });

  it('sets standing for the admin CLI, earning the titles of the ranks risen through', () => {
    const w = world();
    expect(w.rep.set('c1', 'belost', 600)).toMatchObject({ from: 0, to: 600, rankTo: 'neighbour', titles: [{ title: 'Guest' }, { title: 'Neighbour' }] });
    expect(w.last().events.map((e) => e.kind)).toEqual(['rank', 'title', 'title']);
    expect(w.rep.set('c1', 'belost', 5000)!.to).toBe(1000);
  });

  it('keeps a quest’s title once', () => {
    const w = world();
    expect(w.rep.earnTitle('c1', 'Unlisted', 'forty_names')).toBe(true);
    expect(w.last().events).toEqual([{ kind: 'title', title: { title: 'Unlisted', quest: 'forty_names' } }]);
    const n = w.pushes.length;
    expect(w.rep.earnTitle('c1', 'Unlisted', 'forty_names')).toBe(false);
    expect(w.pushes).toHaveLength(n);
    expect(w.rep.get('c1')!.titles).toEqual([{ title: 'Unlisted', quest: 'forty_names' }]);
  });

  it('declines a character out of play and tells nothing; a listener that throws is logged', () => {
    const w = world();
    const n = w.pushes.length;
    expect(w.rep.grant('nobody', 'compact', 10, { reason: 'test' })).toBeNull();
    expect(w.rep.act('nobody', 'convoy_raided')).toBeNull();
    expect(w.rep.set('nobody', 'compact', 10)).toBeNull();
    expect(w.rep.earnTitle('nobody', 'X')).toBeNull();
    expect(w.rep.rankOf('nobody', 'compact')).toBeNull();
    expect(w.rep.view('nobody')).toBeUndefined();
    expect(w.pushes).toHaveLength(n);

    w.rep.subscribe(() => {
      throw new Error('boom');
    });
    w.rep.grant('c1', 'quavel', 5, { reason: 'test' });
    expect(w.rep.standing('c1', 'quavel')).toBe(5);
    expect(w.lines).toContainEqual(expect.objectContaining({ level: 'error', msg: 'reputation listener failed' }));
    expect(w.rep.close('c1')).toBe(true);
    expect(w.rep.holds('c1')).toBe(false);
  });

  it('holds its own copy of what it was opened with', () => {
    const w = world();
    const stored = { rep: { compact: 10 }, titles: [] };
    w.rep.open('c2', stored);
    w.rep.grant('c2', 'compact', 5, { reason: 'test' });
    expect(stored.rep.compact).toBe(10);
    expect(w.rep.get('c2')!.rep.compact).toBe(15);
  });
});
