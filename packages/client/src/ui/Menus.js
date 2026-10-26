// Title screen, pause screen, settings and controls sheets, trade terminal, the 3D navigation map
// and the warp sequence.
import { RESOURCES } from '../gameplay/Inventory.js';
import { hasSave, applyUpgrade } from '../gameplay/Save.js';
import { MapView } from './map/MapView.js';

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

const KEYS = [
  ['Starship', [['Steer', ['Mouse']], ['Throttle up · down', ['W', 'S']], ['Roll · strafe when hovering', ['A', 'D']], ['Thrusters up · down', ['Space', 'C']], ['Boost', ['Shift']], ['Pulse drive', ['J']], ['Land · take off', ['E']], ['Exit ship', ['F']], ['Lasers', ['LMB']], ['Camera view', ['V']], ['Look back', ['B']]]],
  ['On foot', [['Move', ['W', 'A', 'S', 'D']], ['Sprint', ['Shift']], ['Jump · jetpack', ['Space']], ['Mining beam', ['LMB']], ['Scanner pulse', ['C']], ['Interact · analyze', ['E']], ['Board ship', ['F']]]],
  ['General', [['Navigation map', ['M']], ['Controls', ['H']], ['Release mouse', ['Esc']], ['Debug stats', ['`']]]],
];

function controlsHTML() {
  return `<div class="keys">${KEYS.map(([group, rows]) => `<h4 class="mono">${group}</h4>${rows.map(([what, keys]) => `<div>${what}<span>${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span></div>`).join('')}`).join('')}</div>`;
}

// numbered menu rows: [action, label, extra class, starts disabled]
function menuHTML(items) {
  return items
    .map(([act, label, cls = '', disabled = false], i) => `<button class="t-item ${cls}" data-act="${act}" ${disabled ? 'disabled' : ''}><i>${String(i + 1).padStart(2, '0')}</i><span>${label}</span><em>→</em></button>`)
    .join('');
}

const SHOP = [
  { id: 'warpcell', icon: 'WRP', name: 'Warp Cell', desc: 'Fuel for one hyperdrive jump to a neighbouring star system.', price: 1800 },
  { id: 'pulse', icon: 'PLS', name: 'Pulse Fuel', desc: 'Refill the pulse drive for long hops between planets.', price: 300 },
  { id: 'shield', icon: 'SHD', name: 'Shield Recharge', desc: 'Restore the starship’s shields to full.', price: 200 },
  { id: 'beam', icon: 'DRL', name: 'Optical Drill', desc: 'The mining beam extracts half as much again, and runs cooler.', price: 4500, once: true },
  { id: 'jet', icon: 'JET', name: 'Efficient Jetpack', desc: 'Jetpack fuel lasts twice as long.', price: 3500, once: true },
  { id: 'thrust', icon: 'THR', name: 'Photon Thrusters', desc: 'A quarter more top speed for the starship.', price: 6000, once: true },
  // for hostile skies
  { id: 'thermal', icon: 'THM', name: 'Thermal Plating', desc: 'The hull holds out three times longer in searing heat and cryogenic cold.', price: 6500, once: true },
  { id: 'pressure', icon: 'PRS', name: 'Pressure Hull', desc: 'Three times longer under crushing atmospheres and in the depths of gas giants.', price: 8000, once: true },
  { id: 'coating', icon: 'HAZ', name: 'Hazard Coating', desc: 'Shrugs off acid, radiation and storm damage three times longer.', price: 5500, once: true },
];


