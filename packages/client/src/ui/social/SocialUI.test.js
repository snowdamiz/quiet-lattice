// Where the fixed panels are (P1.E15.T03), for what keeps out of them: with no arguments, the panels' own boxes (the party
// frame, each invite card, the open chat panel) for remote entities' pilot markers; with a point, whether a world marker
// there is hidden (under or left of a panel), but never a hostile ship or the player's own.
import { describe, expect, it, vi } from 'vitest';
import { Motion } from './motion.js';
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

/** A beacon list as `SocialUI` draws it, over a page of fakes: its rows, scroll box and the properties the box is given. */
function beaconList(beaconRows) {
  const made = [];
  const fake = () => ({
    style: {},
    children: [],
    textContent: '',
    className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    insertBefore(c, before) {
      const at = before ? this.children.indexOf(before) : -1;
      this.children.splice(at < 0 ? this.children.length : at, 0, c);
      return c;
    },
    addEventListener() {},
    animate: () => ({ addEventListener() {} }),
    getAnimations: () => [],
    remove() {},
  });
  vi.stubGlobal('document', {
    createElement() {
      const e = fake();
      made.push(e);
      return e;
    },
  });
  let t = 0;
  const ui = Object.create(SocialUI.prototype);
  const props = [];
  ui.motion = new Motion(() => t);
  ui.edgeKeys = { above: {}, below: {}, bar: {} };
  ui.beaconsKey = '';
  ui.rows = new Map();
  ui.listEl = fake();
  ui.moreEl = fake();
  ui.emptyEl = fake();
  ui.ownEl = fake();
  ui.ownText = fake();
  ui.ownBtn = fake();
  ui.beaconsEl = Object.assign(fake(), { scrollTop: 0, clientHeight: 200, scrollHeight: 600 });
  ui.beaconsEl.style.setProperty = (name, v) => props.push([name, v]);
  ui.game = { galaxy: { systems: [{ name: 'Orxa' }] }, system: null };
  ui.model = { net: { serverTime: () => 100, beacons: { own: null, list: () => beaconRows } }, answerRefusals: new Map(), beaconRefusal: null, answer() {} };
  const frame = () => {
    t += 1000 / 60;
    ui.motion.step();
  };
  return { ui, props, made, frame };
}

describe('the beacon list', () => {
  const rows = [1, 2, 3].map((id) => ({ id, kind: 'raid', place: `Place ${id}`, from: 'Kestrel Vane', open: 2, cap: 4, at: 90, system: 0, frame: 0, center: [0, 0, 0], radius: 10 }));

  it('is drawn once, and left as it stands while its rows say the same', () => {
    const { ui, made } = beaconList(rows);
    ui.renderBeacons();
    const drawn = made.length;
    expect(ui.listEl.children).toHaveLength(3);
    for (let i = 0; i < 5; i++) ui.renderBeacons();
    expect(made).toHaveLength(drawn);
    ui.model.net.beacons.list = () => rows.slice(0, 2);
    ui.renderBeacons();
    expect(ui.rows.size).toBe(2);
    vi.unstubAllGlobals();
  });

  it('keeps its scrollbar and edge fades through every redraw, fading the bar only when it starts to overflow', () => {
    const { ui, props, frame } = beaconList(rows);
    ui.renderBeacons();
    for (let i = 0; i < 10; i++) frame();
    const at = (name) => Number(props.filter(([n]) => n === name).at(-1)[1]);
    expect(at('--sb-bar')).toBe(1);
    expect(at('--sb-below')).toBe(1);
    const settled = props.length;
    // a tick's redraw (its ages moved on), a scroll event and the frames between
    for (let i = 0; i < 60; i++) {
      ui.model.net.serverTime = () => 100 + i;
      ui.renderBeacons();
      ui.scrollEdges();
      frame();
    }
    expect(props.slice(settled).every(([, v]) => Number(v) === 1 || Number(v) === 0)).toBe(true);
    expect(props.slice(settled).filter(([n, v]) => n === '--sb-bar' && Number(v) !== 1)).toEqual([]);
    expect(props.slice(settled).filter(([n, v]) => n === '--sb-below' && Number(v) !== 1)).toEqual([]);
    // the list stops overflowing: the bar fades out, not at once
    ui.beaconsEl.scrollHeight = 200;
    ui.scrollEdges();
    frame();
    expect(at('--sb-bar')).toBeLessThan(1);
    expect(at('--sb-bar')).toBeGreaterThan(0.8);
    vi.unstubAllGlobals();
  });
});
