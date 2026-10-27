// The client's reputation (P2.E18.T01, ARCHITECTURE §24): it keeps the view the server last sent, the rank and title news
// for the screens to take, and logs each change, never the state as loaded; and Net keeps one.
import { describe, expect, it } from 'vitest';
import { Net } from './Net.js';
import { NEWS_KEPT, Reputation } from './reputation.js';

function fakeNet() {
  const handlers = new Map();
  return {
    on(t, fn) {
      handlers.set(t, [...(handlers.get(t) ?? []), fn]);
    },
    push(m) {
      for (const fn of handlers.get(m.t) ?? []) fn(m);
    },
  };
}

const view = (compact, titles = []) => ({
  factions: [
    { faction: 'compact', rep: compact, rank: compact >= 200 ? 'hand' : null },
    { faction: 'reaches', rep: 0, rank: null },
  ],
  titles,
});

describe('the client’s reputation', () => {
  it('keeps the server’s view and reads standing, ranks and titles from it', () => {
    const net = fakeNet();
    const lines = [];
    const r = new Reputation(net, { log: (l) => lines.push(l) });
    expect([r.view, r.standing('compact'), r.rank('compact'), r.titles]).toEqual([null, 0, null, []]);
    net.push({ t: 'reputation', reputation: view(150) });
    expect([r.standing('compact'), r.rank('compact'), r.rev]).toEqual([150, null, 1]);
    // the state as loaded is no change
    expect(lines).toEqual([]);

    net.push({ t: 'event', event: { kind: 'rank', faction: 'compact', rank: 'hand', from: null } });
    net.push({ t: 'event', event: { kind: 'title', title: { title: 'Hand', faction: 'compact', rank: 'hand' } } });
    net.push({ t: 'event', event: { kind: 'xp', amount: 5, from: null, level: 2 } });
    net.push({ t: 'reputation', reputation: view(210, [{ title: 'Hand', faction: 'compact' }]) });
    expect([r.standing('compact'), r.rank('compact'), r.titles]).toEqual([210, 'hand', [{ title: 'Hand', faction: 'compact' }]]);
    expect(lines).toEqual(['reputation: compact rank none -> hand', 'reputation: title earned: Hand (compact)', 'reputation: compact 150 -> 210 (hand)']);
    expect(r.take().map((e) => e.kind)).toEqual(['rank', 'title']);
    expect(r.take()).toEqual([]);
  });

  it('keeps only the latest news', () => {
    const net = fakeNet();
    const r = new Reputation(net, { log: () => {} });
    for (let i = 0; i < NEWS_KEPT + 5; i++) net.push({ t: 'event', event: { kind: 'title', title: { title: `T${i}` } } });
    const news = r.take();
    expect(news).toHaveLength(NEWS_KEPT);
    expect(news[0].title.title).toBe('T5');
  });

  it('is kept by Net', () => {
    const net = new Net({ url: 'ws://x', token: 't', characterId: 'c', WebSocket: class {} });
    expect(net.reputation).toBeInstanceOf(Reputation);
  });
});