export class Menus {
  constructor(game) {
    this.game = game;
    this.root = el('div', 'menus', document.body);
    this.bought = new Set();
    this.loadSettings();
    this.buildTitle();
    this.pauseHint = el('div', 'overlay pause-menu', this.root);
    this.buildPause();
    this.trade = el('div', 'overlay panel-screen', this.root);
    this.help = el('div', 'overlay panel-screen', this.root);
    this.help.innerHTML = `<div class="panel frame" style="width:min(720px,94vw)">
      <div class="panel-head"><div><div class="label">Reference</div><h2>Controls</h2></div><button class="close-x" data-close>✕</button></div>
      ${controlsHTML()}</div>`;
    this.help.addEventListener('click', (e) => {
      if (e.target === this.help || e.target.closest('[data-close]')) this.toggleHelp();
    });
    this.buildMap();
    this.warpCanvas = el('canvas', 'overlay warp-canvas', this.root);
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Escape') {
          if (this.game.overlay) this.closeAll();
        }
        if (e.code === 'KeyM' && this.game.overlay === 'map') {
          e.stopPropagation();
          this.closeAll();
        }
        if (e.code === 'KeyH' && this.game.overlay === 'help') {
          e.stopPropagation();
          this.toggleHelp();
        }
      },
      true,
    );
  }

  // ---------- title ----------
  buildTitle() {
    this.title = el('div', 'overlay title-screen show', this.root);
    this.hasSave = hasSave();
    const items = [
      ['start', this.hasSave ? 'Continue' : 'New game', 'primary', true],
      ...(this.hasSave ? [['new', 'New game', '', true]] : []),
      ['settings', 'Settings'],
      ['controls', 'Controls'],
      ['credits', 'Credits'],
    ];
    this.title.innerHTML = `
      <main class="t-main">
        <div class="logo">
          <span class="logo-pre">NEXT</span>
          <h1 class="logo-word">HORIZON</h1>
          <div class="logo-rule"><i></i></div>
          <div class="logo-tag">There is always another one</div>
        </div>
        <nav class="t-menu">${menuHTML(items)}</nav>
      </main>
      <footer class="t-foot">
        <div class="t-load"><div class="bar"><b></b></div><span class="mono">Preparing the home system</span></div>
        <span class="mono">Build 0.9</span>
      </footer>
      ${this.sheetsHTML()}`;
    this.startBtn = this.title.querySelector('[data-act="start"]');
    this.newBtn = this.title.querySelector('[data-act="new"]') || document.createElement('button');
    this.bindSheets(this.title);
    this.bindSettings(this.title);
    // sound needs a gesture first: the first click or key on the title starts it (and its music)
    const wake = () => this.game.audio.start();
    this.title.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
    this.startBtn.addEventListener('click', () => {
      this.title.classList.remove('show');
      this.game.startGame(this.hasSave);
    });
    this.newBtn.addEventListener('click', () => {
      this.title.classList.remove('show');
      this.game.startGame(false);
    });
    this.game.hud.setVisible(false);
  }

  // menu items that open a sheet beside the menu (settings, controls); a second click closes it
  bindSheets(root) {
    root.querySelectorAll('.t-item').forEach((b) => b.addEventListener('mouseenter', () => !b.disabled && this.game.audio?.play('hover')));
    const sheets = root.querySelectorAll('[data-sheet]');
    const items = root.querySelectorAll('[data-act="settings"],[data-act="controls"],[data-act="credits"]');
    // (the row whose sheet is open stays lit)
    const mark = () => items.forEach((b) => b.classList.toggle('open', !!root.querySelector(`.sheet.open[data-sheet="${b.dataset.act}"]`)));
    const show = (name) => {
      if (name === 'credits') this.fillCredits(root);
      sheets.forEach((s) => s.classList.toggle('open', s.dataset.sheet === name && !s.classList.contains('open')));
      mark();
      this.game.audio?.play('ui');
    };
    items.forEach((b) => b.addEventListener('click', () => show(b.dataset.act)));
    root.querySelectorAll('.sheet [data-close]').forEach((b) =>
      b.addEventListener('click', () => {
        sheets.forEach((s) => s.classList.remove('open'));
        mark();
      }),
    );
  }

  onLoaded() {
    this.loaded = true;
  }

  update(dt) {
    const g = this.game;
    if (g.mode === 'title') {
      const home = g.system.homePlanet;
      this.waitT = (this.waitT || 0) + 1;
      const ready = this.loaded && (home.terrain.isReady() || this.waitT > 600);
      if (ready && this.startBtn.disabled) {
        this.startBtn.disabled = false;
        this.newBtn.disabled = false;
        this.title.querySelector('.t-load').classList.add('done');
      }
    }
    if (g.overlay === 'map') this.updateMap(dt);
    if (g.overlay === 'trade') this.refreshTradeUnits();
  }

  updatePauseHint() {
    const g = this.game;
    const show = (g.mode === 'ship' || g.mode === 'foot') && !g.input.locked && !g.overlay;
    if (show && !this.pauseHint.classList.contains('show')) this.refreshPause();
    this.pauseHint.classList.toggle('show', show);
  }

  // ---------- settings ----------
  loadSettings() {
    const def = { sens: 1, invertY: false, volume: 0.8, music: 0.32, quality: 'high' };
    try {
      this.settings = { ...def, ...JSON.parse(localStorage.getItem('next-horizon-settings') || '{}') };
    } catch {
      this.settings = def;
    }
    this.applySettings();
  }

  saveSettings() {
    try {
      localStorage.setItem('next-horizon-settings', JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
    this.applySettings();
  }

  applySettings() {
    const g = this.game;
    const st = this.settings;
    g.input.sensitivity = st.sens;
    g.input.invertY = st.invertY;
    if (g.audio.master) g.audio.master.gain.value = st.volume;
    if (g.audio.music) g.audio.music.gain.value = st.music;
    g.audio.settings = st;
    const q = { low: [0.75, 0.15], medium: [1.0, 0.45], high: [1.5, 0.7] }[st.quality] || [1.5, 0.7];
    g.engine.maxPixelRatio = Math.min(window.devicePixelRatio, q[0]);
    if (g.engine.pixelRatio > g.engine.maxPixelRatio) {
      g.engine.pixelRatio = g.engine.maxPixelRatio;
      g.engine.renderer.setPixelRatio(g.engine.pixelRatio);
      g.engine.resize();
    }
    g.engine.atmoPass.uniforms.uCloudQuality.value = q[1];
  }

  settingsHTML() {
    const st = this.settings;
    const range = (k, min, max, step, v, fmt) => `<input class="range" type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-k="${k}"><output>${fmt(v)}</output>`;
    return `<div class="settings">
      <div class="set-row"><div>Mouse sensitivity</div><div class="ctl">${range('sens', 0.3, 2.5, 0.05, st.sens, (v) => (+v).toFixed(2))}</div></div>
      <div class="set-row"><div>Invert look</div><div class="ctl"><button class="toggle ${st.invertY ? 'on' : ''}" data-k="invertY" aria-label="Invert vertical look"></button></div></div>
      <div class="set-row"><div>Volume</div><div class="ctl">${range('volume', 0, 1, 0.01, st.volume, (v) => Math.round(v * 100))}</div></div>
      <div class="set-row"><div>Music</div><div class="ctl">${range('music', 0, 0.8, 0.01, st.music, (v) => Math.round((v / 0.8) * 100))}</div></div>
      <div class="set-row"><div>Graphics</div><div class="ctl"><div class="segmented" data-k="quality">${['low', 'medium', 'high'].map((q) => `<button data-v="${q}" class="${st.quality === q ? 'on' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div></div></div>
    </div>`;
  }

  bindSettings(root) {
    const fill = (inp) => inp.style.setProperty('--fill', `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`);
    root.querySelectorAll('input.range[data-k]').forEach((inp) => {
      fill(inp);
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        this.settings[k] = parseFloat(inp.value);
        fill(inp);
        const out = inp.nextElementSibling;
        if (out) out.textContent = k === 'sens' ? (+inp.value).toFixed(2) : k === 'music' ? Math.round((inp.value / 0.8) * 100) : Math.round(inp.value * 100);
        this.saveSettings();
      });
    });
    root.querySelectorAll('.toggle[data-k]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.k;
        this.settings[k] = !this.settings[k];
        b.classList.toggle('on', this.settings[k]);
        this.saveSettings();
        this.game.audio?.play('ui');
      }),
    );
    root.querySelectorAll('.segmented[data-k]').forEach((seg) =>
      seg.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          this.settings[seg.dataset.k] = b.dataset.v;
          seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          this.saveSettings();
          this.game.audio?.play('ui');
        }),
      ),
    );
  }

  // ---------- pause ----------
  buildPause() {
    this.pauseHint.innerHTML = `
      <main class="t-main">
        <div class="label">Next Horizon</div>
        <h2>Paused</h2>
        <div class="where mono"></div>
        <nav class="t-menu">${menuHTML([['resume', 'Resume', 'primary'], ['save', 'Save game'], ['settings', 'Settings'], ['controls', 'Controls']])}</nav>
      </main>
      ${this.sheetsHTML()}`;
    this.pauseHint.querySelector('[data-act="resume"]').addEventListener('click', () => this.game.input.lock());
    this.pauseHint.addEventListener('click', (e) => {
      if (e.target === this.pauseHint) this.game.input.lock();
    });
    this.pauseHint.querySelector('[data-act="save"]').addEventListener('click', () => this.game.save(true));
    this.bindSheets(this.pauseHint);
    this.bindSettings(this.pauseHint);
  }

  refreshPause() {
    const g = this.game;
    this.pauseHint.querySelectorAll('.sheet').forEach((s) => s.classList.remove('open'));
    this.pauseHint.querySelectorAll('.t-item.open').forEach((b) => b.classList.remove('open'));
    const f = g.focusFrame;
    // (as the HUD names it: clear of a station, the world below)
    const place = f && f.kind === 'station' && f.distanceTo(g.camWorld) > 2500 ? f.parent : f;
    const where = g.universe.deep ? 'Interstellar space' : place ? `${place.name} · ${g.system.name} system` : `${g.system.name} system`;
    this.pauseHint.querySelector('.where').textContent = where;
  }

  // the settings and controls sheets that open beside a menu
  sheetsHTML() {
    const sheet = (name, title, body) => `<aside class="sheet frame" data-sheet="${name}"><header class="sheet-head"><h3>${title}</h3><button class="close" data-close>✕</button></header>${body}</aside>`;
    return sheet('settings', 'Settings', this.settingsHTML()) + sheet('controls', 'Controls', controlsHTML()) + sheet('credits', 'Credits', '<div class="credits"></div>');
  }

  // music and sound credits, from the audio's own credits file (the CC BY ones must be shown)
  async fillCredits(root) {
    const box = root.querySelector('.credits');
    if (!box || box.dataset.done) return;
    box.dataset.done = '1';
    let text;
    try {
      text = await (await fetch('/audio/CREDITS.md')).text();
    } catch {
      return;
    }
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const music = [...text.matchAll(/^- `music\/[^`]+` - "([^"]+)" by ([^(]+?) \(/gm)].map((m) => `<div><span>${esc(m[1])}</span><small>${esc(m[2])}</small></div>`);
    const summary = text.split(/^## Attribution summary.*$/m)[1] || '';
    const sound = [...summary.matchAll(/^- (.+)$/gm)].map((m) => m[1]).filter((l) => !l.startsWith('Music:')).map((l) => `<div><span>${esc(l)}</span></div>`);
    box.innerHTML = `<h4 class="mono">Music · CC BY 4.0</h4>${music.join('')}<h4 class="mono">Sound · CC BY 3.0 / 4.0</h4>${sound.join('')}
      <p>Other sounds: CC0 and public domain (Kenney, OpenGameArt and others). Full list with sources: audio/CREDITS.md</p>`;
  }

  open(name, elm) {
    const g = this.game;
    g.overlay = name;
    elm.classList.add('show');
    g.input.unlock();
    this.updatePauseHint();
  }

  closeAll() {
    const g = this.game;
    if (g.overlay === 'map') this.mapView.close();
    // overlays added from outside (the dev teleporter)
    for (const o of this.extraOverlays || []) {
      if (g.overlay === o.name) o.onClose();
      o.el.classList.remove('show');
    }
    for (const e of [this.trade, this.help, this.map]) e.classList.remove('show');
    const was = g.overlay;
    g.overlay = null;
    if (was && (g.mode === 'ship' || g.mode === 'foot')) g.input.lock();
    this.updatePauseHint();
  }

  toggleHelp() {
    if (this.game.overlay === 'help') this.closeAll();
    else if (!this.game.overlay) this.open('help', this.help);
  }

  // ---------- trade ----------
  openTrade(label, place = null) {
    this.tradeLabel = label;
    this.tradePlace = place;
    this.renderTrade();
    this.open('trade', this.trade);
    this.game.audio.play('ui');
  }

  renderTrade() {
    const g = this.game;
    const inv = g.inventory;
    let rows = '';
    for (const [id, r] of Object.entries(RESOURCES)) {
      const n = inv.items[id] || 0;
      rows += `<div class="res-row ${n ? '' : 'empty'}"><i style="background:${r.color};color:${r.color}"></i><span>${r.name}</span><span class="num">${n}</span><span class="price">${r.price}u</span>
        <button class="btn ghost small" data-sell="${id}" ${n ? '' : 'disabled'}>Sell</button></div>`;
    }
    let shop = '';
    for (const it of SHOP) {
      const owned = it.once && this.bought.has(it.id);
      shop += `<div class="shop-item ${owned ? 'owned' : ''}" title="${it.desc}"><div class="ico">${it.icon}</div><h4>${it.name}</h4>
        <div class="buy"><span>${owned ? 'Owned' : `⌬ ${it.price.toLocaleString()}`}</span><button class="btn small" data-buy="${it.id}" ${owned || inv.units < it.price ? 'disabled' : ''}>${owned ? '✓' : 'Buy'}</button></div></div>`;
    }
    this.trade.innerHTML = `<div class="panel frame">
      <div class="panel-head">
        <div><div class="label">${this.tradeLabel || 'Trade terminal'}</div><h2>${this.tradePlace || g.station.name}</h2></div>
        <div class="balance"><b class="u">${inv.units.toLocaleString()}</b><button class="close-x" data-close>✕</button></div>
      </div>
      <div class="trade-cols">
        <section><h4 class="mono col-title">Sell</h4>${rows}</section>
        <section><h4 class="mono col-title">Buy</h4><div class="shop-grid">${shop}</div></section>
      </div>
    </div>`;
    this.trade.querySelectorAll('[data-sell]').forEach((b) =>
      b.addEventListener('click', () => {
        const earned = inv.sellAll(b.dataset.sell);
        if (earned) {
          g.audio.play('sell');
          g.hud.toast(`Sold for ${earned.toLocaleString()} units`, 'good');
        }
        this.renderTrade();
      }),
    );
    this.trade.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => this.buy(b.dataset.buy)));
    this.trade.querySelector('[data-close]').addEventListener('click', () => this.closeAll());
  }

  buy(id) {
    const g = this.game;
    const it = SHOP.find((s) => s.id === id);
    if (g.inventory.units < it.price) return g.audio.play('error');
    g.inventory.units -= it.price;
    if (id === 'warpcell') g.inventory.warpCells++;
    if (id === 'pulse') g.ship.pulseFuel = 100;
    if (id === 'shield') g.ship.shield = 100;
    if (id === 'beam') g.multitool.upgrade();
    if (id === 'jet') g.player.jetEfficiency = 2;
    applyUpgrade(g, id);
    if (it.once) this.bought.add(id);
    g.audio.play('sell');
    g.hud.toast(`Purchased: ${it.name}`, 'good');
    g.save();
    this.renderTrade();
  }

  refreshTradeUnits() {
    const u = this.trade.querySelector('.u');
    if (u) u.textContent = this.game.inventory.units.toLocaleString();
  }

  // ---------- map ----------
  buildMap() {
    this.map = el('div', 'overlay map-screen', this.root);
    this.mapTab = 'system';
    this.mapView = new MapView(this.game, this.map, { onSelect: (it) => this.renderMapInfo(it) });
    this.mapTop = el('div', 'map-top', this.map);
    this.mapInfo = el('div', 'map-info frame empty', this.map);
    this.mapClose = el('button', 'close-x map-close', this.map, '✕');
    this.mapClose.addEventListener('click', () => this.closeAll());
  }

  openMap() {
    if (this.game.overlay) return;
    this.open('map', this.map);
    this.game.audio.play('ui');
    // between the stars, the galaxy is the map that matters
    if (this.game.universe.deep) this.mapTab = 'galaxy';
    this.mapView.open(this.mapTab);
    this.renderMapChrome();
  }

  setMapTab(tab) {
    this.mapTab = tab;
    this.mapView.setTab(tab);
    this.renderMapChrome();
    this.game.audio.play('ui');
  }

  renderMapChrome() {
    const g = this.game;
    const sys = this.mapTab === 'system';
    this.mapTop.innerHTML = `<h1>${sys ? g.system.name : 'Galaxy'}</h1>
      <div class="segmented"><button data-tab="system" class="${sys ? 'on' : ''}">System</button><button data-tab="galaxy" class="${sys ? '' : 'on'}">Galaxy</button></div>`;
    this.mapTop.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => b.dataset.tab !== this.mapTab && this.setMapTab(b.dataset.tab)));
    this.renderMapList();
    this.renderMapInfo(this.mapView.selected);
  }

  renderMapList() {}

  renderMapInfo(it) {
    const g = this.game;
    const scene = this.mapView.current;
    if (this.mapTab === 'galaxy') this.selectedSystem = it?.kind === 'system' && it.sys !== g.galaxy.current ? it.sys : null;
    const d = it && scene.describe(it);
    this.mapInfo.classList.toggle('empty', !d);
    if (!d) return;
    let actions = '';
    if (d.waypoint) {
      const on = g.navTarget === it.body;
      actions += `<button class="btn" data-wp>${on ? 'Waypoint ✓' : 'Set waypoint'}</button>`;
    }
    if (d.course) {
      const on = g.navTarget === it.sys;
      actions += `<button class="btn" data-course>${on ? 'Course set ✓' : 'Set course'}</button>`;
    }
    if (d.warp) {
      const canWarp = !g.warping && g.mode === 'ship' && g.ship.atmoDensity < 0.001 && g.ship.mode !== 'landed' && g.inventory.warpCells > 0;
      actions += `<button class="btn" data-warp ${canWarp ? '' : 'disabled'} title="${canWarp ? '' : g.inventory.warpCells > 0 ? 'Fly out into open space first' : 'Needs a warp cell'}">Warp</button>`;
    }
    actions += `<button class="btn ghost" data-focus>Focus</button>`;
    this.mapInfo.innerHTML = `<h2>${d.title}</h2><div class="kind">${d.kind}</div>
      ${d.stats.length ? `<div class="stats">${d.stats.map(([k, v]) => `<div><span class="mono">${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
      <div class="actions">${actions}</div>`;
    this.mapInfo.querySelector('[data-wp]')?.addEventListener('click', () => {
      g.navTarget = it.body;
      g.audio.play('ui');
      this.renderMapInfo(it);
    });
    this.mapInfo.querySelector('[data-warp]')?.addEventListener('click', () => g.warpTo(it.sys));
    // fly there yourself: a marker on the star to steer by
    this.mapInfo.querySelector('[data-course]')?.addEventListener('click', () => {
      g.navTarget = g.navTarget === it.sys ? null : it.sys;
      g.audio.play('ui');
      this.renderMapInfo(it);
    });
    this.mapInfo.querySelector('[data-focus]').addEventListener('click', () => this.mapView.focus(it));
    this.renderMapList();
  }

  updateMap(dt) {
    this.mapView.update(dt);
  }

  renderMap(dt) {
    this.mapView.render(dt);
  }

  // ---------- warp tunnel ----------
  showWarp(onMid) {
    const c = this.warpCanvas;
    c.classList.add('show');
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    const ctx = c.getContext('2d');
    const stars = Array.from({ length: 700 }, () => ({ a: Math.random() * Math.PI * 2, z: Math.random(), hue: 230 + Math.random() * 110 }));
    const t0 = performance.now();
    const dur = 5200;
    // the system swap must not depend on rAF (which stalls in background tabs)
    setTimeout(onMid, dur * 0.5);
    const step = () => {
      const t = (performance.now() - t0) / dur;
      const W = c.width;
      const H = c.height;
      const cx = W / 2;
      const cy = H / 2;
      const intensity = Math.sin(Math.min(1, t) * Math.PI);
      ctx.fillStyle = `rgba(3,4,10,${0.25 + intensity * 0.5})`;
      ctx.fillRect(0, 0, W, H);
      const speed = 0.004 + intensity * 0.05;
      for (const s of stars) {
        s.z -= speed;
        if (s.z <= 0.01) {
          s.z = 1;
          s.a = Math.random() * Math.PI * 2;
        }
        const r0 = (0.05 / s.z) * Math.max(W, H);
        const r1 = (0.05 / (s.z + speed * 4)) * Math.max(W, H);
        ctx.strokeStyle = `hsla(${s.hue + t * 60},85%,78%,${Math.min(1, (1 - s.z) * 1.5) * intensity})`;
        ctx.lineWidth = 1.2 + (1 - s.z) * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
        ctx.lineTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
        ctx.stroke();
      }
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200 + intensity * 300);
      glow.addColorStop(0, `rgba(255,255,255,${intensity * 0.8})`);
      glow.addColorStop(0.3, `rgba(157,134,255,${intensity * 0.32})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      if (t < 1) requestAnimationFrame(step);
      else {
        ctx.clearRect(0, 0, W, H);
        c.classList.remove('show');
      }
    };
    step();
  }
}
