// Title screen (its sign-in and character screens are Account.js), pause screen, settings and controls sheets, trade
// terminal, the inventory, the 3D navigation map and the warp sequence.
import { getHull, getItem, getResource } from '@astra/shared/data';
import { itemInfo, slotAt, stackCap, usedSlots } from '@astra/shared/inventory';
import { RESOURCES, resourceIcon } from '../gameplay/Inventory.js';
import { takeNotice } from '../net/session.js';
import { Account } from './Account.js';
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
  ['General', [['Inventory', ['I']], ['Navigation map', ['M']], ['Controls', ['H']], ['Release mouse', ['Esc']], ['Debug stats', ['`']]]],
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

// the shop's starship upgrades are the Pilot nodes they became (DESIGN 9.7)
const PILOT_NODES = { thrust: 'photon_thrusters', thermal: 'thermal_plating', pressure: 'pressure_hull', coating: 'hazard_coating' };

// what a starship upgrade does: the ship flies with its node
function applyUpgrade(game, id) {
  const node = PILOT_NODES[id];
  if (!node) return;
  game.ship.skills.add(node);
  game.ship.refreshStats();
}

// the trade panel always lists the demo's nine; the rest once some are carried
const DEMO_RESOURCES = new Set(Object.keys(RESOURCES).filter((id) => getResource(id).demo));

// the tag a non-resource item wears in its slot
const KIND_TAG = { consumable: 'CON', ammo: 'AMO', catalyst: 'CAT', module: 'MOD', cosmetic: 'COS', component: 'CMP' };

function slotRefOf(slot) {
  const i = Number(slot.dataset.i);
  return slot.dataset.c === 'suit' ? { c: 'suit', i } : { c: 'pod', p: Number(slot.dataset.p), i };
}

function refKey(ref) {
  return ref.c === 'suit' ? `s${ref.i}` : `p${ref.p}.${ref.i}`;
}

