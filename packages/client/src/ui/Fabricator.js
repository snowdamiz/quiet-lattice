// The fabricator screen (DESIGN 15.7, P1.E13.T05; ARCHITECTURE §23): the recipes the character knows, what each needs
// against what the suit and the cargo hold, and Craft ×n. Two fabricators open it: a Waystation's (its terminal on the
// trade deck, or docked there: every recipe of its line up to Tier 2) and the ship's own (aboard, anywhere, or on foot
// beside it: ammo and cartridges only). Recipe items the character holds for recipes it does not know yet are listed to
// learn. Crafts are the server's (net/crafting.js asks; the shared rules predict a refusal the server would give for the
// recipe, the fabricator or the materials, so it is said at once): the screen shows the fabrication running on the Craft
// button and, once both it and the answer are in, what was made or why not.
//
// It is the inventory's sibling: the same plate, head, column titles, item tags, resource icons and detail line, and like
// the dev teleporter an overlay of its own that Menus.closeAll (Esc) closes.
import { craftableCount, inTableOrder, makesAt, materialsOf, outputOf, recipeById, CRAFT_MAX, STATION_MAX_TIER } from '@astra/shared/crafting';
import { getHull, getItem, recipeOfItem } from '@astra/shared/data';
import { countOf, itemInfo, totals } from '@astra/shared/inventory';
import { tierOf } from '@astra/shared/world';
import { resourceIcon } from '../gameplay/Inventory.js';
import { CRAFT_PENDING_MS } from '../net/crafting.js';

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

// the tag an item wears where it has no icon (the inventory's, and recipes')
const KIND_TAG = { consumable: 'CON', ammo: 'AMO', catalyst: 'CAT', module: 'MOD', cosmetic: 'COS', component: 'CMP', recipe: 'RCP' };
// a craft's fabrication, as it runs across the Craft button (an ease-in-out, on the document's animation clock)
const FABRICATE_MS = 560;
// a recipe just learned, moving from the recipes to learn into the list
const ARRIVE_MS = 380;
// what a learned row stood for (its tag, its LEARN button) fading into what it is now, and the line under the columns
// into its next message: the old out over the first half, the new in over the second
const SWAP_MS = 120;
const LINE_MS = 140;
// the "Recipes to learn" heading, gone within the first frames of the row's rise
const HEAD_MS = 70;

function nameOf(id) {
  return itemInfo(id)?.name ?? id;
}

function markOf(id) {
  const info = itemInfo(id);
  return info?.kind === 'resource' ? resourceIcon(id) : `<i class="inv-tag">${KIND_TAG[info?.kind] || 'ITM'}</i>`;
}

// "1 Warp cell", "150 Flak ammo"
function amount(n, id) {
  return `${n.toLocaleString()} ${nameOf(id)}`;
}

export class FabricatorPanel {
  constructor(game) {
    this.game = game;
    this.name = 'fabricator';
    const menus = game.menus;
    this.el = el('div', 'overlay panel-screen fab-screen', menus.root);
    /** 'station' (a Waystation's) or 'ship' (the ship's own) */
    this.at = 'station';
    this.selected = null;
    this.qty = 1;
    /** the line under the columns: { text, tone: 'good' | 'refused' } or null for the hint */
    this.msg = null;
    /** a craft or a lesson under way: { answer, done, at, before, dimmed } (`dimmed`: a fabrication dimmed the controls) */
    this.busy = null;
    this.key = '';
    menus.extraOverlays = [...(menus.extraOverlays || []), this];
    this.el.addEventListener('click', (e) => this.click(e));
    window.addEventListener('keydown', (e) => this.keydown(e), true);
    game.crafting.on((m) => this.answered(m));
  }

  get isOpen() {
    return this.game.overlay === this.name;
  }

  /** Opens fabricator `at`: 'station' (the Waystation's) or 'ship' (the ship's own). */
  open(at) {
    const g = this.game;
    if (g.overlay || (g.mode !== 'ship' && g.mode !== 'foot')) return;
    this.at = at;
    this.msg = null;
    this.qty = 1;
    this.busy = null;
    this.enter = true;
    const rows = this.rows();
    this.selected = (rows.here.find((r) => craftableCount(g.inventory.state, r) > 0) ?? rows.here[0] ?? rows.elsewhere[0])?.id ?? null;
    g.menus.open(this.name, this.el);
    this.render();
    g.audio.play('ui');
  }

