// Resonance's client hooks (P1.E07.T06): the cast events the server sends make the client do its own part and nothing it would
// have to decide: the scan's reveal, the sites below, dropping out of a jammed pulse drive.
import { RESONANCE_NUMBERS, scanRanges } from '@astra/shared/abilities';
import { describe, expect, it, vi } from 'vitest';
import { playAbilityFx } from '../net/abilities.js';
import './resonanceFx.js';

const ME = 7;
const game = () => ({ net: { entityId: ME }, revealScan: vi.fn(), revealSites: vi.fn(), ship: { jam: vi.fn() } });
const event = (node, extra = {}) => ({ kind: 'cast', node, phase: 'cast', at: 1, frame: 'f:1', aim: [0, 0, -1], ...extra });

describe('Pulse', () => {
  it('is the scan: this player’s own cast reveals, another player’s does not', () => {
    const g = game();
    playAbilityFx(g, event('pulse', { caster: ME }));
    expect(g.revealScan).toHaveBeenCalledTimes(1);
    playAbilityFx(g, event('pulse', { caster: 9 }));
    expect(g.revealScan).toHaveBeenCalledTimes(1);
    playAbilityFx(g, event('pulse'));
    expect(g.revealScan).toHaveBeenCalledTimes(1);
  });

  it('is a party member’s too when the server marks it shared (Choir)', () => {
    const g = game();
    playAbilityFx(g, event('pulse', { caster: 9, shared: true }));
    expect(g.revealScan).toHaveBeenCalledTimes(1);
  });
});

describe('Deep Sweep', () => {
  it('shows the sites of the world it named, for its own caster only', () => {
    const g = game();
    playAbilityFx(g, event('deep_sweep', { caster: ME }));
    expect(g.revealSites).toHaveBeenCalledWith('f:1');
    playAbilityFx(g, event('deep_sweep', { caster: 3 }));
    expect(g.revealSites).toHaveBeenCalledTimes(1);
  });
});

describe('Jammer', () => {
  it('takes the pulse drive from the ship it names, for the lockout, and from no other', () => {
    const g = game();
    playAbilityFx(g, event('jammer', { caster: 3, target: ME }));
    expect(g.ship.jam).toHaveBeenCalledWith(RESONANCE_NUMBERS.jammer.lockoutS);
    playAbilityFx(g, event('jammer', { caster: 3, target: 5 }));
    playAbilityFx(g, event('jammer', { caster: ME }));
    expect(g.ship.jam).toHaveBeenCalledTimes(1);
  });
});

describe('Long Ear', () => {
  it('doubles the scan’s reach: deposits 360 m and sites 6 km, from 180 m and 3 km', () => {
    expect(scanRanges([])).toEqual({ depositM: 180, siteM: 3000 });
    expect(scanRanges(['long_ear'])).toEqual({ depositM: 360, siteM: 6000 });
    expect(scanRanges(['pulse', 'choir'])).toEqual({ depositM: 180, siteM: 3000 });
  });
});
