// What a cast names and what the wire holds of a character's abilities (P1.E07.T03): every cooldown the web can run at
// once, and every toggle its bars can hold, fit the `abilities` state.
import { describe, expect, it } from 'vitest';
import { COOLDOWNS_MAX, cooldownOf, TOGGLES_MAX } from '../src/abilities/index.ts';
import { SKILL_NODES } from '../src/data/index.ts';
import { encodeServerMessage } from '../src/protocol/index.ts';
import { GROUND_SLOTS, SHIP_SLOTS } from '../src/skills/index.ts';

describe('the abilities state', () => {
  it('holds a cooldown on every clock of the web at once, and a toggle in every slot of both bars', () => {
    const clocks = new Set<string>();
    for (const n of SKILL_NODES) if (n.slot !== null && n.cooldown && n.cooldown.kind !== 'once_per') clocks.add(cooldownOf(n)!.key);
    expect(clocks.size).toBe(COOLDOWNS_MAX);
    expect(TOGGLES_MAX).toBe(GROUND_SLOTS + SHIP_SLOTS);
    const actives = SKILL_NODES.filter((n) => n.slot !== null).map((n) => n.id);
    const cooldowns = [...clocks].map((node, i) => ({ node, readyAt: 100 + i }));
    const full = { t: 'abilities' as const, cooldowns, on: actives.slice(0, TOGGLES_MAX) };
    expect(() => encodeServerMessage(full)).not.toThrow();
    expect(() => encodeServerMessage({ ...full, cooldowns: [...cooldowns, { node: 'pulse', readyAt: 1 }] })).toThrow();
    expect(() => encodeServerMessage({ ...full, on: actives.slice(0, TOGGLES_MAX + 1) })).toThrow();
  });
});