  toggle(at) {
    if (this.isOpen) this.game.menus.closeAll();
    else this.open(at);
  }

  // (Menus.closeAll)
  onClose() {
    this.busy = null;
    this.msg = null;
  }

  /** Each frame: redraws when the inventory or the known recipes changed (never mid-fabrication), and gives up on an
   * answer that never came. */
  update() {
    if (!this.isOpen) return;
    const b = this.busy;
    if (b) {
      if (b.done && !b.answer && performance.now() - b.at > CRAFT_PENDING_MS) {
        this.busy = null;
        this.msg = { text: 'The fabricator did not answer. Try again.', tone: 'refused' };
        this.render({ woke: b.dimmed });
      }
      return;
    }
    if (this.stateKey() !== this.key) this.render();
  }

  stateKey() {
    return `${this.game.inventory.key()}|${this.game.crafting.rev}`;
  }

  /** The system's tier: the server's map once in the world, else the one the client built the system at. */
  tier() {
    const g = this.game;
    return g.net?.world?.tiers?.[g.galaxy.current.id] ?? tierOf(g.galaxy.current);
  }

  /** The known recipes this fabricator makes (`here`) and the rest (`elsewhere`), in the table's order, and the recipe
   * items held for recipes not known yet (`learnable`). */
  rows() {
    const g = this.game;
    const tier = this.tier();
    const known = inTableOrder(g.crafting.known);
    const learnable = inTableOrder(
      Object.keys(totals(g.inventory.state))
        .map(recipeOfItem)
        .filter((id) => id && !g.crafting.knows(id)),
    );
    return { here: known.filter((r) => makesAt(r, this.at, tier)), elsewhere: known.filter((r) => !makesAt(r, this.at, tier)), learnable };
  }

