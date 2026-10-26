// Golden resource-node counts per world type at seed 424242 (P1.E13.T02): for the first world of every rocky archetype
// in the 70-system galaxy, the node layers it carries at every tier and the nodes over a fixed sample of its cells
// (fixture written as resource-nodes-fixture.ts says). Every value must come out exactly as written: the same draws in
// the same order and the same float arithmetic, so the server places exactly the nodes the client draws.
import { describe, expect, it } from 'vitest';
import { NODE_ROCKY_WORLDS, nodeType, tierWeight } from '../src/world/index.ts';
import fixture from './fixtures/resource-nodes-424242.json';
import world from './fixtures/world-424242.json';
import { SAMPLE_CELLS, nodeEntry, nodeWorlds } from './resource-nodes-fixture.ts';

describe('resource nodes golden fixture, seed 424242', () => {
  it('samples the first world of every rocky archetype in the game galaxy, at every tier 0–5', () => {
    expect(fixture.seed).toBe(world.seed);
    expect(fixture.cellsPerWorld).toBe(SAMPLE_CELLS);
    expect(fixture.worlds.map((w) => w.type)).toEqual(NODE_ROCKY_WORLDS);
    const worlds = nodeWorlds();
    expect(fixture.worlds.map(({ type, system, body, name, seed, radius, systemTier }) => ({ type, system, body, name, seed, radius, systemTier }))).toEqual(
      worlds,
    );
    for (const w of fixture.worlds) expect(w.tiers.map((t) => t.tier)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("places each hostile world's formation there, common from its resource's tier and rare short of it", () => {
    const formation: Record<string, string> = {
      frozen: 'frostglass',
      toxic: 'acidsalt',
      corrosive: 'acidsalt',
      volcanic: 'cinderglass',
      inferno: 'cinderglass',
      storm: 'stormquartz',
      irradiated: 'gamma_crystal',
      crushing: 'murkpearl',
    };
    for (const w of fixture.worlds) {
      const f = formation[w.type];
      for (const t of w.tiers) {
        const counts = t.counts as Record<string, number>;
        expect(
          Object.values(counts).reduce((a, b) => a + b, 0),
          `${w.type} tier ${t.tier}`,
        ).toBe(t.total);
        // two of the four deposits on every world
        expect(
          Object.keys(counts).filter((k) => nodeType(k).kind === 'deposit'),
          `${w.type} tier ${t.tier}`,
        ).toHaveLength(2);
        if (!f) {
          expect(
            Object.keys(counts).filter((k) => nodeType(k).kind === 'formation'),
            w.type,
          ).toEqual([]);
          continue;
        }
        const ty = nodeType(f);
        expect((t.layers as Record<string, number>)[f]).toBe(ty.place.density * tierWeight(ty.tierMin, t.tier));
        if (t.tier >= ty.tierMin) expect(counts[f], `${f} on ${w.type} at tier ${t.tier}`).toBeGreaterThan(10);
      }
      if (f) {
        const ty = nodeType(f);
        const at = (tier: number) => (w.tiers[tier].counts as Record<string, number>)[f];
        expect(at(ty.tierMin - 1), `${f} a tier short`).toBeLessThan(at(ty.tierMin) / 2);
      }
    }
  });

  it('gives the resource plants to the living worlds only', () => {
    const living = new Set(['lush', 'alien', 'desert', 'frozen', 'toxic', 'volcanic', 'storm']);
    for (const w of fixture.worlds) {
      const counts = w.tiers[0].counts as Record<string, number>;
      expect('sodium' in counts && 'oxygen' in counts, w.type).toBe(living.has(w.type));
      if (living.has(w.type)) expect(counts.sodium + counts.oxygen, w.type).toBeGreaterThan(50);
    }
  });

  describe.each(fixture.worlds)('$type world $name', (entry) => {
    it('layers, node counts and the nodes themselves at every tier', () => {
      const w = nodeWorlds().find((x) => x.type === entry.type)!;
      expect(nodeEntry(w)).toEqual(entry);
    });
  });
});
