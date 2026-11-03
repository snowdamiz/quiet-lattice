// DOM heads-up display.
import * as THREE from 'three';
import { RESOURCES, resourceIcon } from '../gameplay/Inventory.js';
import { LY, fmtLy } from '@astra/shared/world';
import { castBar } from '../net/abilities.js';
import { EdgeCompass } from './EdgeCompass.js';
import { LABEL_GAP, LABEL_H, MARK_R, ROOM_MARGIN, addCovers, blockedBy, fits, hullCorners, labelWidth, makeRoom, makeSlide, markOf, nudge, outlineBands, placeLabel, screenBounds } from '../remote/markers.js';
import { SocialUI } from './social/SocialUI.js';
import { BANNER_FADE_IN, BANNER_FADE_OUT, BANNER_MS, BannerQueue } from './banners.js';

const _v = new THREE.Vector3();

// Other pilots' markers are placed by src/remote/markers.js: the mark over the ship's bounds on screen, the label beside
// the mark, both clear of the keep-out (the fixed HUD, the local ship) and of each other.
const _bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
const _mark = { x: 0, y: 0 };
const _label = { x0: 0, y0: 0, x1: 0, y1: 0 };
const _m4 = new THREE.Matrix4();
const namedFirst = (a, b) => b.shown - a.shown;
/** The slices the local ship's outline on screen is kept out in. */
const OUTLINE_BANDS = 8;

/** How long (ms) a pilot's mark or name takes to fade in or out (style.css's transition), and how long a name gone stays
 * gone at least: until its side has had room that long, or had none that long before it takes another. */
const FADE_MS = 150;
const ROOM_MS = 150;
/** Px from the screen's edges a pilot's ship must be in from to be marked, and may drift out to once it is. */
const VIEW_IN = 40;
const VIEW_OUT = 24;
/** Px/s past which a pilot's mark crosses the screen too fast for its name to be read: one gone stays gone. */
const NAME_SPEED = 1200;
/** How fast (px/s) a mark nudged off the keep-out may slide round it: this, or twice as fast as its ship crosses the
 * screen, whichever is more. */
const SLIDE_SPEED = 600;
/** How long (ms) a mark's speed across the screen is averaged over, for its name to look ahead by. */
const VELOCITY_MS = 80;

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

// Damage numbers (hitNumber): each pops in over HIT_POP_MS, rises HIT_RISE_PX on an ease-out and fades out, over HIT_MS in
// all. The rise is sampled from `hitRise`, the same curve the stacking reads back to know where a number is by now.
const HIT_MS = 900;
const HIT_POP_MS = 100;
const HIT_RISE_PX = 42;
const HIT_PX = 19;
const HIT_KILL_PX = 26;
const HIT_GAP_PX = 4;
// (a digit's advance in em, a little over the condensed face's, to decide which numbers share a column)
const HIT_GLYPH_EM = 0.62;
const hitRise = (u) => 1 - (1 - Math.min(Math.max(u, 0), 1)) ** 2;
const HIT_FRAMES = [0, HIT_POP_MS / HIT_MS, 0.25, 0.4, 0.55, 0.7, 0.85, 1].map((u) => ({
  offset: u,
  transform: `translate(-50%, ${-HIT_RISE_PX * hitRise(u)}px) scale(${0.7 + 0.3 * Math.min(1, u / (HIT_POP_MS / HIT_MS))})`,
  opacity: u === 0 ? 0 : u <= HIT_POP_MS / HIT_MS ? 1 : 1 - ((u - HIT_POP_MS / HIT_MS) / (1 - HIT_POP_MS / HIT_MS)) ** 2,
}));

export function fmtDist(m) {
  if (m < 1000) return `${m.toFixed(0)} m`;
  if (m < 1e6) return `${(m / 1000).toFixed(m < 1e4 ? 1 : 0)} km`;
  if (m < 1e10) return `${(m / 1e6).toFixed(m < 1e8 ? 2 : 0)} Mm`;
  if (m < LY * 1e-3) return `${(m / 1e9).toFixed(0)} Gm`;
  return fmtLy(m / LY);
}

const C = 2.998e8;
function fmtSpeed(v) {
  if (v < 2000) return `${v.toFixed(0)}<small>M/S</small>`;
  if (v < 0.01 * C) return `${(v / 1000).toFixed(1)}<small>KM/S</small>`;
  // past a hundredth of light speed, in multiples of it
  const c = v / C;
  if (c < 1000) return `${c.toFixed(c < 10 ? 2 : 0)}<small>C</small>`;
  if (c < 1e6) return `${(c / 1000).toFixed(c < 1e4 ? 1 : 0)}K<small>C</small>`;
  return `${(c / 1e6).toFixed(1)}M<small>C</small>`;
}

// (labels go in as markup with their range; a pilot's name is the player's own, so every label is escaped)
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function setText(e, html) {
  if (e._html !== html) {
    e.innerHTML = html;
    e._html = html;
  }
}

// two thin gauge arcs either side of a reticle, as one SVG: each a dark halo (so it reads over a bright sky or the beam's
// glare), a track, its fill, a chunk (a cast's cost, drawn bright over the fill while it eases on or off), a mark (a tick
// across the arc at a level that matters: where the heat lockout ends) and a sheen (a bright dash that climbs the fill
// while it refills)
const ARC_LEN = 1;
// a 100-degree arc centred on the left (or right) of the circle; both start at the bottom, so gauges fill upward
const arcAngle = (side, f) => ((side < 0 ? 130 + 100 * f : 50 - 100 * f) * Math.PI) / 180;
function gaugeSvg(left, right, r) {
  const arc = (side) => {
    const a0 = arcAngle(side, 0);
    const a1 = arcAngle(side, 1);
    const p = (a) => `${(r * Math.cos(a) + 50).toFixed(2)} ${(r * Math.sin(a) + 50).toFixed(2)}`;
    return `M ${p(a0)} A ${r} ${r} 0 0 ${side < 0 ? 1 : 0} ${p(a1)}`;
  };
  const gauge = (side, name) =>
    `<g class="gauge ${side < 0 ? 'left' : 'right'}" data-side="${side}" data-r="${r}"><path class="halo" d="${arc(side)}"/><path class="track" d="${arc(side)}" pathLength="1"/>` +
    `<path class="fill g-${name}" d="${arc(side)}" pathLength="1"/><path class="chunk k-${name}" d="${arc(side)}" pathLength="1"/>` +
    `<path class="sheen" d="${arc(side)}" pathLength="1"/><path class="mark"/></g>`;
  return `<svg class="gauges" viewBox="0 0 100 100">${gauge(-1, left)}${gauge(1, right)}</svg>`;
}

// a rate as the readouts show it: "+2.0/s", "−0.35/s"
const fmtRate = (v) => `${v > 0 ? '+' : '\u2212'}${Math.abs(v).toFixed(Math.abs(v) < 1 ? 2 : 1)}/s`;

// a gauge level: a finite 0–1 (anything else draws as empty, never as a full arc)
const unit = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
/** A change of more than this much of an arc in one frame is a jump (a server sync, a refill): the gauge eases onto it over
 * ARC_EASE_MS, fast then settling, rather than trailing it frame by frame. A cast's cost eases on or off whatever its size. */
const ARC_JUMP = 0.08;
export const ARC_EASE_MS = 250;
/** A cast's answer and the meter it paid from arrive this close together, either first, ms. */
const COST_WINDOW_MS = 200;
const easeOut = (t) => 1 - (1 - t) ** 3;