  /**
   * Draws the screen. `woke`: a fabrication or a lesson just ended, so the controls it dimmed come back and the Craft
   * button lets go of its fill, eased (drawn as they were, then let go); `bump`: the rows a craft changed (a selector)
   * flash once; `warn`: the materials short of a refused craft flash red; `learned`: a recipe just learned ({recipe,
   * from, label}), whose row moves from the recipes to learn into the list. A flash under way carries on across a redraw
   * from where it was, never restarted.
   */
  render(opts = {}) {
    const g = this.game;
    const st = g.inventory.state;
    const carry = [];
    for (const a of this.el.getAnimations?.({ subtree: true }) ?? []) {
      const row = a.animationName === 'fabFade' ? a.effect?.target : null;
      if (row?.dataset?.key) carry.push({ key: row.dataset.key, cls: row.classList.contains('fab-warn') ? 'fab-warn' : 'bump', time: a.currentTime });
    }
    // what the line under the columns said, where it stood (to fade out under the next message)
    const old = this.el.querySelector('.fab-msg');
    const line = old && old.offsetParent ? { cls: old.className, html: old.innerHTML, text: old.textContent, rect: old.getBoundingClientRect() } : null;
    this.key = this.stateKey();
    const enter = this.enter;
    this.enter = false;
    const { here, elsewhere, learnable } = this.rows();
    const ship = this.at === 'ship';
    const label = ship ? 'Ship fabricator · ammo and cartridges' : `Waystation fabricator · Tier 0–${STATION_MAX_TIER} recipes`;
    const title = ship ? (g.inventory.hull ? getHull(g.inventory.hull).name : 'Your ship') : g.station.name;
    const row = (r, off) => {
      const n = craftableCount(st, r);
      const status = off ? (ship ? 'Station only' : 'Not made here') : n > 0 ? `Can make ${n === CRAFT_MAX ? `${n}+` : n}` : 'Missing materials';
      const tone = off ? 'off' : n > 0 ? 'ok' : 'short';
      const out = outputOf(r);
      return `<button class="fab-row${off ? ' off' : ''}${r.id === this.selected ? ' sel' : ''}" data-recipe="${r.id}" data-key="r-${r.id}">${markOf(out.item)}<span class="fab-nm">${r.name}</span><span class="fab-st ${tone}">${status}</span></button>`;
    };
    const learn = (r) =>
      `<div class="fab-row learn" data-key="l-${r.id}">${markOf(`recipe_${r.id}`)}<span class="fab-nm">${r.name}</span><button class="inv-act" data-learn="${r.id}">Learn</button></div>`;
    this.el.innerHTML = `<div class="panel frame inv-panel fab-panel${enter ? '' : ' still'}">
      <div class="panel-head">
        <div><div class="label">${label}</div><h2>${title}</h2></div>
        <div class="balance"><button class="close-x" data-close>✕</button></div>
      </div>
      <div class="fab-cols">
        <section class="inv-side fab-side">
          <header class="inv-side-head"><h4 class="mono col-title">Recipes</h4><span class="mono">${here.length} here · ${g.crafting.known.length} known</span></header>
          <div class="fab-list">
            ${here.map((r) => row(r, false)).join('') || '<div class="inv-none"><b>Nothing to make here</b><span>This fabricator makes none of the recipes you know.</span></div>'}
            ${elsewhere.length ? `<div class="fab-group mono" data-group="elsewhere">${ship ? 'Made at a Waystation' : 'Made elsewhere'}</div>${elsewhere.map((r) => row(r, true)).join('')}` : ''}
            ${learnable.length ? `<div class="fab-group mono" data-group="learn">Recipes to learn</div>${learnable.map(learn).join('')}` : ''}
          </div>
          <p class="inv-note"><i></i>A recipe is learned once and kept for good</p>
        </section>
        <section class="inv-side fab-side">${this.detailHTML(st)}</section>
      </div>
      <footer class="inv-foot">
        <div class="inv-detail fab-msg"></div>
        <div class="inv-keys"><span><kbd>↑</kbd><kbd>↓</kbd>Select</span><span><kbd>Enter</kbd>Craft</span><span><kbd>${ship ? 'K' : 'Esc'}</kbd>Close</span></div>
      </footer>
    </div>`;
    const panel = this.el.firstElementChild;
    for (const c of carry) {
      const row = panel.querySelector(`[data-key="${c.key}"]`);
      if (!row) continue;
      row.classList.add(c.cls);
      for (const a of row.getAnimations({ subtree: true })) if (a.animationName === 'fabFade') a.currentTime = c.time;
    }
    if (opts.bump) for (const row of panel.querySelectorAll(opts.bump)) row.classList.add('bump');
    if (opts.warn) for (const row of panel.querySelectorAll('.fab-mat.short')) row.classList.add('fab-warn');
    if (opts.woke) {
      // drawn as the fabrication left them (dimmed, the button filled), then let go: their transitions ease them back;
      // a label that goes from dark on the fill to warm white on the outline fades out and back in rather than tweening
      // its colour across the fading fill
      const go = panel.querySelector('.fab-go');
      panel.classList.add('fab-busy');
      go?.classList.add('working');
      void panel.offsetWidth;
      panel.classList.remove('fab-busy');
      go?.classList.remove('working');
      if (go?.classList.contains('short')) go.querySelector('.fab-go-l')?.classList.add('fab-relabel');
    }
    if (opts.learned) this.arrive(panel, opts.learned);
    this.paintMessage();
    if (line && !enter) this.crossLine(panel, line);
  }