function cap1(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// what a refused move tells the player
function refusal(error) {
  switch (error.code) {
    case 'stack_full':
      return 'That stack is full';
    case 'item_mismatch':
      return 'Part of a stack goes onto an empty slot or the same item';
    case 'no_room':
      return cap1(error.message);
    default:
      return 'That move is not possible';
  }
}

// The stacks a move carried, slot to slot: a move or a merge (a swap carries both ways), a split, or a transfer (to the
// first slot it changed on the other side). Compacting carries nothing anywhere in particular.
function carried(before, after, op, r) {
  switch (op.op) {
    case 'move':
    case 'merge': {
      const a = slotAt(before, op.from);
      const b = slotAt(before, op.to);
      return a && b && a.item !== b.item
        ? [
            { from: op.from, to: op.to },
            { from: op.to, to: op.from },
          ]
        : [{ from: op.from, to: op.to }];
    }
    case 'split':
      return r.to ? [{ from: op.from, to: r.to }] : [];
    case 'transfer': {
      const there = op.from.c === 'suit' ? after.pods.flatMap((pod, p) => pod.map((_, i) => ({ c: 'pod', p, i }))) : after.suit.map((_, i) => ({ c: 'suit', i }));
      const to = there.find((ref) => slotAt(before, ref) !== slotAt(after, ref));
      return to ? [{ from: op.from, to }] : [];
    }
    default:
      return [];
  }
}

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
    this.buildInventory();
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
        if (e.code === 'KeyI' && this.game.overlay === 'inventory') {
          e.stopPropagation();
          this.closeAll();
        }
      },
      true,
    );
  }

  // ---------- title ----------
  // Play opens the sign-in and character screens in the menu's place (Account.js); the world is entered from there
  // (enterWorld), never from a local save.
  buildTitle() {
    this.title = el('div', 'overlay title-screen show', this.root);
    const items = [
      ['start', 'Play', 'primary', true],
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
    this.bindSheets(this.title);
    this.bindSettings(this.title);
    this.account = new Account(this);
    // a refusal or a sign-out that sent the player back here, said when the sign-in next opens
    this.notice = takeNotice();
    this.startBtn.addEventListener('click', () => {
      this.account.show(this.notice);
      this.notice = null;
    });
    // the menu by keyboard: the arrows walk its rows, Enter opens one
    this.title.querySelector('.t-menu').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      e.stopPropagation();
      const rows = [...this.title.querySelectorAll('.t-menu .t-item:not(:disabled)')];
      const i = rows.indexOf(document.activeElement);
      rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
    });
    // sound needs a gesture first: the first click or key on the title starts it (and its music)
    const wake = () => this.game.audio.start();
    this.title.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
    this.game.hud.setVisible(false);
  }

  // whether the home system is built and the models loaded: the world can be entered (Play is enabled)
  get ready() {
    return !this.startBtn.disabled;
  }

  hideTitle() {
    this.title.classList.remove('show');
    this.title.querySelectorAll('.sheet.open, .t-item.open').forEach((e) => e.classList.remove('open'));
  }

  // a line at the top of the screen for as long as the connection to the server is down (null takes it away)
  setConnection(text) {
    if (!this.connection) {
      this.connection = el('div', 'mono connection', this.root);
      this.connection.style.cssText =
        'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:30;padding:7px 16px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--warm);background:var(--plate);border:1px solid var(--line-2);pointer-events:none';
    }
    this.connection.textContent = text ?? '';
    this.connection.style.display = text ? '' : 'none';
  }

  // menu items that open a sheet beside the menu (settings, controls, credits); a second click closes it
  bindSheets(root) {
    root.querySelectorAll('.t-item').forEach((b) => b.addEventListener('mouseenter', () => !b.disabled && this.game.audio?.play('hover')));
    const sheets = root.querySelectorAll('[data-sheet]');
    const items = root.querySelectorAll('[data-act="settings"],[data-act="controls"],[data-act="credits"]');
    const sheetOf = (b) => b.dataset.act;
    // (the row whose sheet is open stays lit)
    const mark = () => items.forEach((b) => b.classList.toggle('open', !!root.querySelector(`.sheet.open[data-sheet="${sheetOf(b)}"]`)));
    const show = (name) => {
      if (name === 'credits') this.fillCredits(root);
      sheets.forEach((s) => s.classList.toggle('open', s.dataset.sheet === name && !s.classList.contains('open')));
      mark();
      this.game.audio?.play('ui');
    };
    items.forEach((b) => b.addEventListener('click', () => show(sheetOf(b))));
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
        this.title.querySelector('.t-load').classList.add('done');
        // keyboard-first: Enter plays
        if (!document.activeElement || document.activeElement === document.body) this.startBtn.focus({ preventScroll: true });
      }
    }
    if (g.overlay === 'map') this.updateMap(dt);
    if (g.overlay === 'trade') this.refreshTradeUnits();
    if (g.overlay === 'inventory' && g.inventory.key() !== this.invKey) this.renderInventory();
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
        <nav class="t-menu">${menuHTML([['resume', 'Resume', 'primary'], ['leave', 'Leave the world'], ['settings', 'Settings'], ['controls', 'Controls']])}</nav>
      </main>
      ${this.sheetsHTML()}`;
    this.pauseHint.querySelector('[data-act="resume"]').addEventListener('click', () => this.game.input.lock());
    this.pauseHint.addEventListener('click', (e) => {
      if (e.target === this.pauseHint) this.game.input.lock();
    });
    this.pauseHint.querySelector('[data-act="leave"]').addEventListener('click', () => this.game.leaveWorld());
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
    if (g.overlay === 'inventory') this.endDrag();
    for (const e of [this.trade, this.help, this.inv, this.map]) e.classList.remove('show');
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
      // the demo's nine always; the hostile worlds' and the Count's resources once there are some to sell
      if (!n && !DEMO_RESOURCES.has(id)) continue;
      rows += `<div class="res-row ${n ? '' : 'empty'}">${resourceIcon(id)}<span>${r.name}</span><span class="num">${n}</span><span class="price">${r.price}u</span>
        <button class="btn ghost small" data-sell="${id}" ${n ? '' : 'disabled'}>Sell</button></div>`;
    }
    let shop = '';
    for (const it of SHOP) {
      const owned = it.once && this.bought.has(it.id);
      shop += `<div class="shop-item ${owned ? 'owned' : ''}" title="${it.desc}"><div class="ico">${it.icon}</div><h4>${it.name}</h4>
        <div class="buy"><span>${owned ? 'Owned' : `⌬ ${it.price.toLocaleString()}`}</span><button class="btn small" data-buy="${it.id}" ${owned || inv.units < it.price || (it.id === 'warpcell' && !inv.room('warp_cell')) ? 'disabled' : ''}>${owned ? '✓' : 'Buy'}</button></div></div>`;
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
    if (id === 'warpcell' && !g.inventory.room('warp_cell')) {
      g.hud.toast('No room for a warp cell in the suit or the cargo pods', 'warn');
      return g.audio.play('error');
    }
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

  // ---------- inventory ----------
  // Suit stacks beside the ship's cargo pods (DESIGN 10.1). Click a stack to send it across, drag it onto a slot to place,
  // merge or swap it, shift-click to split it in half (shift-drag moves half). Every move is a request: the inventory
  // predicts it with the shared rules and the server has the last word (ARCHITECTURE §7).
  buildInventory() {
    this.inv = el('div', 'overlay panel-screen inv-screen', this.root);
    this.invKey = '';
    this.invChanged = new Set();
    this.inv.addEventListener('click', (e) => {
      if (e.target === this.inv || e.target.closest('[data-close]')) return this.closeAll();
      const c = e.target.closest('[data-compact]');
      if (c && !c.disabled) this.invRequest({ op: 'compact', c: c.dataset.compact });
      const shut = e.target.closest('.inv-pod.shut');
      if (shut) this.openPod(shut);
    });
    this.inv.addEventListener('pointerover', (e) => {
      const slot = e.target.closest('.inv-slot');
      if (slot && !this.drag?.ghost) this.showDetail(slot);
    });
    this.inv.addEventListener('pointerout', (e) => {
      if (e.target.closest('.inv-slot') && !e.relatedTarget?.closest?.('.inv-slot') && !this.drag?.ghost) this.showDetail(null);
    });
    this.inv.addEventListener('pointerdown', (e) => {
      const slot = e.target.closest('.inv-slot:not(.empty)');
      if (!slot || e.button !== 0) return;
      e.preventDefault();
      this.drag = { from: slotRefOf(slot), el: slot, x: e.clientX, y: e.clientY, shift: e.shiftKey, ghost: null, over: null };
    });
    window.addEventListener('pointermove', (e) => this.dragMove(e));
    window.addEventListener('pointerup', (e) => this.dragEnd(e));
  }

  openInventory() {
    const g = this.game;
    if (g.overlay || (g.mode !== 'ship' && g.mode !== 'foot')) return;
    this.invMsg = null;
    this.invChanged.clear();
    this.podScroll = 0;
    this.invEnter = true;
    this.podsOpen = new Set();
    this.podsListed = new Set();
    // shown first, so the pod list can measure itself
    this.open('inventory', this.inv);
    this.renderInventory();
    g.audio.play('ui');
  }

  toggleInventory() {
    if (this.game.overlay === 'inventory') this.closeAll();
    else this.openInventory();
  }

  renderInventory() {
    const inv = this.game.inventory;
    const st = inv.state;
    this.invKey = inv.key();
    // the panel rises in when it opens, not again on every redraw after a move
    const enter = this.invEnter;
    this.invEnter = false;
    const hull = inv.hull ? getHull(inv.hull).name : null;
    const grid = (refs) => `<div class="inv-grid">${refs.map((r) => this.slotHTML(st, r)).join('')}</div>`;
    const cargoCap = st.pods.reduce((n, pod) => n + pod.length, 0);
    const stackBtn = (c, on) => `<button class="inv-act" data-compact="${c}" ${on ? '' : 'disabled'} title="Merge partial stacks and close the gaps">Stack</button>`;
    this.inv.innerHTML = `<div class="panel frame inv-panel${enter ? '' : ' still'}">
      <div class="panel-head">
        <div><div class="label">Exo-suit${hull ? ` · ${hull}` : ''}</div><h2>Inventory</h2></div>
        <div class="balance"><b class="u">${st.units.toLocaleString()}</b><button class="close-x" data-close>✕</button></div>
      </div>
      <div class="inv-cols">
        <section class="inv-side">
          <header class="inv-side-head"><h4 class="mono col-title">Suit</h4><span class="mono">${usedSlots(st, 'suit')} / ${st.suit.length} stacks</span>${stackBtn('suit', true)}</header>
          ${grid(st.suit.map((_, i) => ({ c: 'suit', i })))}
          <p class="inv-note"><i></i>Kept through the Recall</p>
        </section>
        <section class="inv-side">
          <header class="inv-side-head"><h4 class="mono col-title">Ship cargo</h4><span class="mono">${cargoCap ? `${st.pods.length} pod${st.pods.length === 1 ? '' : 's'} · ${usedSlots(st, 'cargo')} / ${cargoCap} stacks` : 'No pods'}</span>${stackBtn('cargo', cargoCap > 0)}</header>
          <div class="inv-pods">${this.podsHTML(st)}</div>
          <div class="inv-more mono"></div>
          <p class="inv-note drop"><i></i>Drops where the ship dies, for anyone to loot</p>
        </section>
      </div>
      <footer class="inv-foot">
        <div class="inv-detail"></div>
        <div class="inv-keys"><span><kbd>Click</kbd>Move across</span><span><kbd>Drag</kbd>Place · merge · swap</span><span><kbd>Shift</kbd><kbd>Click</kbd>Split</span></div>
      </footer>
    </div>`;
    // a long pod list scrolls: keep the place across redraws, and say how many pods lie below the fold
    const podsEl = this.inv.querySelector('.inv-pods');
    const moreEl = this.inv.querySelector('.inv-more');
    podsEl.scrollTop = this.podScroll || 0;
    // (while the list scrolls the line stays, pointing down, or up once at the end, so the list never changes height)
    const more = () => {
      this.podScroll = podsEl.scrollTop;
      const box = podsEl.getBoundingClientRect();
      const scrolls = podsEl.scrollHeight > podsEl.clientHeight + 1;
      const pods = (c) => (c.dataset.from ? Number(c.dataset.to) - Number(c.dataset.from) + 1 : 1);
      let below = 0;
      let above = 0;
      if (scrolls)
        for (const c of podsEl.children) {
          const r = c.getBoundingClientRect();
          if (r.bottom > box.bottom + 1) below += pods(c);
          else if (r.top < box.top - 1) above += pods(c);
        }
      const s = (n) => (n === 1 ? '' : 's');
      moreEl.textContent = below ? `↓ ${below} more pod${s(below)} below` : above ? `↑ ${above} pod${s(above)} above` : '';
      moreEl.classList.toggle('on', scrolls);
    };
    podsEl.addEventListener('scroll', more, { passive: true });
    more();
    this.podsMore = more;
    this.invDetail = this.inv.querySelector('.inv-detail');
    this.invChanged.clear();
    if (this.invMsg) this.paintMessage();
    else this.showDetail(this.drag ? null : this.inv.querySelector('.inv-slot:hover'));
  }

  // A pod holding something shows its slots. An empty one is one header line until it is clicked or a stack is dragged
  // over it, and a run of three or more empty pods (a big hauler's) is a single line that lists them the same way, so
  // sixteen pods fit the column. A pod opened stays open while the panel is, so emptying it never pulls the slots away.
  podsHTML(st) {
    if (!st.pods.length) return `<div class="inv-none"><b>No ship</b><span>Cargo pods come with a hull. Any Waystation sells one.</span></div>`;
    const open = (this.podsOpen ||= new Set());
    const listed = (this.podsListed ||= new Set());
    const empty = (p) => !st.pods[p].some(Boolean) && !open.has(p);
    let html = '';
    for (let p = 0; p < st.pods.length; ) {
      if (!empty(p)) {
        open.add(p);
        html += this.podHTML(st, p++);
        continue;
      }
      let q = p;
      while (q < st.pods.length && empty(q)) q++;
      if (q - p >= 3 && !listed.has(p)) {
        html += `<div class="inv-pod shut group" data-from="${p}" data-to="${q - 1}" title="List the empty pods"><div class="inv-pod-head mono"><span>Pods ${p + 1}–${q}</span><span>Empty · ${q - p} × ${st.pods[p].length} stacks</span></div></div>`;
        p = q;
      } else for (; p < q; p++) html += this.shutPodHTML(p, st.pods[p].length);
    }
    return html;
  }

  podHTML(st, p) {
    const pod = st.pods[p];
    const slots = pod.map((_, i) => this.slotHTML(st, { c: 'pod', p, i })).join('');
    return `<div class="inv-pod" data-pod="${p}"><div class="inv-pod-head mono"><span>Pod ${p + 1}</span><span>${pod.filter(Boolean).length} / ${pod.length}</span></div><div class="inv-grid">${slots}</div></div>`;
  }

  shutPodHTML(p, stacks) {
    return `<div class="inv-pod shut" data-pod="${p}" title="Open the pod"><div class="inv-pod-head mono"><span>Pod ${p + 1}</span><span>Empty · 0 / ${stacks}</span></div></div>`;
  }

  // an empty pod opens in place, and a run of them lists its pods (a click, or a stack dragged over), without redrawing
  openPod(el) {
    const st = this.game.inventory.state;
    if (el.dataset.from) {
      const from = Number(el.dataset.from);
      const to = Number(el.dataset.to);
      let html = '';
      for (let p = from; p <= to; p++) {
        this.podsListed.add(p);
        html += this.shutPodHTML(p, st.pods[p].length);
      }
      el.outerHTML = html;
    } else {
      const p = Number(el.dataset.pod);
      this.podsOpen.add(p);
      el.outerHTML = this.podHTML(st, p);
    }
    this.podsMore?.();
  }

  slotHTML(st, ref) {
    const s = slotAt(st, ref);
    const data = ref.c === 'suit' ? `data-c="suit" data-i="${ref.i}"` : `data-c="pod" data-p="${ref.p}" data-i="${ref.i}"`;
    const bump = this.invChanged.has(refKey(ref)) ? ' bump' : '';
    if (!s) return `<div class="inv-slot empty${bump}" ${data}></div>`;
    const info = itemInfo(s.item);
    const cap = stackCap(s.item, st.stackMax);
    const mark = info?.kind === 'resource' ? resourceIcon(s.item) : `<i class="inv-tag">${KIND_TAG[info?.kind] || 'ITM'}</i>`;
    const count = cap === 1 ? '' : `<b class="inv-ct">${s.count.toLocaleString()}</b>`;
    // (a module, cosmetic or component is one thing per slot: no count, no fill)
    const fill = cap === 1 ? '' : `<span class="inv-fill" style="--f:${(s.count / cap).toFixed(4)}"></span>`;
    return `<div class="inv-slot${s.count >= cap && cap > 1 ? ' full' : ''}${bump}" ${data}>${mark}${count}<span class="inv-nm">${info?.name || s.item}</span>${fill}</div>`;
  }

  slotEl(ref) {
    return this.inv.querySelector(ref.c === 'suit' ? `.inv-slot[data-c="suit"][data-i="${ref.i}"]` : `.inv-slot[data-c="pod"][data-p="${ref.p}"][data-i="${ref.i}"]`);
  }

  // the line under the grids: what the hovered stack is, else how much a stack holds
  showDetail(slot) {
    if (!this.invDetail || this.invMsg) return;
    const st = this.game.inventory.state;
    const s = slot && slotAt(st, slotRefOf(slot));
    if (!s) {
      this.invDetail.className = 'inv-detail idle';
      this.invDetail.textContent = `A stack holds up to ${st.stackMax.toLocaleString()}. Modules, cosmetics and components take a slot each.`;
      return;
    }
    const info = itemInfo(s.item);
    const cap = stackCap(s.item, st.stackMax);
    let about = '';
    if (info?.kind === 'resource') {
      const r = getResource(s.item);
      about = `${cap1(r.sources.map((x) => x.detail).join(', '))} · for ${r.uses.join(', ')}`;
    } else if (info) about = getItem(s.item).text;
    this.invDetail.className = 'inv-detail';
    const amount = cap === 1 ? '' : `<span class="num">${s.count.toLocaleString()} / ${cap.toLocaleString()}</span>`;
    this.invDetail.innerHTML = `<div class="l1"><b>${info?.name || s.item}</b><span class="kind">${info?.kind || ''}</span>${amount}</div><div class="about">${about}</div>`;
  }

  // a refusal in the detail line, for a moment
  showMessage(text) {
    clearTimeout(this.invMsgT);
    this.invMsg = text;
    this.paintMessage();
    this.invMsgT = setTimeout(() => {
      this.invMsg = null;
      this.showDetail(null);
    }, 2600);
  }

  paintMessage() {
    if (!this.invDetail) return;
    this.invDetail.className = 'inv-detail msg';
    this.invDetail.textContent = this.invMsg;
  }

  // `from`: where a dropped stack was let go, so it settles from there rather than from its old slot
  invRequest(op, from = null) {
    const g = this.game;
    const before = g.inventory.state;
    const r = g.inventory.request(op);
    if (!r.ok) {
      g.audio.play('error');
      this.showMessage(refusal(r.error));
      return;
    }
    g.audio.play('ui');
    clearTimeout(this.invMsgT);
    this.invMsg = null;
    const after = g.inventory.state;
    // what each carried stack looked like, taken before the redraw
    const flights = matchMedia('(prefers-reduced-motion: reduce)').matches ? [] : carried(before, after, op, r);
    flights.forEach((f, k) => {
      const src = this.slotEl(f.from);
      f.rect = (k === 0 && from) || src?.getBoundingClientRect();
      f.tile = src?.cloneNode(true);
    });
    // the slots the move touched settle back once; a destination does so when its stack lands
    const refs = [...before.suit.map((_, i) => ({ c: 'suit', i })), ...before.pods.flatMap((pod, p) => pod.map((_, i) => ({ c: 'pod', p, i })))];
    for (const ref of refs) if (slotAt(before, ref) !== slotAt(after, ref)) this.invChanged.add(refKey(ref));
    for (const f of flights) this.invChanged.delete(refKey(f.to));
    this.renderInventory();
    for (const f of flights) this.fly(f, before, after);
  }

  // A carried stack as a tile flying from its old slot to its new one (an ease-out), the destination keeping what it held
  // until the tile lands; on a merge the count then ticks up to the new total. Both run on the document's animation clock.
  fly(f, before, after) {
    const dest = this.slotEl(f.to);
    if (!f.tile || !f.rect || !dest) return;
    const to = dest.getBoundingClientRect();
    const s = slotAt(after, f.to);
    const was = slotAt(before, f.to);
    const merging = was && s && was.item === s.item;
    const tile = f.tile;
    tile.className = 'inv-slot inv-fly';
    const ct = tile.querySelector('.inv-ct');
    if (ct && s) ct.textContent = (merging ? s.count - was.count : s.count).toLocaleString();
    Object.assign(tile.style, { left: `${f.rect.left}px`, top: `${f.rect.top}px`, width: `${to.width}px`, height: `${to.height}px` });
    this.root.appendChild(tile);
    dest.classList.add(merging ? 'waiting' : 'landing');
    const destCt = dest.querySelector('.inv-ct');
    if (merging && destCt) destCt.textContent = was.count.toLocaleString();
    const flight = tile.animate([{ transform: 'none' }, { transform: `translate(${to.left - f.rect.left}px, ${to.top - f.rect.top}px)` }], {
      duration: 180,
      easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      fill: 'forwards',
    });
    flight.onfinish = () => {
      tile.remove();
      dest.classList.remove('landing', 'waiting', 'bump');
      void dest.offsetWidth; // restart the settle
      dest.classList.add('bump');
      if (!merging || !destCt) return;
      const tick = dest.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 260 });
      const step = () => {
        const p = tick.effect.getComputedTiming().progress;
        if (p === null || !dest.isConnected) return void (destCt.textContent = s.count.toLocaleString());
        destCt.textContent = Math.round(was.count + (s.count - was.count) * (1 - (1 - p) ** 3)).toLocaleString();
        requestAnimationFrame(step);
      };
      tick.onfinish = () => (destCt.textContent = s.count.toLocaleString());
      requestAnimationFrame(step);
    };
  }

  dragMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.ghost = d.el.cloneNode(true);
      d.ghost.classList.add('inv-ghost');
      d.ghost.classList.remove('bump');
      d.ghost.style.width = `${d.el.offsetWidth}px`;
      d.ghost.style.height = `${d.el.offsetHeight}px`;
      this.root.appendChild(d.ghost);
      d.el.classList.add('lifted');
      this.inv.classList.add('dragging');
      this.showDetail(d.el);
    }
    d.ghost.style.transform = `translate(${e.clientX - d.ghost.offsetWidth / 2}px, ${e.clientY - d.ghost.offsetHeight / 2}px)`;
    // dragged over an empty pod's line (or a run of them): it opens to take the stack
    const shut = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.inv-pod.shut');
    if (shut && this.inv.contains(shut)) this.openPod(shut);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.inv-slot');
    const target = over && over !== d.el && this.inv.contains(over) ? over : null;
    if (target !== d.over) {
      d.over?.classList.remove('drop');
      d.over = target;
      d.over?.classList.add('drop');
    }
  }

  dragEnd(e) {
    const d = this.drag;
    if (!d) return;
    const dropped = d.ghost?.getBoundingClientRect() ?? null;
    this.endDrag();
    if (this.game.overlay !== 'inventory') return;
    const s = slotAt(this.game.inventory.state, d.from);
    if (!s) return;
    if (d.ghost) {
      if (d.over) this.invRequest({ op: 'move', from: d.from, to: slotRefOf(d.over), ...(d.shift && s.count > 1 ? { count: Math.ceil(s.count / 2) } : {}) }, dropped);
      return;
    }
    if (!e.target.closest?.('.inv-slot')) return;
    // a click: shift splits the stack in half, otherwise it goes across to the other side
    if (d.shift) {
      if (s.count < 2) return this.showMessage('A single item does not split');
      this.invRequest({ op: 'split', from: d.from, count: Math.floor(s.count / 2) });
    } else this.invRequest({ op: 'transfer', from: d.from });
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost?.remove();
    d.el.classList.remove('lifted');
    d.over?.classList.remove('drop');
    this.inv.classList.remove('dragging');
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
