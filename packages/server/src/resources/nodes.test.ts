// The touched-node store (P1.E13.T01): damage and who did it, healing and growing back in time order (one queue entry a
// node, re-queued when it pops early), versions unique over the store, and its bound: past it the node due soonest comes
// back early to make room.
import { nodeType, type NodeCell, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { cellKey, HEAL_S, MAX_CONTRIBUTORS, NodeStore, SHOWN_STEPS, type CellState } from './nodes.ts';

const params = { seed: 1, radius: 30_000 } as PlanetParams;
const cell = (i: number, j = 0): NodeCell => ({ face: 2, i, j, level: 9 });
const copper = nodeType('copper');
const sodium = nodeType('sodium');

describe('NodeStore', () => {
  it('holds a node from its first touch: damage by character, capped at its hp; the shown fraction moves in steps', () => {
    const s = new NodeStore();
    const changed = new Set<CellState>();
    const n = s.touch('7:1', params, cell(3), copper, 2, 100, changed);
    expect(n).toMatchObject({ id: '2_3_0_copper_2', sub: 'copper_2', hp: copper.hp, respawnAt: null, shown: 1 });
    expect(s.touch('7:1', params, cell(3), copper, 2, 101, changed)).toBe(n);
    expect(s.size).toBe(1);
    const v0 = n.cell.version;
    expect(s.damage(n, 'a', 0.1, 100, changed)).toBe(false);
    // 3.9 of 4 left: still shown whole (rounded up to the step)
    expect(n.shown).toBe(1);
    expect(n.cell.version).toBe(v0);
    expect(s.damage(n, 'b', 1, 100, changed)).toBe(false);
    expect(n.shown).toBe(Math.ceil((2.9 / 4) * SHOWN_STEPS) / SHOWN_STEPS);
    expect(n.cell.version).toBeGreaterThan(v0);
    expect(changed.has(n.cell)).toBe(true);
    expect(s.damage(n, 'a', 10, 100, changed)).toBe(true);
    expect(n.hp).toBe(0);
    expect([...n.by]).toEqual([
      ['a', 0.1 + 2.9],
      ['b', 1],
    ]);
  });

  it('counts at most MAX_CONTRIBUTORS characters’ damage; others still damage it', () => {
    const s = new NodeStore();
    const n = s.touch('7:1', params, cell(3), nodeType('gamma_crystal'), 0, 0, new Set());
    for (let i = 0; i < MAX_CONTRIBUTORS + 3; i++) s.damage(n, `c${i}`, 0.1, 0, new Set());
    expect(n.by.size).toBe(MAX_CONTRIBUTORS);
    expect(n.hp).toBeCloseTo(nodeType('gamma_crystal').hp - 0.1 * (MAX_CONTRIBUTORS + 3), 9);
  });

  it('heals HEAL_S after the last hit, and grows back at its respawn time, in time order', () => {
    const s = new NodeStore();
    const changed = new Set<CellState>();
    const a = s.touch('7:1', params, cell(1), copper, 0, 0, changed);
    const b = s.touch('7:1', params, cell(1), sodium, 0, 0, changed);
    const c = s.touch('7:1', params, cell(2), copper, 0, 0, changed);
    s.damage(a, 'x', 1, 0, changed);
    s.damage(b, 'x', 1, 0, changed);
    s.broke(b, 500, changed);
    s.damage(c, 'x', 1, 0, changed);
    // a is hit again later: it heals HEAL_S after that
    s.damage(a, 'x', 1, 30, changed);
    changed.clear();
    s.advance(HEAL_S + 1, changed);
    expect(s.get('7:1', cell(2), 'copper_0')).toBeUndefined();
    expect(s.get('7:1', cell(1), 'copper_0')).toBe(a);
    expect([...changed].map((x) => x.id)).toEqual(['2_2_0']);
    // the empty cell is gone; the world keeps the other
    expect(s.cellsOf('7:1')!.has(cellKey(cell(2)))).toBe(false);
    s.advance(30 + HEAL_S + 1, changed);
    expect(s.get('7:1', cell(1), 'copper_0')).toBeUndefined();
    expect(s.get('7:1', cell(1), 'sodium_0')).toBe(b);
    s.advance(499, changed);
    expect(s.size).toBe(1);
    s.advance(500, changed);
    expect(s.size).toBe(0);
    expect(s.world('7:1')).toBeUndefined();
    // one entry each, the stale ones skipped: nothing is left queued
    expect(s.queued).toBe(0);
  });

  it('a respawn sooner than the heal it replaces is queued again (the earlier time wins)', () => {
    const s = new NodeStore();
    const n = s.touch('7:1', params, cell(1), copper, 0, 0, new Set());
    s.damage(n, 'x', 4, 0, new Set());
    s.broke(n, 5, new Set());
    s.advance(5, new Set());
    expect(s.size).toBe(0);
  });

  it('gives every change a version no cell has had before, so a cell that goes and comes back is told apart', () => {
    const s = new NodeStore();
    const changed = new Set<CellState>();
    const n = s.touch('7:1', params, cell(1), copper, 0, 0, changed);
    s.damage(n, 'x', 2, 0, changed);
    const v1 = n.cell.version;
    s.advance(HEAL_S + 1, changed);
    const m = s.touch('7:1', params, cell(1), copper, 0, 100, changed);
    expect(m.cell).not.toBe(n.cell);
    expect(m.cell.version).toBeGreaterThan(v1);
    expect(s.version).toBeGreaterThan(m.cell.version);
  });

  it('bounded: a new node past the cap brings back the one due soonest', () => {
    const s = new NodeStore(3);
    const changed = new Set<CellState>();
    const at = [50, 10, 30];
    const nodes = at.map((t, i) => {
      const n = s.touch('7:1', params, cell(i), copper, 0, 0, changed);
      s.damage(n, 'x', 4, 0, changed);
      s.broke(n, t, changed);
      return n;
    });
    changed.clear();
    s.touch('7:1', params, cell(9), copper, 0, 0, changed);
    expect(s.size).toBe(3);
    expect(s.get('7:1', cell(1), 'copper_0')).toBeUndefined();
    expect(s.get('7:1', cell(0), 'copper_0')).toBe(nodes[0]);
    expect([...changed].map((c) => c.id)).toEqual([nodes[1]!.cell.id]);
    s.clear(changed);
    expect(s.size).toBe(0);
  });

  it('cell keys are exact and distinct over a world’s whole grid', () => {
    const level = 15;
    const n = 2 ** level;
    expect(cellKey({ face: 5, i: n - 1, j: n - 1, level })).toBe(6 * n * n - 1);
    expect(Number.isSafeInteger(cellKey({ face: 5, i: n - 1, j: n - 1, level }))).toBe(true);
    expect(cellKey({ face: 1, i: 0, j: 0, level })).toBe(cellKey({ face: 0, i: n - 1, j: n - 1, level }) + 1);
  });
});
