// Resonance's client hooks (P1.E07.T06): the cast events the server sends make the client do its own part and nothing it would
// have to decide: the scan's reveal, the sites below, dropping out of a jammed pulse drive.
import { RESONANCE_NUMBERS } from '@astra/shared/abilities';
import { scanRanges, suitMods } from '@astra/shared/exosuit';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Game } from '../Game.js';
import { Structures } from './Structures.js';
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
  it('doubles the scan’s reach through the suit’s modifiers: deposits 360 m and sites 6 km, from 180 m and 3 km', () => {
    expect(scanRanges(suitMods({ skills: [] }))).toEqual({ depositM: 180, siteM: 3000 });
    expect(scanRanges(suitMods({ skills: ['long_ear'] }))).toEqual({ depositM: 360, siteM: 6000 });
    expect(scanRanges(suitMods({ skills: ['pulse', 'choir'] }))).toEqual({ depositM: 180, siteM: 3000 });
  });

  it('puts Signal Beacons on the map for its owner and no other site: markers draw only the known ones', () => {
    // a planet whose sites are all out of every range the frame's own reveals use
    const planet = {
      sampler: {},
      radius: 1000,
      position: new THREE.Vector3(),
      worldToLocal: (v, out) => out.copy(v),
      dirToLocal: (v, out) => out.copy(v),
    };
    const site = (type, id) => ({ id, type, label: type, known: false, pos: new THREE.Vector3(0, 8000, 0), dir: new THREE.Vector3(0, 1, 0) });
    const draw = (owned) => {
      const game = Object.assign(Object.create(Game.prototype), {
        build: { skills: [] },
        player: { setBuild: vi.fn() },
        camWorld: new THREE.Vector3(0, 1000, 0),
        system: { star: { position: new THREE.Vector3(1, 0, 0) } },
        mode: 'foot',
      });
      game.onSkills({ state: { bought: owned } });
      const structures = new Structures(game);
      structures.planet = planet;
      structures.sites = [site('beacon', 'a#0'), site('outpost', 'a#1'), site('beacon', 'a#2')];
      structures.update(1 / 60, planet);
      return structures.markers(new THREE.Vector3(0, 8000, 0)).map((m) => m.s.id);
    };
    expect(draw([])).toEqual([]);
    expect(draw(['scanner_lens', 'pulse'])).toEqual([]);
    expect(draw(['long_ear'])).toEqual(['a#0', 'a#2']);
  });

  it('is read from the skill view the server sends', () => {
    const game = Object.assign(Object.create(Game.prototype), {
      build: { skills: [], people: undefined },
      player: { setBuild: vi.fn() },
      beaconsOnMap: false,
    });
    game.onSkills({ state: { bought: ['long_ear'] } });
    expect(game.beaconsOnMap).toBe(true);
    game.onSkills({ state: { bought: [] } });
    expect(game.beaconsOnMap).toBe(false);
  });
});
