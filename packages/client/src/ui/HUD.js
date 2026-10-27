// DOM heads-up display.
import * as THREE from 'three';
import { RESOURCES, resourceIcon } from '../gameplay/Inventory.js';
import { LY, fmtLy } from '@astra/shared/world';
import { EdgeCompass } from './EdgeCompass.js';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { LABEL_GAP, LABEL_H, MARK_R, ROOM_MARGIN, addCovers, blockedBy, fits, labelWidth, makeRoom, markOf, nudge, outlineBands, placeLabel, screenBounds } from '../remote/markers.js';

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

/** The corners (x, y, z in its own space, flat) of the convex hull round every mesh of `model`. */
function hullCorners(model) {
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const points = [];
  // (one point a 2 cm cell: the hull is the same, and found sooner)
  const cells = new Set();
  model.traverse((o) => {
    const pos = o.isMesh && o.geometry?.attributes.position;
    if (!pos) return;
    m.multiplyMatrices(toModel, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m);
      const key = `${Math.round(v.x * 50)},${Math.round(v.y * 50)},${Math.round(v.z * 50)}`;
      if (cells.has(key)) continue;
      cells.add(key);
      points.push(v);
    }
  });
  if (points.length < 4) return new Float32Array(points.flatMap((v) => v.toArray()));
  const hull = new ConvexHull().setFromPoints(points);
  return new Float32Array(hull.vertices.flatMap((v) => v.point.toArray()));
}
/** How long (ms) a pilot's mark or name takes to fade in or out (style.css's transition), and how long a name gone stays
 * gone at least: until its side has had room that long, or had none that long before it takes another. */
const FADE_MS = 150;
const ROOM_MS = 150;
/** Px from the screen's edges a pilot's ship must be in from to be marked, and may drift out to once it is. */
const VIEW_IN = 40;
const VIEW_OUT = 24;
/** Px/s past which a pilot's mark crosses the screen too fast for its name to be read: one gone stays gone. */
const NAME_SPEED = 1200;

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

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