/** What the bar says of a cast the server refused, by its reason (ARCHITECTURE §28). */
export const CAST_REFUSED = {
  cooldown: 'COOLING DOWN',
  heat: 'OVERHEATED',
  charge: 'NOT ENOUGH CHARGE',
  range: 'OUT OF RANGE',
  los: 'NO LINE OF SIGHT',
  target: 'NO TARGET',
  unseen: 'NO TARGET',
  dead: 'TARGET DOWN',
  not_owned: 'NOT ON THE BAR',
  not_slotted: 'NOT ON THE BAR',
  slot: 'NOT ON THE BAR',
  unknown: 'CANNOT CAST YET',
  mode: 'NOT HERE',
  down: 'DOWN',
};
/** A slot's ring as the bar draws it: a near-black halo, a track, and the cooldown's sweep over it. */
const RING = `<svg viewBox="0 0 40 40"><circle class="halo" cx="20" cy="20" r="15"/><circle class="track" cx="20" cy="20" r="15"/><circle class="sweep" cx="20" cy="20" r="15" pathLength="1"/></svg>`;
/** A cooldown's seconds left as the bar shows them: whole from ten up, tenths under ten, so a countdown is never a lone
 * digit a key could be read as. */
export function countdown(left) {
  const tenths = Math.ceil(left * 10 - 1e-6) / 10;
  return tenths >= 10 ? String(Math.ceil(left - 1e-6)) : tenths.toFixed(1);
}
/** The bar rests dim this long after the last thing that moved on it, ms. */
const BAR_REST_MS = 4000;
/** Plays a slot's one-shot animation (`cast` or `ready`) from its start, in place of the other. Each class goes once its
 * animation ends, so the next is a plain add; one still running is taken off now and the new one put on next frame (the
 * animation restarts without forcing a layout in the frame). */
function beat(e, cls) {
  if (e.classList.contains('cast') || e.classList.contains('ready')) {
    e.classList.remove('cast', 'ready');
    e._beat = cls;
  } else e.classList.add(cls);
}

/** The heat arc as the HUD draws it from the multitool: filled to heat ÷ capacity, shown while the beam fires, the meter is
 * warm or locked out; amber from 75%, danger red through the lockout, with a tick where the lockout ends. */
export function heatGauge(mt) {
  const fill = unit(mt.heat);
  const over = !!mt.overheated;
  return { fill, show: !!mt.firing || over || fill > 0.02, hot: !over && fill >= 0.75, over, mark: unit(mt.recoverAt) };
}

/** The Charge arc and its readout as the HUD draws them from the ship: filled to Charge ÷ capacity, shown while not full or
 * on the pulse drive, regenerating (the sheen), and the rate (+ regenerating, − burning). */
export function chargeGauge(ship) {
  const max = Number.isFinite(ship.chargeMax) ? ship.chargeMax : 0;
  const fill = max > 0 ? unit(ship.charge / max) : 0;
  const shown = max > 0 && (ship.mode === 'pulse' || fill < 0.995);
  const rate = Number.isFinite(ship.chargeRate) ? ship.chargeRate : 0;
  return { fill, shown, empty: max > 0 && fill <= 0, regen: ship.chargeRegen > 0.005 && fill < 0.999, rate, value: Math.floor(fill * max + 1e-6) };
}

