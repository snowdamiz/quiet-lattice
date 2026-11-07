import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../src/data/index.ts';
import { clearIneligibleSlots, emptySkillState, meetsNodeRequirements, slotNode, type SkillContext } from '../src/skills/index.ts';

describe('live skill requirements', () => {
  const context: SkillContext = { level: 16, shipSlots: 2, maxTier: 2, meets: () => false };

  it('refuses both bars and an already slotted gated node without changing earned state', () => {
    const state = emptySkillState();
    state.unlocked = ['phase', 'micro_jump'];
    state.bought = [...state.unlocked];
    state.slots.ground[0] = 'phase';
    state.fragments.void = { earned: 4, spent: 2 };
    deepFreeze(state);
    for (const [bar, node] of [
      ['ground', 'phase'],
      ['ship', 'micro_jump'],
    ] as const) {
      expect(slotNode(state, context, bar, 0, node)).toMatchObject({ ok: false, error: { code: 'requirement' } });
      expect(slotNode(state, { ...context, meets: () => true }, bar, 0, node).ok).toBe(true);
    }
    expect(meetsNodeRequirements('missing', () => true)).toBe(false);
    expect(meetsNodeRequirements('phase', () => false)).toBe(false);
    expect(meetsNodeRequirements('pull', () => false)).toBe(true);
  });

  it('clears only gated slots, including inactive hull slots, and retains purchases and spent fragments', () => {
    const state = emptySkillState();
    state.unlocked = ['phase', 'micro_jump', 'pull'];
    state.bought = [...state.unlocked];
    state.slots.ground[0] = 'phase';
    state.slots.ground[1] = 'pull';
    state.slots.ship[4] = 'micro_jump';
    state.fragments.void = { earned: 4, spent: 2 };
    deepFreeze(state);
    expect(clearIneligibleSlots(state, () => true)).toBe(state);
    const cleared = clearIneligibleSlots(state, () => false);
    expect(cleared).toEqual({ ...state, slots: { ground: [null, 'pull', null, null, null, null], ship: [null, null, null, null, null] } });
    expect(clearIneligibleSlots(cleared, () => false)).toBe(cleared);
    expect(clearIneligibleSlots(cleared, () => true)).toBe(cleared);
  });
});
