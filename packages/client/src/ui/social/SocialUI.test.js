// Where the fixed panels are (P1.E15.T03), for what keeps out of them: with no arguments, the panels' own boxes (the party
// frame, each invite card, the open chat panel) for remote entities' pilot markers; with a point, whether a world marker
// there is hidden (under or left of a panel), but never a hostile ship or the player's own.
import { describe, expect, it } from 'vitest';
import { SocialUI } from './SocialUI.js';

/** A SocialUI holding these panel boxes (as `tick` measures them), without a page. */
function withPanels(boxes) {
  const ui = Object.create(SocialUI.prototype);
  ui.keepOut = boxes;
  return ui;
}

const box = (left, top, width, height) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height });

describe('covers', () => {
  const party = box(26, 112, 256, 198);
  const card = box(26, 318, 256, 100);
  const panel = box(26, 574, 440, 388);

  it('gives the panels’ boxes with no arguments, a copy, and none when no panel shows', () => {
    const ui = withPanels([party, card, panel]);
    const got = ui.covers();
    expect(got).toEqual([party, card, panel]);
    got.length = 0;
    expect(ui.covers()).toHaveLength(3);
    expect(withPanels([]).covers()).toEqual([]);
  });

  it('hides a world marker under or left of a panel, but not a hostile or the player’s ship, nor one beside it', () => {
    const ui = withPanels([party, panel]);
    expect(ui.covers(100, 200, 'planet')).toBe(true);
    expect(ui.covers(10, 200, 'poi')).toBe(true);
    expect(ui.covers(100, 200, 'enemy')).toBe(false);
    expect(ui.covers(100, 200, 'ship')).toBe(false);
    expect(ui.covers(400, 200, 'planet')).toBe(false);
    expect(ui.covers(100, 450, 'planet')).toBe(false);
  });
});
