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
    this.updateSpeedLines(dt);
    this.underwater.style.opacity = g.player && mode === 'foot' && g.player.headUnderwater ? 1 : 0;
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