  // The line under the columns, changed: the old message fades out where it stood, then the new one fades in.
  crossLine(panel, was) {
    const now = panel.querySelector('.fab-msg');
    if (!now || was.text === now.textContent || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const foot = panel.querySelector('.inv-foot');
    const at = foot.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = was.cls;
    ghost.innerHTML = was.html;
    Object.assign(ghost.style, {
      position: 'absolute',
      left: `${was.rect.left - at.left}px`,
      top: `${was.rect.top - at.top}px`,
      width: `${was.rect.width}px`,
      height: `${was.rect.height}px`,
      pointerEvents: 'none',
    });
    foot.appendChild(ghost);
    // (one after the other, so the two lines never show through each other)
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LINE_MS / 2, easing: 'ease-out', fill: 'forwards' }).onfinish = () => ghost.remove();
    now.animate([{ opacity: 0 }, { opacity: 1 }], { duration: LINE_MS / 2, delay: LINE_MS / 2, easing: 'ease-out', fill: 'backwards' });
  }

  // A recipe just learned: its row eases from where it stood among the recipes to learn into its place in the list on an
  // opaque plate, flashing once, while what it stood for there (its RCP tag, its LEARN button) fades into what it is
  // now (its item's tag, how many the materials make). The "Recipes to learn" heading, if that was the last, stays where
  // it stood under the rising plate and is gone within the rise's first frames.
  arrive(panel, { recipe, from, label, parts }) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const list = panel.querySelector('.fab-list');
    const row = panel.querySelector(`[data-key="r-${recipe}"]`);
    if (row && from) {
      const to = row.getBoundingClientRect();
      row.classList.add('fab-moving', 'bump');
      row.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], {
        duration: ARRIVE_MS,
        easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      }).onfinish = () => row.classList.remove('fab-moving');
      // (what the row is now, taken before what it was is laid over it)
      const fresh = [...row.querySelectorAll(':scope > .inv-tag, :scope > .res-ico, :scope > .fab-st')];
      for (const p of parts ?? []) {
        Object.assign(p.node.style, { position: 'absolute', left: `${p.dx}px`, top: `${p.dy}px`, margin: '0', pointerEvents: 'none' });
        row.appendChild(p.node);
        p.node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP_MS / 2, easing: 'ease-out', fill: 'forwards' }).onfinish = () => p.node.remove();
      }
      for (const now of fresh) now.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SWAP_MS / 2, delay: SWAP_MS / 2, easing: 'ease-out', fill: 'backwards' });
    }
    if (label && list && !panel.querySelector('[data-group="learn"]')) {
      const at = list.getBoundingClientRect();
      const ghost = label.node;
      Object.assign(ghost.style, {
        position: 'absolute',
        left: `${label.rect.left - at.left}px`,
        top: `${label.rect.top - at.top + list.scrollTop}px`,
        width: `${label.rect.width}px`,
        margin: '0',
        pointerEvents: 'none',
      });
      list.prepend(ghost);
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HEAD_MS, easing: 'ease-out', fill: 'forwards' }).onfinish = () => ghost.remove();
    }
  }

  /** The most crafts the stepper goes to for a recipe: as many as the materials held make (one at least), at most
   * CRAFT_MAX. + and MAX dim there as − dims at one. */
  maxQty(recipe, st = this.game.inventory.state) {
    return Math.min(CRAFT_MAX, Math.max(1, craftableCount(st, recipe)));
  }

  // the selected recipe: what it makes, what it needs against what is held, how many, and Craft
  detailHTML(st) {
    const r = this.selected && recipeById(this.selected);
    if (!r) return '<div class="inv-none"><b>No recipe</b><span>Use a recipe item to learn one, then craft it at a fabricator that makes it.</span></div>';
    const out = outputOf(r);
    const item = getItem(out.item);
    const here = makesAt(r, this.at, this.tier());
    const can = craftableCount(st, r);
    const top = this.maxQty(r, st);
    this.qty = Math.min(Math.max(1, this.qty), CRAFT_MAX);
    const mats = materialsOf(r, this.qty)
      .map((m) => {
        const have = countOf(st, m.item);
        return `<div class="fab-mat${have < m.count ? ' short' : ''}" data-item="${m.item}" data-key="m-${m.item}">${markOf(m.item)}<span class="fab-mat-nm">${nameOf(m.item)}</span><b class="num">${m.count.toLocaleString()}</b><span class="have">${have.toLocaleString()} held</span></div>`;
      })
      .join('');
    const short = materialsOf(r, this.qty).some((m) => countOf(st, m.item) < m.count);
    const make = here
      ? `<div class="fab-make">
          <div class="fab-qty"><button data-q="-1" ${this.qty <= 1 ? 'disabled' : ''} title="One fewer">−</button><b>${this.qty}</b><button data-q="1" ${this.qty >= top ? 'disabled' : ''} title="One more">+</button><button class="fab-max" data-q="max" ${this.qty >= top ? 'disabled' : ''} title="As many as the materials make">Max</button></div>
          <button class="btn fab-go${short ? ' short' : ''}" data-make ${this.busy ? 'disabled' : ''}><span class="fab-sweep"></span><span class="fab-go-l">Craft ×${this.qty}</span></button>
        </div>`
      : `<div class="fab-make"><div class="fab-elsewhere mono">${this.at === 'ship' ? "The ship's fabricator makes ammo and cartridges only. Craft this at a Waystation." : 'This fabricator does not make this recipe.'}</div></div>`;
    return `<header class="inv-side-head"><h4 class="mono col-title">${r.name}</h4><span class="mono">${item.kind} · ${out.count} a craft</span></header>
      <p class="fab-about">${item.text}</p>
      <div class="fab-mats-head mono"><span>Materials</span><span>Need</span><span>Held</span></div>
      <div class="fab-mats">${mats}</div>
      <div class="fab-out" data-item="${out.item}" data-key="o-${out.item}"><span>Makes</span>${markOf(out.item)}<b>${amount(out.count * this.qty, out.item)}</b><span class="have">${countOf(st, out.item).toLocaleString()} held · ${can ? `up to ${can === CRAFT_MAX ? `${can}+` : can} now` : 'none now'}</span></div>
      ${make}
      <p class="inv-note drop"><i></i>Materials come from the suit first, then the cargo pods</p>`;
  }

  // the line under the columns: what happened, or what the screen does
  paintMessage() {
    const line = this.el.querySelector('.fab-msg');
    if (!line) return;
    if (!this.msg) {
      line.className = 'inv-detail fab-msg idle';
      line.textContent = this.at === 'ship' ? 'Ammo and cartridges in the field. Warp cells and the rest at a Waystation.' : 'Pick a recipe, set how many, and craft.';
      return;
    }
    line.className = `inv-detail fab-msg msg ${this.msg.tone}`;
    line.innerHTML = '<i></i>';
    line.append(this.msg.text);
  }

  click(e) {
    const g = this.game;
    if (e.target === this.el || e.target.closest('[data-close]')) return g.menus.closeAll();
    const pick = e.target.closest('[data-recipe]');
    if (pick) return this.select(pick.dataset.recipe);
    const q = e.target.closest('[data-q]');
    if (q && !q.disabled && !this.busy) {
      const r = recipeById(this.selected);
      const top = r ? this.maxQty(r) : 1;
      this.qty = Math.max(1, Math.min(top, q.dataset.q === 'max' ? top : this.qty + Number(q.dataset.q)));
      g.audio.play('ui');
      return this.render();
    }
    if (e.target.closest('[data-make]')) return this.make();
    const learn = e.target.closest('[data-learn]');
    if (learn && !learn.disabled) this.learn(learn.dataset.learn);
  }

  keydown(e) {
    if (!this.isOpen) return;
    if (e.code === 'KeyK') {
      e.stopPropagation();
      this.game.menus.closeAll();
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      this.make();
    } else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      const { here, elsewhere } = this.rows();
      const ids = [...here, ...elsewhere].map((r) => r.id);
      if (!ids.length) return;
      const i = ids.indexOf(this.selected);
      this.select(ids[(i + (e.code === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length]);
    }
  }

  select(id) {
    if (this.busy || id === this.selected) return;
    this.selected = id;
    this.qty = 1;
    this.msg = null;
    this.game.audio.play('hover');
    this.render();
  }

  // Craft: the shared rules first (a refusal said at once); asked, the fabrication runs across the button and the answer
  // is shown once both are done
  make() {
    const g = this.game;
    const r = this.selected && recipeById(this.selected);
    if (!r || this.busy || !makesAt(r, this.at, this.tier())) return;
    const before = g.inventory.state;
    // (waiting before it asks: the sandbox answers within the ask)
    const busy = (this.busy = { answer: null, done: false, at: performance.now(), before });
    const problem = g.crafting.make(r.id, this.qty, this.at, this.tier());
    if (problem) {
      this.busy = null;
      return this.refuse(problem, r, before);
    }
    const btn = this.el.querySelector('[data-make]');
    const sweep = btn?.querySelector('.fab-sweep');
    if (!btn || !sweep || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.busy.done = true;
      return this.settle();
    }
    btn.classList.add('working');
    btn.disabled = true;
    // (the controls that cannot be used meanwhile dim, eased; the answer's redraw brings them back the same way)
    this.el.firstElementChild.classList.add('fab-busy');
    busy.dimmed = true;
    g.audio.play('ui');
    const run = sweep.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: FABRICATE_MS, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' });
    run.onfinish = () => {
      if (this.busy !== busy) return;
      busy.done = true;
      this.settle();
    };
  }

  learn(id) {
    const g = this.game;
    if (this.busy) return;
    // (a lesson needs no fabrication: it shows as the answer comes, which the sandbox gives within the ask)
    const before = g.inventory.state;
    this.busy = { answer: null, done: true, at: performance.now(), before };
    const problem = g.crafting.learn(id);
    if (problem) {
      this.busy = null;
      return this.refuse(problem, recipeById(id), before);
    }
    this.settle();
  }

  // the server's answer (or the sandbox's): kept until the fabrication on the button is done
  answered(m) {
    if (!this.isOpen) return;
    if (this.busy && !this.busy.answer) {
      this.busy.answer = m;
      this.settle();
    }
  }

  settle() {
    const b = this.busy;
    if (!b?.done || !b.answer) return;
    this.busy = null;
    const g = this.game;
    const m = b.answer;
    const recipe = recipeById(m.recipe);
    if (m.result === 'made') {
      this.msg = { text: `Made ${amount(m.count, m.item).toLowerCase()}`, tone: 'good' };
      g.audio.play('sell');
      // as many as the materials left make, never more than were asked for
      if (recipe) this.qty = Math.max(1, Math.min(this.qty, craftableCount(g.inventory.state, recipe)));
      // what changed flashes once: the output, each material used, and the recipe's row
      return this.render({ woke: b.dimmed, bump: '.fab-mat, .fab-out, .fab-row.sel' });
    }
    if (m.result === 'learned') {
      this.msg = { text: `Learned the ${recipe?.name ?? m.recipe} recipe, for good`, tone: 'good' };
      g.audio.play('discovery');
      // where the row and its heading stood, taken before the redraw
      const was = this.el.querySelector(`[data-key="l-${m.recipe}"]`);
      const from = was?.getBoundingClientRect() ?? null;
      // its tag and its LEARN button, where they stood in it
      const parts = [...(was?.querySelectorAll(':scope > .inv-tag, :scope > .res-ico, :scope > .inv-act') ?? [])].map((n) => {
        const r = n.getBoundingClientRect();
        return { node: n.cloneNode(true), dx: r.left - from.left, dy: r.top - from.top };
      });
      const head = this.el.querySelector('[data-group="learn"]');
      const label = head && { node: head.cloneNode(true), rect: head.getBoundingClientRect() };
      // (the recipe selected stays so: the one learned joins the list beside it)
      return this.render({ learned: { recipe: m.recipe, from, label, parts } });
    }
    this.refuse(m.reason, recipe, b.before, b.dimmed);
  }

  // `woke`: the refusal ends a fabrication or a lesson (the server's answer), so its dimmed controls come back eased
  refuse(reason, recipe, inv, woke = false) {
    this.msg = { text: this.refusal(reason, recipe, inv), tone: 'refused' };
    this.game.audio.play('error');
    this.render({ woke, warn: reason === 'materials' });
  }

  // what the player is told when a craft or a lesson is refused (the server's reasons, ARCHITECTURE §23)
  refusal(reason, recipe, inv) {
    const ship = this.at === 'ship';
    switch (reason) {
      case 'materials': {
        const short = recipe && materialsOf(recipe, this.qty).find((m) => countOf(inv, m.item) < m.count);
        return short ? `Not enough ${nameOf(short.item).toLowerCase()}: ${countOf(inv, short.item).toLocaleString()} of ${short.count.toLocaleString()}` : 'Not enough materials';
      }
      case 'no_room': {
        const out = recipe && outputOf(recipe);
        return out ? `No room in the suit or the cargo pods for ${amount(out.count * this.qty, out.item).toLowerCase()}` : 'No room for what it makes';
      }
      case 'fabricator':
        return ship ? "The ship's fabricator makes ammo and cartridges only" : 'This fabricator does not make that recipe';
      case 'place':
        return ship ? 'Board the ship, or stand beside it, to use its fabricator' : "Out of the fabricator terminal's reach";
      case 'not_known':
        return 'You have not learned that recipe';
      case 'known':
        return 'You know that recipe already; keep the item, or sell it';
      case 'no_item':
        return 'No recipe item to learn it from';
      case 'unknown':
        return 'No such recipe';
      case 'rate':
        return 'The fabricator is still cycling. A moment.';
      default:
        return 'The fabricator is offline';
    }
  }
}