// two thin gauge arcs either side of a reticle, as one SVG
const ARC_LEN = 1;
function gaugeSvg(left, right, r) {
  const arc = (side) => {
    // 100-degree arc centred on the left (or right) of the circle
    const a0 = ((side < 0 ? 130 : -50) * Math.PI) / 180;
    const a1 = ((side < 0 ? 230 : 50) * Math.PI) / 180;
    const p = (a) => `${(r * Math.cos(a) + 50).toFixed(2)} ${(r * Math.sin(a) + 50).toFixed(2)}`;
    // both arcs start at the bottom, so gauges fill upward
    return side < 0 ? `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}` : `M ${p(a1)} A ${r} ${r} 0 0 0 ${p(a0)}`;
  };
  return `<svg class="gauges" viewBox="0 0 100 100">
    <g class="gauge left"><path class="track" d="${arc(-1)}" pathLength="1"/><path class="fill g-${left}" d="${arc(-1)}" pathLength="1"/></g>
    <g class="gauge right"><path class="track" d="${arc(1)}" pathLength="1"/><path class="fill g-${right}" d="${arc(1)}" pathLength="1"/></g>
  </svg>`;
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
    this.layer = el('div', 'hud-layer', root);
    this.markersEl = el('div', 'markers', this.layer);
    // on foot: a dot with two gauge arcs (mining heat left, jetpack right) that only show while in use
    this.crosshair = el('div', 'crosshair', this.layer, `<b></b>${gaugeSvg('heat', 'jet', 17)}`);
    // in flight: reticle with shield / pulse arcs, speed to the left and altitude to the right
    this.reticle = el(
      'div',
      'ship-reticle',
      this.layer,
      `<b></b>${gaugeSvg('shield', 'pulse', 30)}<div class="r-speed"></div><div class="r-thr"><i></i></div><div class="r-alt"></div><div class="r-mode"></div>`,
    );
    this.rSpeed = this.reticle.querySelector('.r-speed');
    this.rAlt = this.reticle.querySelector('.r-alt');
    this.rMode = this.reticle.querySelector('.r-mode');
    this.rThr = this.reticle.querySelector('.r-thr i');
    // north is the edge of space
    this.edgeCompass = new EdgeCompass(game, this.layer);
    this.location = el('div', 'location', this.layer);
    this.vitals = el('div', 'vitals', this.layer);
    // a hostile sky ahead, and how the hull is holding once it bites
    this.hzWarn = el('div', 'hz-warn', this.layer);
    this.inventory = el('div', 'inventory', this.layer);
    this.prompt = el('div', 'prompt', this.layer);
    this.toasts = el('div', 'toasts', this.layer);
    // the server's word on the player's shots: damage numbers off the reticle
    this.hitsEl = el('div', 'hits', this.layer);
    // (beside the layer, not in it: banners show through a cutscene, which fades the rest of the HUD out)
    this.banner = el('div', 'banner', root);
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
    if (!v) this.edgeCompass.update(false);
  }

  // (as plain text: a toast can carry the server's words, a notice event, which must never be read as markup)
  toast(text, kind = 'info') {
    if (text === this.lastToast && this.now() - this.lastToastT < 2500) return;
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
  showBanner(title, sub, lines = []) {
    (this.bannerQueue ||= []).push({ title, sub, lines, at: this.now() });
    this.pumpBanners();
  }

  pumpBanners() {
    const now = this.now();
    if (now < (this.bannerUntil || 0)) {
      this.cancel(this.bannerTimer);
      this.bannerTimer = this.later(() => this.pumpBanners(), this.bannerUntil - now + 50);
      return;
    }
    let b;
    while ((b = this.bannerQueue.shift()) && now - b.at > 12000);
    if (!b) return;
    // two lines only — what it is and its name; the details (and rewards, which the units counter
    // shows) were reading as filler
    // (as text, never markup: banners carry names players and the server chose)
    const sub = el('div', 'b-sub');
    sub.textContent = b.sub;
    const title = el('div', 'b-title');
    title.textContent = b.title;
    this.banner.replaceChildren(sub, title);
    // raised in a cutscene, it is a title card in the letterbox's top bar, and stays there for its life
    this.banner.classList.toggle('in-bar', !!this.game.cutscenes?.active);
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerUntil = now + 6200;
    if (this.bannerQueue.length) this.pumpBanners();
  }

  /** Drops the banner showing and those waiting. */
  clearBanners() {
    this.bannerQueue = [];
    this.bannerUntil = 0;
    this.cancel(this.bannerTimer);
    this.banner.classList.remove('show');
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

  // fill one of the gauge arcs (0..1); `show` fades it in, otherwise it rests nearly invisible
  arc(root, name, value, show) {
    const a = (root._arcs ||= {})[name] || (root._arcs[name] = root.querySelector(`.g-${name}`));
    const v = Math.max(0, Math.min(1, value));
    a.style.strokeDashoffset = (ARC_LEN * (1 - v)).toFixed(1);
    a.parentNode.classList.toggle('on', show);
    a.parentNode.classList.toggle('low', v < 0.25);
  }

  update(dt) {
    const g = this.game;
    if (!this.visible) return;
    this.readAvoid();
    const mode = g.mode;
    const ship = g.ship;
    const player = g.player;
    this.root.dataset.mode = mode;
    // out of the way under the map and the other menus; a cutscene fades it out as its letterbox closes in, but for the
    // banners it raises
    const cine = g.cutscenes?.letterbox ?? 0;
    const hidden = g.overlay && g.overlay !== 'cutscene';
    this.layer.style.visibility = hidden ? 'hidden' : '';
    this.banner.style.visibility = hidden ? 'hidden' : '';
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
      this.arc(this.crosshair, 'heat', 1 - mt.heat, mt.firing || mt.heat > 0.05);
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
      this.arc(this.reticle, 'pulse', ship.pulseFuel / 100, ship.mode === 'pulse' || ship.pulseFuel < 99.5);
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
    this.edgeCompass.update(!g.overlay && !cine && (mode === 'ship' || mode === 'foot'));
    this.updateMarkers();
    this.updateHits(g.net?.combat);
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

  // What the server says the player's shots did and the blows it took (ARCHITECTURE §20): a number rising off the reticle
  // for each hit (gold for a kill), a flash for a blow taken, and a kill's XP and loot as toasts.
  updateHits(feed) {
    if (!feed) return;
    const { dealt, taken, gained } = feed.take();
    for (const h of dealt) this.hitNumber(h.amount, h.killed);
    if (taken.length) this.flash('damage');
    for (const x of gained) this.toast(x.what === 'xp' ? `+${x.count} XP` : `+${x.count} ${x.what === 'units' ? 'units' : RESOURCES[x.what]?.name ?? x.what}`, 'good');
  }

  hitNumber(amount, killed) {
    const e = el('div', 'hit-number', this.hitsEl);
    e.textContent = String(amount > 0 ? Math.max(1, Math.round(amount)) : 0);
    const dx = ((this.hitsEl.children.length % 5) - 2) * 18;
    // (the reticle readouts' type and the HUD's palette: style.css's tokens)
    Object.assign(e.style, {
      position: 'absolute', left: `calc(50% + ${dx}px)`, top: '44%', transform: 'translate(-50%, 0)', pointerEvents: 'none',
      color: killed ? 'var(--accent-hi)' : 'var(--text)', fontFamily: 'var(--font-cond)', fontWeight: '500', fontSize: killed ? '20px' : '16px',
      lineHeight: '1', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em', textShadow: 'var(--shadow)',
      transition: 'transform 0.9s ease-out, opacity 0.9s ease-in',
    });
    void e.offsetWidth;
    e.style.transform = 'translate(-50%, -42px)';
    e.style.opacity = '0';
    this.later(() => e.remove(), 1000);
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
        p = { e, lbl: e.querySelector('.lbl'), frames: 0, nudged: 0, side: null, shown: false, why: null, goneAt: 0, hiddenAt: now, clearSince: null, blockedSince: null, at: now, vx: 0, vy: 0 };
        this.pilots.set(m.id, p);
        // (laid out once hidden, so it fades in)
        void e.offsetWidth;
      }
      markOf(b, _mark);
      p.nudged = nudge(_mark, keepOut, W, H, p.nudged);
      // (how fast its mark crosses the screen, px/ms, which its name looks ahead by)
      const dt = now - p.at;
      if (p.frames > 0 && !p.goneAt && dt > 0) {
        p.vx = (_mark.x - p.x) / dt;
        p.vy = (_mark.y - p.y) / dt;
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
      } else if (now - p.goneAt > FADE_MS + 50) {
        p.e.remove();
        this.pilots.delete(id);
      }
    }
    // (the names shown first, nearest first among them: the sort keeps the order)
    shown.sort(namedFirst);
    for (const p of shown) this.placePilotLabel(p, room, now);
  }

  // Where pilot `p`'s name goes this frame, if anywhere (see updatePilots).
  placePilotLabel(p, room, now) {
    const m = p.m;
    const range = fmtDist(m.dist);
    const w = labelWidth(m.label ?? '', range);
    room.takenFrom = p.takenFrom;
    room.takenTo = p.takenTo;
    room.shipFrom = p.shipFrom;
    room.shipTo = p.shipTo;
    room.aheadX = p.vx * ROOM_MS;
    room.aheadY = p.vy * ROOM_MS;
    let side = null;
    const steady = Math.hypot(p.vx, p.vy) * 1000 <= NAME_SPEED;
    if (p.shown) {
      if (fits(p.side, p.x, p.y, w, LABEL_H, room, _label)) side = p.side;
      else {
        // (what it ran into, for the dev captures)
        p.why = blockedBy(p.side, p.x, p.y, w, LABEL_H, room);
        p.hiddenAt = now;
        p.clearSince = null;
        p.blockedSince = now;
      }
    } else if (p.frames <= 2) {
      // (a new pilot's name comes with its mark's second frame, once how fast the mark moves is known)
      if (p.frames === 2 && steady) side = placeLabel(p.x, p.y, w, LABEL_H, room, _label, null, ROOM_MARGIN);
      if (p.frames === 2 && !side) {
        p.hiddenAt = now;
        p.why = 'no room';
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
    this.setPilotLabel(p, `${esc(m.label)}<small>${range}</small>`, side, _label.y0 - p.y);
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
