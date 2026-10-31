// DOM heads-up display.
import * as THREE from 'three';
import { RESOURCES, resourceIcon } from '../gameplay/Inventory.js';
import { LY, fmtLy } from '@astra/shared/world';
import { EdgeCompass } from './EdgeCompass.js';

const _v = new THREE.Vector3();

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

function setText(e, html) {
  if (e._html !== html) {
    e.innerHTML = html;
    e._html = html;
  }
}

// two thin gauge arcs either side of a reticle, as one SVG: each a dark halo (so it reads over a bright sky or the beam's
// glare), a track, its fill, a mark (a tick across the arc at a level that matters: where the heat lockout ends) and a
// sheen (a bright dash that climbs the fill while it refills)
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
    `<path class="fill g-${name}" d="${arc(side)}" pathLength="1"/><path class="sheen" d="${arc(side)}" pathLength="1"/><path class="mark"/></g>`;
  return `<svg class="gauges" viewBox="0 0 100 100">${gauge(-1, left)}${gauge(1, right)}</svg>`;
}

// a rate as the readouts show it: "+2.0/s", "−0.35/s"
const fmtRate = (v) => `${v > 0 ? '+' : '\u2212'}${Math.abs(v).toFixed(Math.abs(v) < 1 ? 2 : 1)}/s`;

// a gauge level: a finite 0–1 (anything else draws as empty, never as a full arc)
const unit = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
/** A change of more than this much of an arc in one frame is a jump (a server sync, a refill, a chunk of heat): the gauge
 * lands on it at once rather than tweening up from where it was. */
const ARC_JUMP = 0.08;

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
    // the server's word on the player's shots: damage numbers off the reticle
    this.hitsEl = el('div', 'hits', this.layer);
    // (beside the layer, not in it: banners show through a cutscene, which fades the rest of the HUD out)
    this.banner = el('div', 'banner', root);
    this.flashEl = el('div', 'flash', root);
    this.underwater = el('div', 'underwater', root);
    this.speedLines = el('canvas', 'speedlines', root);
    this.scanRing = el('div', 'scan-ring', root);
    this.markerPool = [];
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
    this.band.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    // (in a cutscene's top bar it is on black already)
    if (!this.game.cutscenes?.active) this.band.classList.add('show');
    this.bannerUntil = now + 6200;
    if (this.bannerQueue.length) this.pumpBanners();
  }

  /** Drops the banner showing and those waiting. */
  clearBanners() {
    this.bannerQueue = [];
    this.bannerUntil = 0;
    this.cancel(this.bannerTimer);
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
  // gauge is drawn, as it turns on, and on a jump, it is drawn `snap`: at its value and in its colours at once, with no
  // transition from wherever it stood (the class lasts the one frame).
  arc(root, name, value, show, states = null) {
    const a = (root._arcs ||= {})[name] || (root._arcs[name] = root.querySelector(`.g-${name}`));
    const g = a.parentNode;
    const v = unit(value);
    const snap = a._v === undefined || (show && !g.classList.contains('on')) || Math.abs(v - a._v) > ARC_JUMP;
    a._v = v;
    g.classList.toggle('snap', snap);
    const off = (ARC_LEN * (1 - v)).toFixed(3);
    if (a._off !== off) a.style.strokeDashoffset = a._off = off;
    g.classList.toggle('on', show);
    for (const [cls, on] of Object.entries(states ?? { low: v < 0.25 })) g.classList.toggle(cls, !!on);
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
      this.arc(this.crosshair, 'heat', heat.fill, heat.show, { hot: heat.hot, over: heat.over });
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
      this.arc(this.reticle, 'charge', charge.fill, charge.shown, { low: charge.fill < 0.25, regen: charge.regen, empty: charge.empty });
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
    this.edgeCompass.update(!g.overlay && !cine && (mode === 'ship' || mode === 'foot'));
    this.updateMarkers();
    this.updateHits(g.net?.combat);
    this.updateSpeedLines(dt);
    this.underwater.style.opacity = g.player && mode === 'foot' && g.player.headUnderwater ? 1 : 0;
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

  updateMarkers() {
    const g = this.game;
    const cam = g.engine.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    // none while the camera swings round to look back past the ship: it is a view, not a heading
    const markers = g.mode === 'ship' && (g.ship.lookBack || 0) > 0.03 ? [] : g.getMarkers();
    let i = 0;
    for (const m of markers) {
      let e = this.markerPool[i];
      if (!e) {
        e = el('div', 'marker', this.markersEl, '<div class="icon"></div><div class="lbl"></div>');
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
      e.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      e.className = `marker ${m.kind} ${off ? 'off' : ''} ${m.target ? 'targeted' : ''}`;
      let eta = '';
      // (none for stars: the drive's speed keeps pace with the distance, so a straight division lies)
      if (m.target && m.kind !== 'system' && g.mode === 'ship' && Math.abs(g.ship.speed) > 50) {
        const secs = m.dist / Math.abs(g.ship.speed);
        eta = secs < 3600 ? ` · ETA ${secs < 90 ? secs.toFixed(0) + 's' : (secs / 60).toFixed(0) + 'm'}` : '';
      }
      // names only for the marker you are looking at (or have targeted); others just show range
      const near = !off && Math.hypot(sx - W / 2, sy - H / 2) < Math.min(W, H) * 0.12;
      const lbl = m.target || near ? `${m.label}<small>${fmtDist(m.dist)}${eta}</small>` : `<small>${fmtDist(m.dist)}</small>`;
      if (e._lbl !== lbl) {
        e.querySelector('.lbl').innerHTML = lbl;
        e._lbl = lbl;
      }
      e.style.display = '';
    }
    for (; i < this.markerPool.length; i++) this.markerPool[i].style.display = 'none';
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