export class HUD {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    // clock and timers for messages and fades; a recording, which runs slower than real time,
    // swaps in its own so they last as long on video as in play
    this.now = () => performance.now();
    this.later = (fn, ms) => setTimeout(fn, ms);
    this.cancel = (id) => clearTimeout(id);
    root.innerHTML = '';
    // under everything else: the top of the view darkens while a banner shows, so it and the top line hold over any scene
    this.band = el('div', 'hud-band', root);
    this.layer = el('div', 'hud-layer', root);
    this.markersEl = el('div', 'markers', this.layer);
    // on foot: a dot with two gauge arcs (heat left, jetpack right) that only show while in use, and the lockout's word
    // under them
    this.crosshair = el('div', 'crosshair', this.layer, `<b></b>${gaugeSvg('heat', 'jet', 24)}<div class="c-state">OVERHEAT</div>`);
    // in flight: reticle with shield / Charge arcs, speed to the left and altitude to the right, the throttle under the
    // speed and Charge under the altitude
    this.reticle = el(
      'div',
      'ship-reticle',
      this.layer,
      `<b></b>${gaugeSvg('shield', 'charge', 30)}<div class="r-speed"></div><div class="r-thr"><i></i></div><div class="r-alt"></div><div class="r-chg"></div><div class="r-mode"></div>`,
    );
    this.rSpeed = this.reticle.querySelector('.r-speed');
    this.rAlt = this.reticle.querySelector('.r-alt');
    this.rMode = this.reticle.querySelector('.r-mode');
    this.rThr = this.reticle.querySelector('.r-thr i');
    this.rChg = this.reticle.querySelector('.r-chg');
    // north is the edge of space
    this.edgeCompass = new EdgeCompass(game, this.layer);
    this.location = el('div', 'location', this.layer);
    this.vitals = el('div', 'vitals', this.layer);
    // a hostile sky ahead, and how the hull is holding once it bites
    this.hzWarn = el('div', 'hz-warn', this.layer);
    this.inventory = el('div', 'inventory', this.layer);
    this.prompt = el('div', 'prompt', this.layer);
    this.toasts = el('div', 'toasts', this.layer);
    // the server's word on the player's shots: damage numbers over the hit creature
    this.hitsEl = el('div', 'hits', this.layer);
    // the bar the player casts from, keys 1–6 on foot and 1–5 in flight, with its cooldowns (ARCHITECTURE §28)
    this.abilitiesEl = el('div', 'abilities', this.layer, '<div class="ab-row"></div><div class="ab-why"></div>');
    this.abRow = this.abilitiesEl.querySelector('.ab-row');
    this.abWhy = this.abilitiesEl.querySelector('.ab-why');
    // chat, the party frame and the call-for-aid list (P1.E15.T03)
    this.social = new SocialUI(game, this);
    // (beside the layer, not in it: banners show through a cutscene, which fades the rest of the HUD out)
    this.banner = el('div', 'banner', root);
    // (the banners' keyframes and band run on these: style.css)
    root.style.setProperty('--banner-ms', `${BANNER_MS}ms`);
    root.style.setProperty('--banner-in-ms', `${BANNER_MS * BANNER_FADE_IN}ms`);
    root.style.setProperty('--banner-out-ms', `${BANNER_MS * BANNER_FADE_OUT}ms`);
    this.banners = new BannerQueue({
      now: () => this.now(),
      later: (fn, ms) => this.later(fn, ms),
      cancel: (id) => this.cancel(id),
      show: (b) => this.raiseBanner(b),
      release: () => this.band.classList.remove('show'),
    });
    this.flashEl = el('div', 'flash', root);
    this.underwater = el('div', 'underwater', root);
    this.speedLines = el('canvas', 'speedlines', root);
    this.scanRing = el('div', 'scan-ring', root);
    this.markerPool = [];
    /** the fixed HUD markers keep clear of (left, top, right, bottom per box, a few px round each), read now and then */
    this.avoidEls = [
      this.reticle.querySelector('b'),
      this.reticle.querySelector('svg'),
      this.rSpeed,
      this.rAlt,
      this.rMode,
      this.crosshair.querySelector('b'),
      // (the compass's readouts run wider than its own box)
      ...this.edgeCompass.el.querySelectorAll('.ec-ball, .ec-hdg, .ec-dist'),
      this.location,
      this.vitals,
      this.hzWarn,
      this.inventory,
      this.prompt,
      this.toasts,
      this.abilitiesEl,
    ].filter(Boolean);
    this.avoid = [];
    this.avoidAt = -Infinity;
    /** the keep-out this frame: the fixed HUD's boxes and the local ship's bounds on screen */
    this.keepOut = [];
    /** this frame's marks and labels, which a pilot's label keeps clear of too */
    this.taken = [];
    /** other pilots' markers by their entity id: {e, lbl, x, y, side, shown, nudged, ...}, kept while they fade out */
    this.pilots = new Map();
    this.pilotsNow = [];
    this.pilotsSeen = new Set();
    this.pilotsShown = [];
    /** where pilots' labels are placed this frame (markers.js's makeRoom) */
    this.room = makeRoom();
    this.lastToast = '';
    this.inventoryKey = '';
    this.visible = true;
  }

  setVisible(v) {
    this.visible = v;
    this.layer.style.display = v ? '' : 'none';
    this.banner.style.display = v ? '' : 'none';
    this.band.style.display = v ? '' : 'none';
    if (!v) this.edgeCompass.update(false);
  }

  // (as plain text: a toast can carry the server's words, a notice event, which must never be read as markup)
  // (`repeat`: a reward is shown every time it comes, though the last toast said the same: two kills paid the same)
  toast(text, kind = 'info', { repeat = false } = {}) {
    if (!repeat && text === this.lastToast && this.now() - this.lastToastT < 2500) return;
    this.lastToast = text;
    this.lastToastT = this.now();
    const t = el('div', `toast ${kind}`, this.toasts);
    t.textContent = text;
    this.later(() => t.classList.add('out'), 3200);
    this.later(() => t.remove(), 4000);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  // what was picked up, and a warning when the suit and the cargo pods could not take all of it
  collected(resource, wanted, got) {
    if (got > 0) this.pickup(resource, got);
    if (got < wanted) this.toast('Suit and cargo pods full', 'warn');
  }

  pickup(resource, amount) {
    const r = RESOURCES[resource];
    const t = el('div', 'toast pickup', this.toasts, `${resourceIcon(resource)}+${amount} ${r.name}`);
    this.later(() => t.classList.add('out'), 2200);
    this.later(() => t.remove(), 3000);
    while (this.toasts.children.length > 5) this.toasts.firstChild.remove();
  }

  // Banners queue instead of overwriting each other; one that waited too long is stale and dropped.
  showBanner(title, sub, lines = [], detail = '') {
    this.banners.push({ title, sub, lines, detail });
  }

  raiseBanner(b) {
    // two lines — what it is and its name — and, where the banner brings facts the player reads (an analysis's codex line:
    // DESIGN 12.1), a third, `detail`; the other lines (and rewards, which the units counter shows) were reading as filler
    // (as text, never markup: banners carry names players and the server chose)
    const sub = el('div', 'b-sub');
    sub.textContent = b.sub;
    const title = el('div', 'b-title');
    title.textContent = b.title;
    const rows = [sub, title];
    if (b.detail) {
      const detail = el('div', 'b-line');
      detail.textContent = b.detail;
      rows.push(detail);
    }
    this.banner.replaceChildren(...rows);
    // raised in a cutscene, it is a title card in the letterbox's top bar, and stays there for its life
    this.banner.classList.toggle('in-bar', !!this.game.cutscenes?.active);
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    // (in a cutscene's top bar it is on black already.) The band is a transition, not a restarted animation: one banner
    // following another leaves it lit, and only the text fades out and in
    this.band.classList.toggle('show', !this.game.cutscenes?.active);
  }

  /** Drops the banner showing and those waiting. */
  clearBanners() {
    this.banners.clear();
    this.banner.classList.remove('show');
    this.band.classList.remove('show');
  }

  flash(kind) {
    this.flashEl.className = `flash ${kind}`;
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  scanPulse() {
    this.scanRing.classList.remove('go');
    void this.scanRing.offsetWidth;
    this.scanRing.classList.add('go');
  }

  bar(label, value, cls = '') {
    const v = Math.max(0, Math.min(1, value));
    return `<div class="bar ${cls} ${v < 0.25 ? 'low' : ''}"><label>${label}</label><div class="track"><div class="fill" style="width:${(v * 100).toFixed(1)}%"></div></div></div>`;
  }

  // Fill one of the gauge arcs (0..1); `show` fades it in, otherwise it rests nearly invisible. `states` toggles classes
  // on the gauge (by default `low` under a quarter: a gauge running out), always from the value itself. The first time a
  // gauge is drawn and as it turns on it is drawn `snap`: at its value and in its colours at once, with no transition from
  // wherever it stood (the class lasts the one frame). A jump eases onto the value over ARC_EASE_MS on the HUD's clock,
  // following it as it moves on meanwhile, the CSS transition off while it does. `costAt` is when the HUD saw a cast on
  // this gauge's bar answered: a change within COST_WINDOW_MS of it is that cast's cost, eased whatever its size, the
  // part of the fill between the old level and the tip drawn bright (the heat landing, the Charge coming off) as it goes.
  arc(root, name, value, show, states = null, costAt = null) {
    const a = (root._arcs ||= {})[name] || (root._arcs[name] = root.querySelector(`.g-${name}`));
    const g = a.parentNode;
    const v = unit(value);
    const now = this.now();
    const snap = a._v === undefined || (show && !g.classList.contains('on'));
    const cost = costAt !== null && now - costAt < COST_WINDOW_MS;
    if (snap) a._ease = null;
    else if (Math.abs(v - a._v) > ARC_JUMP || (cost && Math.abs(v - a._v) > 1e-4 && !a._ease?.cost)) a._ease = { from: a._drawn ?? a._v, at: now, cost: false };
    if (a._ease && cost && a._ease.at >= costAt - COST_WINDOW_MS) a._ease.cost = true;
    a._v = v;
    let drawn = v;
    let t = 1;
    if (a._ease) {
      t = (now - a._ease.at) / ARC_EASE_MS;
      if (t >= 1) a._ease = null;
      else drawn = a._ease.from + (v - a._ease.from) * easeOut(Math.max(0, t));
    }
    a._drawn = drawn;
    g.classList.toggle('snap', snap || !!a._ease);
    const off = (ARC_LEN * (1 - drawn)).toFixed(3);
    if (a._off !== off) a.style.strokeDashoffset = a._off = off;
    const k = a._chunk || (a._chunk = g.querySelector('.chunk'));
    if (k) {
      // (from the lower of the old level and the new up to the tip: heat's new chunk growing, Charge's cost draining)
      const lo = a._ease?.cost ? Math.min(a._ease.from, v) : drawn;
      const len = Math.max(0, drawn - lo);
      const chunk = len > 1e-3 ? `${len.toFixed(4)}|${lo.toFixed(4)}|${Math.min(1, (1 - t) / 0.4).toFixed(3)}` : '';
      if (k._c !== chunk) {
        k._c = chunk;
        const [l, at, o] = chunk ? chunk.split('|') : ['0', '0', '0'];
        k.style.strokeDasharray = `${l} 2`;
        k.style.strokeDashoffset = String(-at);
        k.style.opacity = o;
      }
    }
    g.classList.toggle('on', show);
    for (const [cls, on] of Object.entries(states ?? { low: v < 0.25 })) g.classList.toggle(cls, !!on);
  }

  /** When the HUD first saw the last cast the server carried out from `bar` answered, on its clock (null: none yet). */
  costAt(bar) {
    const c = this.game.abilities?.lastCast;
    if (!c || c.bar !== bar) return null;
    if (this._cost?.of !== c) this._cost = { of: c, at: this.now() };
    return this._cost.at;
  }

  // A bright dash that climbs a gauge's fill from the bottom to its tip, eased in and out, every 1.9 s while `on` (Charge
  // regenerating). Driven from the HUD's clock, so recordings and captures show it as play does.
  sheen(root, name, on, v) {
    const a = (root._arcs ||= {})[name] || (root._arcs[name] = root.querySelector(`.g-${name}`));
    const g = a.parentNode;
    const sh = g.querySelector('.sheen');
    // (only over a fill already drawn: not while the gauge lands on its value, nor while it is off)
    if (!on || !g.classList.contains('on') || g.classList.contains('snap')) {
      if (sh._on) sh.style.opacity = 0;
      sh._on = false;
      return;
    }
    sh._on = true;
    const t = (this.now() % 1900) / 1900;
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    // the dash (0.07 of the arc) centred on its way up to the fill's tip, brightest midway
    sh.style.strokeDashoffset = (0.035 - e * Math.max(0.06, v)).toFixed(4);
    sh.style.opacity = (0.9 * Math.sin(Math.PI * t) ** 0.7).toFixed(3);
  }

  // a tick across a gauge arc at level `f` (0..1), shown while `show`
  mark(root, name, f, show) {
    const a = (root._arcs ||= {})[name] || (root._arcs[name] = root.querySelector(`.g-${name}`));
    const g = a.parentNode;
    const m = g.querySelector('.mark');
    const key = f.toFixed(3);
    if (m._f !== key) {
      m._f = key;
      const side = +g.dataset.side;
      const r = +g.dataset.r;
      const t = arcAngle(side, f);
      const p = (rr) => `${(rr * Math.cos(t) + 50).toFixed(2)} ${(rr * Math.sin(t) + 50).toFixed(2)}`;
      // (across the whole halo, so it reads against the fill and the track alike)
      m.setAttribute('d', `M ${p(r - 9)} L ${p(r + 9)}`);
    }
    g.classList.toggle('marked', show);
  }

  update(dt) {
    const g = this.game;
    if (!this.visible) return;
    // (first: both read the page's layout, which holds only before the rest of the HUD has written this frame)
    this.readAvoid();
    this.social.update();
    const mode = g.mode;
    const ship = g.ship;
    const player = g.player;
    this.root.dataset.mode = mode;
    // out of the way under the map and the other menus; a cutscene fades it out as its letterbox closes in, but for the
    // banners it raises; the chat panel open is part of it
    const cine = g.cutscenes?.letterbox ?? 0;
    const chatting = g.overlay === 'chat';
    const hidden = g.overlay && g.overlay !== 'cutscene' && !chatting;
    this.layer.style.visibility = hidden ? 'hidden' : '';
    this.banner.style.visibility = hidden ? 'hidden' : '';
    this.band.style.visibility = hidden || cine > 0 ? 'hidden' : '';
    const fade = cine > 0 ? (1 - cine).toFixed(3) : '';
    if (this.layer.style.opacity !== fade) this.layer.style.opacity = fade;

    // crosshair / reticle
    this.crosshair.style.display = mode === 'foot' ? '' : 'none';
    // (not in the cockpit, whose own screens show speed and altitude, nor while looking back, sat
    // on the ground or gliding between views: "0 m/s" printed across the hull while boarding)
    const flying = ship.mode !== 'landed' && !g.director.pose;
    this.reticle.style.display = mode === 'ship' && flying && !ship.inCockpit && (ship.lookBack || 0) < 0.03 ? '' : 'none';
    if (mode === 'foot' && g.multitool) {
      const mt = g.multitool;
      this.crosshair.classList.toggle('active', mt.firing);
      this.crosshair.classList.toggle('target', !!mt.target);
      // heat fills the left arc: warm, amber once it runs hot, danger red through the lockout, with a tick where the
      // lockout ends and the word under the dot
      const heat = heatGauge(mt);
      this.arc(this.crosshair, 'heat', heat.fill, heat.show, { hot: heat.hot, over: heat.over }, this.costAt('ground'));
      this.mark(this.crosshair, 'heat', heat.mark, heat.over);
      this.crosshair.classList.toggle('over', heat.over);
      this.arc(this.crosshair, 'jet', player.jetFuel, player.jetFuel < 0.999);
    }
    if (mode === 'ship') {
      // (`speed` is the flight model's; lifting off it reads 0 while the ship already moves)
      const spd = ship.mode === 'takeoff' ? ship.state.vel.length() : Math.abs(ship.speed);
      setText(this.rSpeed, fmtSpeed(spd));
      setText(this.rAlt, isFinite(ship.altitude) && ship.altitude < 100000 ? `${fmtDist(Math.max(0, ship.altitude))}<small>ALT</small>` : '');
      const state = { landing: 'LANDING', landed: 'LANDED', docking: 'DOCKING', pulse: g.universe.deep ? 'CRUISE' : 'PULSE' }[ship.mode] || (ship.mode === 'flying' && ship.hover > 0.6 ? 'VTOL' : '');
      setText(this.rMode, state);
      // the first time the thrusters take the ship, say how to fly it on them (once per save)
      if (state === 'VTOL' && !g.hints?.vtol) {
        (g.hints ||= {}).vtol = true;
        this.toast('VTOL thrusters: Space / C to climb and sink, A / D to strafe');
      }
      // the throttle where it was left (a little reverse in space shows from the middle down)
      const thr = ship.mode === 'pulse' ? 1 : ship.throttle;
      const w = `${(Math.abs(thr) * 100).toFixed(0)}%`;
      if (this.rThr._w !== w) this.rThr.style.width = this.rThr._w = w;
      this.rThr.classList.toggle('rev', thr < 0);
      this.arc(this.reticle, 'shield', ship.shield / 100, ship.shield < 99.5);
      // Charge fills the right arc; a sheen climbs it while it regenerates, and the readout under the altitude says how
      // much there is and which way it is going (shown while it is not full, or on the pulse drive)
      const charge = chargeGauge(ship);
      this.arc(this.reticle, 'charge', charge.fill, charge.shown, { low: charge.fill < 0.25, regen: charge.regen, empty: charge.empty }, this.costAt('ship'));
      this.sheen(this.reticle, 'charge', charge.regen && charge.shown, charge.fill);
      let chg = '';
      if (charge.shown && charge.empty) chg = `0<small>CHARGE EMPTY</small>`;
      else if (charge.shown) {
        const dir = charge.rate > 0.005 ? 'up' : charge.rate < -0.005 ? 'down' : '';
        chg = `${charge.value}<small>CHARGE</small>${dir ? `<i class="${dir}">${fmtRate(charge.rate)}</i>` : ''}`;
      }
      setText(this.rChg, chg);
      this.rChg.classList.toggle('empty', charge.shown && charge.empty);
    }

    // hostile skies
    let hz = '';
    if (mode === 'ship' && ship.hazard && ship.hazardNear > 0) {
      const h = ship.hazard;
      const biting = ship.hazardLevel > 0;
      hz = biting ? `<b>⚠ ${h.label}</b><span>Hull ${Math.ceil(ship.hull)}%</span>` : `<b>${h.label}</b><span>below ${Math.round(h.ceiling / 1000)} km</span>`;
      this.hzWarn.classList.toggle('biting', biting);
      this.hzWarn.classList.toggle('critical', biting && ship.hull < 35);
      if (biting && ship.shield <= 0 && ship.hull < 35 && (!this._alarmT || g.time - this._alarmT > 1.6)) {
        this._alarmT = g.time;
        g.audio.play('alarm');
      }
    }
    setText(this.hzWarn, hz);
    this.hzWarn.style.display = hz ? '' : 'none';

    // vitals: only while something needs attention
    let html = '';
    if (mode === 'ship' && ship.hull < 99.5) html += this.bar('HULL', ship.hull / 100, 'hull');
    if (mode === 'foot') {
      if (player.health < 99.5) html += this.bar('HEALTH', player.health / 100, 'health');
      if (player.lifeSupport < 99.5) html += this.bar('LIFE SUPPORT', player.lifeSupport / 100, 'life');
      if (player.hazard < 99.5) html += this.bar('HAZARD', player.hazard / 100, 'hazard');
    }
    if (html !== this._vitals) {
      this.vitals.innerHTML = html;
      this._vitals = html;
    }

    // location: one quiet line, plus the objective, which dims once it has been read
    const f = g.focusFrame;
    // just where you are: the place's name
    let loc;
    if (g.universe.deep) loc = `<div class="body">Interstellar space</div>`;
    else if (!f) loc = `<div class="body">${g.system.name}</div>`;
    // (the station's frame reaches far out; once clear of it, the line names the planet below)
    else if (f.kind === 'station' && f.distanceTo(g.camWorld) > 2500) loc = `<div class="body">${f.parent.name}</div>`;
    else loc = `<div class="body">${f.name}</div>`;
    const obj = g.objectives?.current;
    if (obj) loc += `<div class="objective">${obj}</div>`;
    if (loc !== this._locHtml) {
      this.location.innerHTML = loc;
      this._locHtml = loc;
      if (obj !== this._obj) {
        this._obj = obj;
        this._objT = this.now();
      }
    }
    this.location.classList.toggle('settled', this.now() - (this._objT || 0) > 8000);

    // units only; resources live in the inventory screens and pickup notices
    const inv = g.inventory;
    const key = inv.key();
    if (key !== this.inventoryKey) {
      if (this.inventoryKey) {
        this.inventory.classList.add('changed');
        this.cancel(this._invT);
        this._invT = this.later(() => this.inventory.classList.remove('changed'), 2500);
      }
      this.inventoryKey = key;
      this.inventory.innerHTML = `<span>⌬</span>${inv.units.toLocaleString()}`;
    }

    // prompt
    const pr = g.currentPrompt || '';
    if (pr !== this._prompt) {
      this.prompt.innerHTML = pr;
      this.prompt.style.opacity = pr ? 1 : 0;
      this._prompt = pr;
    }

    // (drawn into the picture, where the top bar of a cutscene's letterbox goes)
    this.edgeCompass.update((!g.overlay || chatting) && !cine && (mode === 'ship' || mode === 'foot'));
    this.updateMarkers();
    this.updateHits(g.net?.combat);
    this.updateAbilities();
    this.updateEvents(g.net?.worldEvents);
    this.updateSpeedLines(dt);
    this.underwater.style.opacity = g.player && mode === 'foot' && g.player.headUnderwater ? 1 : 0;
  }

  // Where the fixed HUD stands, every quarter second, read before this frame writes anything (so no layout is forced).
  readAvoid() {
    const now = this.now();
    if (now - this.avoidAt < 250) return;
    this.avoidAt = now;
    const out = this.avoid;
    out.length = 0;
    for (const e of this.avoidEls) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(e).opacity !== '0') out.push(r.left - 4, r.top - 4, r.right + 4, r.bottom + 4);
    }
  }

  // The bar the player casts from (ARCHITECTURE §28), under the prompt: a ring a working slot with its key in it and the
  // node's name under it. A cooldown is the ring drawn back to full in the bar's colour (heat's warm on foot, the flight
  // deck's warm white in flight) as the server's clock runs out, the seconds left in that colour in place of the key
  // (`countdown`), and the ring brightens for a beat once it is ready; a toggle that is on thickens it; a cast the server
  // took flares it, and one it refused edges it in danger red with the reason on a plate above it. Shown while a node is
  // slotted on the bar the mode casts from; once nothing on it has moved for BAR_REST_MS it rests dim, its names hidden.
  updateAbilities() {
    const g = this.game;
    const bar = g.abilities && !g.director?.pose ? castBar(g) : null;
    const slots = bar ? g.abilities.slots(bar, g.time) : [];
    const shown = slots.some((x) => x.node);
    this.abilitiesEl.classList.toggle('on', shown);
    if (!shown) return;
    const now = this.now();
    const layout = `${bar}:${slots.map((x) => x.node ?? '').join(',')}`;
    if (this.abRow._layout !== layout) {
      this.abRow._layout = layout;
      this.abilitiesEl.dataset.bar = bar;
      this.abRow.innerHTML = slots
        .map((x) => `<div class="ab-slot${x.node ? '' : ' empty'}">${RING}<b class="ab-key">${x.key}</b><i class="ab-name"></i></div>`)
        .join('');
      this.abRow.querySelectorAll('.ab-name').forEach((n, i) => (n.textContent = slots[i].name ?? ''));
      for (const e of this.abRow.children) e.addEventListener('animationend', () => e.classList.remove('cast', 'ready'));
      this._abBusyAt = now;
    }
    let busy = false;
    slots.forEach((x, i) => {
      const e = this.abRow.children[i];
      if (e._beat) {
        e.classList.add(e._beat);
        e._beat = null;
      }
      const cooling = x.left > 0 && x.length > 0;
      // (the ring drawn back as the cooldown runs out: none of it left at the cast, all of it when ready)
      const sweep = e.querySelector('.sweep');
      const off = cooling ? Math.min(1, x.left / x.length).toFixed(3) : '0';
      if (sweep._off !== off) sweep.style.strokeDashoffset = sweep._off = off;
      const key = e.querySelector('.ab-key');
      const label = cooling ? countdown(x.left) : String(x.key);
      if (key._t !== label) key.textContent = key._t = label;
      // (a cooldown run out on this slot's node, not a node newly slotted: the ring's beat)
      if (e._cooling && !cooling && e._node === x.node) beat(e, 'ready');
      e._cooling = cooling;
      e._node = x.node;
      e.classList.toggle('cooling', cooling);
      e.classList.toggle('lit', x.on);
      e.classList.toggle('sending', x.sending);
      e.classList.toggle('refused', !!x.refused);
      if (x.castAt !== null && e._castAt !== x.castAt) {
        e._castAt = x.castAt;
        beat(e, 'cast');
      }
      busy ||= cooling || x.on || x.sending || !!x.refused;
    });
    const refused = slots.findIndex((x) => x.refused);
    const why = refused >= 0 ? (CAST_REFUSED[slots[refused].refused] ?? 'TRY AGAIN') : '';
    if (why) {
      this.abWhy.textContent = why;
      // (over the refused slot's ring: the stylesheet places it by the slot's index)
      if (this.abWhy._i !== refused) this.abWhy.style.setProperty('--why-i', (this.abWhy._i = refused));
    }
    this.abWhy.classList.toggle('show', !!why);
    if (busy) this._abBusyAt = now;
    this.abilitiesEl.classList.toggle('rest', now - (this._abBusyAt ?? 0) > BAR_REST_MS);
  }

  // What the server says the player's shots did and the blows it took (ARCHITECTURE §20): a number rising over the creature
  // for each hit (gold for a kill), a flash for a blow taken, and a kill's XP and loot as toasts.
  updateHits(feed) {
    this.updateHitNumbers();
    if (!feed) return;
    const { dealt, taken, gained } = feed.take();
    for (const h of dealt) this.hitNumber(h.amount, h.killed, h.target);
    if (taken.length) this.flash('damage');
    // (one toast for each kind of reward a frame brought: an area attack that kills several would otherwise push the earlier
    // toasts out of the stack)
    if (!gained.length) return;
    const totals = new Map();
    for (const x of gained) totals.set(x.what, (totals.get(x.what) ?? 0) + x.count);
    for (const [what, count] of totals) this.toast(what === 'xp' ? `+${count} XP` : `+${count} ${what === 'units' ? 'units' : RESOURCES[what]?.name ?? what}`, 'good', { repeat: true });
  }

  // World events (ARCHITECTURE §26): a banner as one is announced, starts and ends in the system, and toasts as the
  // player joins an instance, its scaling changes and it is paid. (A full event panel is later work.)
  updateEvents(feed) {
    if (!feed) return;
    for (const x of feed.take()) {
      if (x.banner) this.showBanner(x.title, x.sub);
      else this.toast(x.text, x.tone);
    }
  }

  // Fauna publishes the billboard point on the creature as drawn, including a corpse's fall. Project a copy of it;
  // nowhere when it is not drawn this frame, behind the camera or off screen.
  hitAnchor(id) {
    const g = this.game;
    const r = g.remotes?.get(id);
    const at = r && g.fauna.hitAnchor(r);
    if (!at) return null;
    const cam = g.engine.camera;
    _v.copy(at).sub(g.camWorld).applyQuaternion(g.camWorldQuatInv);
    if (_v.z >= 0) return null;
    _v.applyMatrix4(cam.projectionMatrix);
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    return x > 0 && x < window.innerWidth && y > 0 && y < window.innerHeight ? { x, y } : null;
  }

  // Keep live numbers over their hit targets as the view moves; once a target is lost, its numbers expire with it.
  updateHitNumbers() {
    const now = this.now();
    this.hitLive = (this.hitLive ?? []).filter((h) => {
      if (!h.el.isConnected) return false;
      const at = now - h.at < HIT_MS && this.hitAnchor(h.target);
      if (!at) {
        h.el.remove();
        return false;
      }
      const x = at.x + h.dx;
      const top = at.y + h.dy;
      if (x !== h.x) h.el.style.left = `${(h.x = x)}px`;
      if (top !== h.top) h.el.style.top = `${(h.top = top)}px`;
      return true;
    });
  }

  // A hit's damage rising: over the visible creature it landed on, gold and larger for a
  // kill. A new number starts a full line above the top of every live one it could touch, whichever creature that one is
  // for (where it is by now, having risen): it rises faster than the older ones, so it never closes on them, and none
  // sits on another.
  hitNumber(amount, killed, target) {
    this.updateHitNumbers();
    const at = this.hitAnchor(target);
    if (!at) return;
    const e = el('div', 'hit-number', this.hitsEl);
    e.textContent = String(amount > 0 ? Math.max(1, Math.round(amount)) : 0);
    const now = this.now();
    const px = killed ? HIT_KILL_PX : HIT_PX;
    // (a little sideways in turn, so the column reads as separate hits)
    const dx = ((this.hitsEl.children.length % 3) - 1) * 8;
    const x = at.x + dx;
    const half = (e.textContent.length * px * HIT_GLYPH_EM) / 2;
    const live = this.hitLive;
    let top = at.y;
    for (const h of live) {
      if (Math.abs(x - h.x) >= half + h.half) continue;
      const nowTop = h.top - HIT_RISE_PX * hitRise((now - h.at) / HIT_MS);
      // (one wholly below where this starts stays below it: the new number rises away from it)
      if (nowTop >= at.y + px) continue;
      top = Math.min(top, nowTop - px - HIT_GAP_PX);
    }
    live.push({ el: e, at: now, top, x, half, target, dx, dy: top - at.y });
    // (the reticle readouts' type and the HUD's palette: style.css's tokens)
    Object.assign(e.style, {
      position: 'absolute', left: `${at.x + dx}px`, top: `${top}px`, transform: 'translate(-50%, 0)', pointerEvents: 'none',
      color: killed ? 'var(--accent-hi)' : 'var(--text)', fontFamily: 'var(--font-cond)', fontWeight: '600', fontSize: `${px}px`,
      // (a dark halo, not only the drop shadow: a number over bright sky or sand keeps 4.5:1)
      lineHeight: '1', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em', textShadow: '0 0 2px #0b0c0f, 0 0 5px #0b0c0f, 0 1px 3px rgba(0, 0, 0, 0.9)',
    });
    // (popping in, rising and fading on the compositor: nothing forces a layout as each number is added)
    e.animate(HIT_FRAMES, { duration: HIT_MS, easing: 'linear', fill: 'forwards' });
    this.later(() => e.remove(), HIT_MS + 100);
    while (this.hitsEl.children.length > 12) this.hitsEl.firstChild.remove();
  }

  // The local ship's outline on screen into `keepOut`, as OUTLINE_BANDS boxes close round it (markers.js's outlineBands):
  // the corners of its convex hull (worked out once, in its own space), projected. None when it is not drawn, or not all
  // in front of the camera.
  localShipOutline(W, H, keepOut) {
    const g = this.game;
    const model = g.ship?.model;
    if (!model || !model.visible || g.mode !== 'ship') return;
    if (this.shipHullOf !== model) {
      this.shipHullOf = model;
      this.shipHull = hullCorners(model);
      const n = this.shipHull.length / 3;
      this.shipXY = new Float64Array(2 * n);
      this.shipOrder = new Int32Array(n);
      this.shipPoly = new Int32Array(2 * n + 1);
    }
    const cam = g.engine.camera;
    const e = _m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(model.matrixWorld).elements;
    const pts = this.shipHull;
    const xy = this.shipXY;
    const n = pts.length / 3;
    for (let i = 0; i < n; i++) {
      const x = pts[3 * i];
      const y = pts[3 * i + 1];
      const z = pts[3 * i + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w < 0.01) return;
      xy[2 * i] = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 * W + W / 2;
      xy[2 * i + 1] = (-((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5 + 0.5) * H;
    }
    outlineBands(xy, n, OUTLINE_BANDS, 4, keepOut, this.shipOrder, this.shipPoly);
  }

  updateMarkers() {
    const g = this.game;
    const cam = g.engine.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    // none while the camera swings round to look back past the ship: it is a view, not a heading
    const markers = g.mode === 'ship' && (g.ship.lookBack || 0) > 0.03 ? [] : g.getMarkers();
    const keepOut = this.keepOut;
    keepOut.length = 0;
    for (const v of this.avoid) keepOut.push(v);
    // (and the social panels, where the HUD has them)
    addCovers(keepOut, this.social, 4);
    this.localShipOutline(W, H, keepOut);
    const taken = this.taken;
    taken.length = 0;
    const pilots = this.pilotsNow;
    pilots.length = 0;
    let i = 0;
    for (const m of markers) {
      if (m.kind === 'player') {
        pilots.push(m);
        continue;
      }
      let e = this.markerPool[i];
      if (!e) {
        e = el('div', 'marker', this.markersEl, '<div class="icon"></div><div class="lbl"></div>');
        e._lblEl = e.querySelector('.lbl');
        this.markerPool.push(e);
      }
      i++;
      _v.copy(m.rel).applyQuaternion(g.camWorldQuatInv);
      const behind = _v.z > 0;
      _v.applyMatrix4(cam.projectionMatrix);
      let sx = (_v.x * 0.5 + 0.5) * W;
      let sy = (-_v.y * 0.5 + 0.5) * H;
      if (behind) {
        sx = W - sx;
        sy = H - sy;
      }
      const margin = 40;
      const off = behind || sx < margin || sx > W - margin || sy < margin || sy > H - margin;
      // (scanned resources off screen are dropped too: pinned to the edge they stacked into a column)
      if (off && !m.target && (m.kind === 'planet' || m.kind === 'poi' || m.kind === 'resource' || m.kind === 'system' || m.kind === 'city')) {
        i--;
        e.style.display = 'none';
        continue;
      }
      if (off) {
        const cx = W / 2;
        const cy = H / 2;
        let dx = sx - cx;
        let dy = sy - cy;
        if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
        const s = Math.min((W / 2 - margin) / Math.abs(dx || 1e-6), (H / 2 - margin) / Math.abs(dy || 1e-6));
        sx = cx + dx * s;
        sy = cy + dy * s;
      }
      // (none under the party frame or the open chat panel, but the one you steer by, hostiles and your own ship)
      if (!m.target && this.social.covers(sx, sy, m.kind)) {
        i--;
        e.style.display = 'none';
        continue;
      }
      e._sx = sx;
      e._sy = sy;
      e._off = off;
      e.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      e.className = `marker ${m.kind} ${off ? 'off' : ''} ${m.target ? 'targeted' : ''}`;
      e.style.display = '';
      taken.push(sx - 6, sy - 6, sx + 6, sy + 6);
      const range = fmtDist(m.dist);
      const html = this.otherLabel(e, m, range, W, H);
      this.setLabel(e, html);
      if (html) taken.push(sx + 8, sy - 9, sx + 10 + labelWidth(m.label ?? '', range), sy + LABEL_H - 9);
    }
    for (let k = i; k < this.markerPool.length; k++) this.markerPool[k].style.display = 'none';
    this.updatePilots(pilots, keepOut, taken, W, H);
  }

  // Other pilots' markers, nearest first, each its own element (by the pilot's entity id) so it fades in and out over
  // FADE_MS: every pilot picked up and in view has its mark, nudged off the keep-out, never dropped for it. The names shown
  // last frame are placed first, so one coming back never knocks one off: a name stays on its side while that has room,
  // and once gone stays gone ROOM_MS at least, coming back when its side has had room (with ROOM_MARGIN to spare, here and
  // where its mark is headed) that long, or taking another side when its own has had none that long, and only while its
  // mark moves slowly enough to read it by (NAME_SPEED).
  updatePilots(list, keepOut, taken, W, H) {
    const g = this.game;
    const cam = g.engine.camera;
    const now = this.now();
    const seen = this.pilotsSeen;
    seen.clear();
    const shown = this.pilotsShown;
    shown.length = 0;
    const room = this.room;
    room.keepOut = keepOut;
    room.taken = taken;
    room.ships.length = 0;
    room.W = W;
    room.H = H;
    for (const m of list) {
      _v.copy(m.rel).applyQuaternion(g.camWorldQuatInv);
      if (_v.z > 0) continue;
      _v.applyMatrix4(cam.projectionMatrix);
      const cx = (_v.x * 0.5 + 0.5) * W;
      const cy = (-_v.y * 0.5 + 0.5) * H;
      let p = this.pilots.get(m.id);
      // (one off screen has none: a crowd of them would line the edges)
      const edge = p && !p.goneAt ? VIEW_OUT : VIEW_IN;
      if (cx < edge || cx > W - edge || cy < edge || cy > H - edge) continue;
      let b = m.box ? screenBounds(m.box, m.quat, m.rel, g.camWorldQuatInv, cam.projectionMatrix, W, H, _bounds) : null;
      // (a ship so near that its box reaches behind the camera: marked over its middle)
      if (!b) {
        b = _bounds;
        b.x0 = b.x1 = cx;
        b.y0 = b.y1 = cy;
      }
      if (!p) {
        const e = el('div', 'marker player out', this.markersEl, '<div class="icon"></div><div class="lbl out"></div>');
        e.dataset.id = String(m.id);
        p = {
          e,
          lbl: e.querySelector('.lbl'),
          frames: 0,
          nudged: 0,
          slide: makeSlide(),
          side: null,
          shown: false,
          why: null,
          goneAt: 0,
          hiddenAt: now,
          clearSince: null,
          blockedSince: null,
          fadeUntil: 0,
          box: { x0: 0, y0: 0, x1: 0, y1: 0 },
          boxX: 0,
          boxY: 0,
          held: false,
          at: now,
          vx: 0,
          vy: 0,
          tx: 0,
          ty: 0,
        };
        this.pilots.set(m.id, p);
        // (laid out once hidden, so it fades in)
        void e.offsetWidth;
      }
      markOf(b, _mark, cx, cy, W, H);
      const dt = now - p.at;
      // (sliding round the keep-out no faster than SLIDE_SPEED, or twice its ship)
      const live = p.frames > 0 && !p.goneAt;
      p.slide.was &&= live;
      p.slide.max = Math.max((SLIDE_SPEED * dt) / 1000, 2 * Math.hypot(_mark.x - p.tx, _mark.y - p.ty));
      p.tx = _mark.x;
      p.ty = _mark.y;
      p.nudged = nudge(_mark, keepOut, W, H, p.nudged, p.slide);
      // (how fast its mark crosses the screen, px/ms, which its name looks ahead by: over the last VELOCITY_MS or so)
      if (live && dt > 0) {
        const k = p.frames > 1 ? 1 - Math.exp(-dt / VELOCITY_MS) : 1;
        p.vx += ((_mark.x - p.x) / dt - p.vx) * k;
        p.vy += ((_mark.y - p.y) / dt - p.vy) * k;
      }
      p.at = now;
      p.frames++;
      p.x = _mark.x;
      p.y = _mark.y;
      p.m = m;
      p.goneAt = 0;
      p.e.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      p.e.classList.remove('out');
      p.takenFrom = taken.length;
      taken.push(p.x - 6, p.y - 6, p.x + 6, p.y + 6);
      p.takenTo = taken.length;
      p.shipFrom = room.ships.length;
      room.ships.push(b.x0, b.y0, b.x1, b.y1);
      p.shipTo = room.ships.length;
      seen.add(m.id);
      shown.push(p);
    }
    // those gone (out of pickup, of view, of the snapshots) fade out, then go
    for (const [id, p] of this.pilots) {
      if (seen.has(id)) continue;
      if (!p.goneAt) {
        p.goneAt = now;
        p.e.classList.add('out');
        // (its name fades where it was)
        if (p.shown) p.fadeUntil = now + FADE_MS;
      } else if (now - p.goneAt > FADE_MS + 50) {
        p.e.remove();
        this.pilots.delete(id);
      }
    }
    // (a name fading out fades where it was, its mark going on without it, and keeps its room while it does: none comes in
    // over one)
    for (const p of this.pilots.values()) {
      if (p.fadeUntil <= now || p.shown) continue;
      if (!p.goneAt) this.holdLabel(p);
      taken.push(p.box.x0, p.box.y0, p.box.x1, p.box.y1);
    }
    // (the names shown first, nearest first among them: the sort keeps the order)
    shown.sort(namedFirst);
    for (const p of shown) this.placePilotLabel(p, room, now);
  }

  // Where pilot `p`'s name goes this frame, if anywhere (see updatePilots). One shown stays while its side has room here
  // and where its mark is headed in FADE_MS (so it has faded by the time it would run into what is there); one gone comes
  // back (or a new one shows) only with ROOM_MARGIN to spare here and twice as far ahead, so it is not gone again at once.
  placePilotLabel(p, room, now) {
    const m = p.m;
    const range = fmtDist(m.dist);
    const w = labelWidth(m.label ?? '', range);
    room.takenFrom = p.takenFrom;
    room.takenTo = p.takenTo;
    room.shipFrom = p.shipFrom;
    room.shipTo = p.shipTo;
    const lead = p.shown ? FADE_MS : 2 * ROOM_MS;
    room.aheadX = p.vx * lead;
    room.aheadY = p.vy * lead;
    let side = null;
    const steady = Math.hypot(p.vx, p.vy) * 1000 <= NAME_SPEED;
    if (p.shown) {
      if (fits(p.side, p.x, p.y, w, LABEL_H, room, _label)) side = p.side;
      else {
        // (what it ran into, for the dev captures; it keeps its room while it fades)
        p.why = blockedBy(p.side, p.x, p.y, w, LABEL_H, room) ?? 'what it is headed for';
        p.hiddenAt = now;
        p.clearSince = null;
        p.blockedSince = now;
        p.fadeUntil = now + FADE_MS;
        this.holdLabel(p);
        room.taken.push(p.box.x0, p.box.y0, p.box.x1, p.box.y1);
      }
    } else if (p.frames <= 2) {
      // (a new pilot's name comes with its mark's second frame, once how fast the mark moves is known)
      if (p.frames === 2 && steady) side = placeLabel(p.x, p.y, w, LABEL_H, room, _label, null, ROOM_MARGIN);
      if (p.frames === 2 && !side) {
        p.hiddenAt = now;
        p.why = steady ? 'no room' : 'too fast to read';
      }
    } else {
      const roomy = p.side && fits(p.side, p.x, p.y, w, LABEL_H, room, _label, ROOM_MARGIN);
      if (roomy) {
        p.blockedSince = null;
        p.clearSince ??= now;
      } else {
        p.clearSince = null;
        p.blockedSince ??= now;
      }
      if (steady && now - p.hiddenAt >= ROOM_MS) {
        if (roomy && now - p.clearSince >= ROOM_MS) side = p.side;
        else if (!roomy && now - p.blockedSince >= ROOM_MS) side = placeLabel(p.x, p.y, w, LABEL_H, room, _label, null, ROOM_MARGIN);
      }
    }
    if (side && side !== p.side) {
      p.side = side;
      p.blockedSince = null;
    }
    if (side) p.why = null;
    p.shown = !!side;
    p.lbl.classList.toggle('out', !side);
    if (!side) return;
    room.taken.push(_label.x0, _label.y0, _label.x1, _label.y1);
    Object.assign(p.box, _label);
    p.boxX = p.x;
    p.boxY = p.y;
    if (p.held) {
      p.held = false;
      p.lbl.style.translate = '';
    }
    this.setPilotLabel(p, `${esc(m.label)}<small>${range}</small>`, side, _label.y0 - p.y);
  }

  // Keeps pilot `p`'s name where it last stood (its mark moving on), while it fades out.
  holdLabel(p) {
    p.held = true;
    p.lbl.style.translate = `${(p.boxX - p.x).toFixed(1)}px ${(p.boxY - p.y).toFixed(1)}px`;
  }

  // A pilot's name and range, and which side of its mark they sit and how far above the mark their top is.
  setPilotLabel(p, html, side, top) {
    if (p._html !== html) {
      p.lbl.innerHTML = html;
      p._html = html;
    }
    const place = `${side}:${top.toFixed(0)}`;
    if (p._place === place) return;
    p._place = place;
    const s = p.lbl.style;
    const gap = `${MARK_R + LABEL_GAP}px`;
    s.left = side === 'right' ? gap : side === 'left' ? 'auto' : '0';
    s.right = side === 'left' ? gap : '';
    s.top = `${top.toFixed(0)}px`;
    s.textAlign = side === 'left' ? 'right' : side === 'above' ? 'center' : '';
    s.transform = side === 'above' ? 'translateX(-50%)' : '';
  }

  // The label of a marker other than a pilot's: its name only when you look at it (or have targeted it), else its range.
  otherLabel(e, m, range, W, H) {
    const g = this.game;
    let eta = '';
    // (none for stars: the drive's speed keeps pace with the distance, so a straight division lies)
    if (m.target && m.kind !== 'system' && g.mode === 'ship' && Math.abs(g.ship.speed) > 50) {
      const secs = m.dist / Math.abs(g.ship.speed);
      eta = secs < 3600 ? ` · ETA ${secs < 90 ? secs.toFixed(0) + 's' : (secs / 60).toFixed(0) + 'm'}` : '';
    }
    const near = !e._off && Math.hypot(e._sx - W / 2, e._sy - H / 2) < Math.min(W, H) * 0.12;
    return m.target || near ? `${esc(m.label)}<small>${range}${eta}</small>` : `<small>${range}</small>`;
  }

  // The label of a marker other than a pilot's.
  setLabel(e, html) {
    if (e._lbl !== html) {
      e._lblEl.innerHTML = html;
      e._lbl = html;
    }
  }

  updateSpeedLines(dt) {
    const g = this.game;
    const c = this.speedLines;
    // pulse drive only: boosting has the world-space streaks (in space), and these screen lines over
    // a blue sky or the sea read as scratches on the picture
    // (and not over the map or a menu)
    const intensity = g.mode === 'ship' && g.ship.mode === 'pulse' && !g.overlay ? g.speedEffect || 0 : 0;
    if (intensity < 0.01) {
      if (c.style.opacity !== '0') c.style.opacity = 0;
      return;
    }
    c.style.opacity = Math.min(1, intensity);
    if (c.width !== window.innerWidth) {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const cx = c.width / 2;
    const cy = c.height / 2;
    if (!this.lines) {
      this.lines = Array.from({ length: 140 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), s: 0.5 + Math.random() }));
    }
    const maxR = Math.hypot(cx, cy);
    ctx.lineCap = 'round';
    for (const l of this.lines) {
      l.r += dt * l.s * (0.8 + intensity * 2.5);
      if (l.r > 1) {
        l.r = 0.15 + Math.random() * 0.1;
        l.a = Math.random() * Math.PI * 2;
      }
      const r0 = l.r * maxR;
      const r1 = r0 + (20 + 160 * intensity) * l.r;
      const alpha = Math.min(1, l.r * 1.5) * 0.5 * intensity;
      ctx.strokeStyle = `rgba(200,230,255,${alpha})`;
      ctx.lineWidth = 1 + l.r * 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(l.a) * r0, cy + Math.sin(l.a) * r0);
      ctx.lineTo(cx + Math.cos(l.a) * r1, cy + Math.sin(l.a) * r1);
      ctx.stroke();
    }
  }
}
