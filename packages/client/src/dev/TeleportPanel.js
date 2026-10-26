// Dev tool (F2, in dev builds only): teleport to any planet or moon in any system, hovering just
// above it in the ship or standing on the ground beside it. Pick a system, then a body, which is
// shown live in 3D (drag to turn it, scroll to zoom).
import { PlanetPreview } from './PlanetPreview.js';
import { fmtLy } from '../universe/Cosmos.js';

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export class TeleportPanel {
  constructor(game) {
    this.game = game;
    this.name = 'dev';
    const menus = game.menus;
    this.el = el('div', 'overlay dev-tp', menus.root);
    this.el.innerHTML = `
      <div class="tp glass">
        <header class="tp-head"><h2>Teleport</h2><span class="tp-tag mono">dev · F2</span><button class="close-x" data-close>✕</button></header>
        <div class="tp-body">
          <div class="tp-col">
            <input class="tp-filter" placeholder="Star systems" spellcheck="false" />
            <div class="tp-list tp-systems"></div>
          </div>
          <div class="tp-col"><div class="tp-sub mono"></div><div class="tp-list tp-bodies"></div></div>
          <section class="tp-view">
            <canvas class="tp-canvas"></canvas>
            <div class="tp-load"><b></b></div>
            <div class="tp-info"><h3></h3><div class="tp-kind"></div><div class="tp-hint mono">drag to turn · scroll to zoom</div></div>
            <div class="tp-actions">
              <button class="btn" data-go="above">Above, in ship</button>
              <button class="btn" data-go="ground">On the ground</button>
              <button class="btn" data-go="city">In a city</button>
            </div>
          </section>
        </div>
      </div>`;
    this.sysList = this.el.querySelector('.tp-systems');
    this.bodyList = this.el.querySelector('.tp-bodies');
    this.filter = this.el.querySelector('.tp-filter');
    this.canvas = this.el.querySelector('.tp-canvas');
    this.filter.addEventListener('input', () => this.renderSystems());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el || e.target.closest('[data-close]')) menus.closeAll();
      const go = e.target.closest('[data-go]');
      if (go && !go.disabled) this.go(go.dataset.go);
    });
    menus.extraOverlays = [...(menus.extraOverlays || []), this];
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F2') return;
      e.preventDefault();
      if (game.overlay === 'dev') menus.closeAll();
      else this.open();
    });
  }

  open() {
    const g = this.game;
    if (g.mode === 'title' || g.overlay || g.warping) return;
    this.preview ||= new PlanetPreview(this.canvas, g.pool);
    g.menus.open('dev', this.el);
    g.audio.play('ui');
    this.filter.value = '';
    this.renderSystems();
    this.selectSystem(g.galaxy.current, g.focusFrame?.sampler || g.focusFrame?.isGas ? g.focusFrame : g.system.homePlanet);
    this.last = performance.now();
    const loop = () => {
      if (g.overlay !== 'dev') return;
      const now = performance.now();
      this.preview.render(Math.min(0.05, (now - this.last) / 1000));
      this.updateLoad();
      this.last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // closed with the other menus
  onClose() {
    this.preview?.clear();
    this.dropCatalog();
  }

  renderSystems() {
    const g = this.game;
    const q = this.filter.value.trim().toLowerCase();
    const here = g.galaxy.here;
    const list = g.galaxy.systems
      .map((s) => ({ s, d: g.galaxy.distance(s, here) }))
      .filter(({ s }) => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.d - b.d);
    this.sysList.innerHTML = list
      .map(
        ({ s, d }) =>
          `<button class="tp-item ${s === this.sys ? 'on' : ''}" data-sys="${s.id}"><i style="background:${s.color}"></i><span>${s.name}</span><small class="mono">${s === g.galaxy.current && !g.universe.deep ? 'here' : fmtLy(d)}</small></button>`,
      )
      .join('');
    this.sysList.querySelectorAll('[data-sys]').forEach((b) => b.addEventListener('click', () => this.selectSystem(g.galaxy.systems[+b.dataset.sys])));
  }

  // the system's bodies: the live one if it is the one you are in, otherwise built just to look at
  // (and handed over to the game if you go there)
  selectSystem(sys, focus = null) {
    const g = this.game;
    this.sys = sys;
    let system;
    if (sys === g.system.info) {
      this.dropCatalog();
      system = g.system;
    } else {
      if (this.catalog?.sys !== sys) {
        this.dropCatalog();
        const it = g.buildSystem(sys);
        let r;
        while (!(r = it.next()).done);
        this.catalog = { sys, built: r.value };
      }
      system = this.catalog.built.system;
    }
    this.system = system;
    this.renderSystems();
    this.el.querySelector('.tp-sub').textContent = `${sys.name} · class ${sys.cls}`;
    this.bodyList.innerHTML = system.planets
      .map((p, i) => {
        const kind = (p.isGas ? 'Gas giant' : `${p.params.label}${p.kind === 'moon' ? ' moon' : ''}`) + (p.params.hazard ? ' ⚠' : '') + (p.params.cityCount ? ' ◆' : '');
        return `<button class="tp-item body ${p.kind}" data-i="${i}"><span>${p.name}</span><small class="mono">${kind} · ${Math.round(p.radius / 1000)} km</small></button>`;
      })
      .join('');
    this.bodyList.querySelectorAll('[data-i]').forEach((b) => {
      b.addEventListener('click', () => this.selectBody(+b.dataset.i));
      // double-click: straight there, in the ship
      b.addEventListener('dblclick', () => {
        this.selectBody(+b.dataset.i);
        this.go('above');
      });
    });
    const fi = focus ? system.planets.indexOf(focus) : -1;
    this.selectBody(fi >= 0 ? fi : system.planets.indexOf(system.homePlanet));
  }

  selectBody(i) {
    const p = this.system.planets[i];
    this.index = i;
    this.bodyList.querySelectorAll('[data-i]').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
    this.preview.show(p);
    const g = p.gravity / 9.8;
    this.el.querySelector('.tp-info h3').textContent = p.name;
    this.el.querySelector('.tp-kind').textContent = `${p.isGas ? 'Gas giant' : `${p.params.label} ${p.kind === 'moon' ? 'moon' : 'planet'}`} · ${Math.round(p.radius / 1000)} km · ${g.toFixed(2)} g${p.params.weather ? ` · ${p.params.weather}` : ''}${p.params.hazard ? ` · ⚠ ${p.params.hazard.label}` : ''}${p.params.cityCount ? ` · ${p.params.cityCount} ${p.params.cityCount > 1 ? 'cities' : 'city'}` : ''}`;
    this.el.querySelector('[data-go="city"]').style.display = p.cities?.length ? '' : 'none';
    const ground = this.el.querySelector('[data-go="ground"]');
    ground.disabled = !p.landable;
    ground.title = p.landable ? '' : 'No ground to stand on';
  }

  updateLoad() {
    const k = this.preview.progress;
    const bar = this.el.querySelector('.tp-load');
    bar.classList.toggle('done', k >= 1);
    bar.firstChild.style.width = `${(k * 100).toFixed(0)}%`;
  }

  go(where) {
    const g = this.game;
    const built = this.catalog?.sys === this.sys ? this.catalog.built : null;
    // (the system built for the list is the one the game moves into)
    if (built) this.catalog = null;
    const sys = this.sys;
    const index = this.index;
    g.menus.closeAll();
    g.teleport(sys, index, where, built);
  }

  dropCatalog() {
    if (this.catalog) this.game.disposeSystem(this.catalog.built.system, this.catalog.built.station);
    this.catalog = null;
  }
}
