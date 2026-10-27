// The chat panel, the party frame and the call-for-aid list (P1.E15.T03; DESIGN 16.6 "Social", docs/ARCHITECTURE.md §13,
// §21), drawn into the HUD from what SocialModel holds.
//
// Closed, the chat panel is a feed in the bottom-left corner: each new line (of any channel, and the news and refusals)
// rises in on a plate of its own and fades out of the way ten seconds later, as the location line's objective settles.
// Enter (or /) opens it: the panel's plate, its tabs (shard, system, party, and the beacons), the log of the tab and the
// input; the mouse is freed (the panel is a HUD overlay, 'chat', which Esc closes like any menu) so the party frame's and
// the beacon list's buttons take clicks while it is open. Enter sends and closes, re-capturing the mouse.
//
// The party frame sits under the location line: each member's name, health and the leader's mark, where an absent
// member is (offline, another system); invites waiting are cards there, with the minute they have left. Everything the
// server or a player wrote goes into the page as text (textContent), never as markup.
import * as THREE from 'three';
import { CHAT_MAX, PARTY_MAX } from '@astra/shared/protocol';
import { frameOfId } from '../../net/pose.js';
import { fmtDist } from '../HUD.js';
import { SocialModel } from './model.js';
import { KIND_LABEL, fmtAge, fmtWait } from './words.js';

/** How long a line stays in the closed feed before it fades (ms): the location line's objective settles after 8 s. */
export const FEED_MS = 10_000;
/** Once the panel closes, the lines it showed stay this long before they fade (ms). */
export const CLOSE_GRACE_MS = 4000;
/** Lines the closed feed shows at most, and the open log. */
const FEED_LINES = 6;
const LOG_LINES = 100;
/** Sent lines the input remembers (Up and Down). */
const HISTORY = 20;
/** The fades, countdowns, ages and the party's health are looked at this often (ms). */
const TICK_MS = 250;
const TABS = ['shard', 'system', 'party', 'beacons'];
const TAB_LABEL = { shard: 'Shard', system: 'System', party: 'Party', beacons: 'Beacons' };
const PLACEHOLDER = { shard: 'Say something to the shard', system: 'Say something to this system', party: 'Say something to your party' };
const KEYS_HINT = 'Enter send · Esc close · Tab channel · /help';

const _here = new THREE.Vector3();
const _there = new THREE.Vector3();

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function button(cls, parent, text, onClick) {
  const b = el('button', cls, parent, text);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** "0:52": the time an invite has left. */
const clock = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class SocialUI {
  /** `hud` the HUD whose layer it draws into and whose clock it runs on. */
  constructor(game, hud) {
    this.game = game;
    this.hud = hud;
    this.model = new SocialModel({ now: () => hud.now(), system: () => game.galaxy?.current?.id ?? null });
    this.model.subscribe(() => (this.dirty = true));
    this.tab = 'shard';
    /** the newest line each chat tab has shown open: lines after it are unread */
    this.seen = { shard: 0, system: 0, party: 0 };
    this.closedAt = -Infinity;
    this.history = [];
    this.historyAt = 0;
    this.dirty = true;
    this.rebuild = true;
    this.wasOpen = false;
    this.lastTick = -Infinity;
    /** line id → its node in the log */
    this.nodes = new Map();
    /** beacon id → its row in the list */
    this.rows = new Map();
    this.partyKey = '';
    this.invitesKey = '';
    this.build(hud.layer);
    window.addEventListener('keydown', (e) => this.onKey(e));
    // a click into the world closes the panel and takes the mouse back
    game.engine.renderer.domElement.addEventListener('mousedown', () => this.close());
  }

  /** Listens to the connection (Net) the character is in play on; null when there is none. */
  attach(net) {
    this.model.attach(net);
    if (net && !this.greeted) {
      this.greeted = true;
      this.model.note('Enter to chat · /help for commands');
    }
  }

  get isOpen() {
    return this.game.overlay === 'chat';
  }

  // ---------- the page ----------

  build(layer) {
    // the party frame and the invites waiting, under the location line
    this.side = el('div', 'social-side', layer);
    this.partyEl = el('div', 'sp-party', this.side);
    this.invitesEl = el('div', 'sp-invites', this.side);

    // the chat panel, bottom left
    this.chat = el('div', 'social-chat', layer);
    this.panel = el('div', 'sc-panel frame', this.chat);
    this.tabsEl = el('div', 'sc-tabs', this.panel);
    this.tabButtons = {};
    for (const t of TABS) {
      const b = button(`sc-tab t-${t}`, this.tabsEl, undefined, () => this.setTab(t));
      el('span', '', b, TAB_LABEL[t]);
      b.badge = el('i', 'sc-badge', b);
      this.tabButtons[t] = b;
    }
    const body = el('div', 'sc-body', this.panel);
    this.log = el('div', 'sc-log', body);
    this.beaconsEl = el('div', 'sc-beacons', body);
    this.ownEl = el('div', 'sb-own', this.beaconsEl);
    this.ownTitle = el('div', 'sb-own-title', this.ownEl, 'Your beacon');
    this.ownText = el('div', 'sb-own-text', this.ownEl);
    this.ownBtn = button('btn small ghost', this.ownEl, 'Raise beacon', () => (this.model.net?.beacons.own ? this.model.lower() : this.model.raise()));
    this.ownRefusal = el('div', 'sb-refusal', this.ownEl);
    this.listEl = el('div', 'sb-list', this.beaconsEl);
    this.emptyEl = el('div', 'sb-empty', this.beaconsEl, 'No calls for aid on the shard');

    const row = el('div', 'sc-input', this.panel);
    this.chanEl = el('span', 'sc-chan', row);
    this.input = el('input', '', row);
    this.input.type = 'text';
    this.input.maxLength = CHAT_MAX;
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', 'Chat');
    this.countEl = el('span', 'sc-count', row);
    this.hintEl = el('div', 'sc-hint', this.panel, KEYS_HINT);
    this.input.addEventListener('keydown', (e) => this.onInputKey(e));
    this.input.addEventListener('input', () => this.updateCount());
  }

  /** The panel and its parts as they should be now: called every frame (cheap unless something changed). */
  update() {
    const open = this.isOpen;
    const now = this.hud.now();
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      if (!open) this.closedAt = now;
      this.chat.classList.toggle('show', open);
      this.side.classList.toggle('live', open);
      this.dirty = this.rebuild = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.render(now);
    }
    if (now - this.lastTick >= TICK_MS) {
      this.lastTick = now;
      this.tick(now);
    }
  }

  render(now) {
    const m = this.model;
    const open = this.isOpen;
    this.chat.classList.toggle('tab-beacons', this.tab === 'beacons');
    for (const t of TABS) this.tabButtons[t].classList.toggle('on', t === this.tab);
    this.chanEl.textContent = TAB_LABEL[m.channel];
    this.chanEl.className = `sc-chan ch-${m.channel}`;
    this.input.placeholder = PLACEHOLDER[m.channel];
    if (open && this.tab !== 'beacons') this.seen[this.tab] = m.lineId;
    this.renderBadges();
    this.renderLog(now);
    if (open && this.tab === 'beacons') this.renderBeacons(now);
    this.renderParty();
    this.renderInvites(now);
  }

  renderBadges() {
    const m = this.model;
    for (const t of ['shard', 'system', 'party']) {
      const n = t === this.tab && this.isOpen ? 0 : m.lines.filter((l) => l.channel === t && l.id > this.seen[t]).length;
      this.tabButtons[t].badge.textContent = n ? String(Math.min(n, 99)) : '';
    }
    const own = m.net?.beacons.own?.id;
    const calls = m.net ? [...m.net.beacons.byId.keys()].filter((id) => id !== own).length : 0;
    this.tabButtons.beacons.badge.textContent = calls ? String(calls) : '';
  }

  /** The lines showing: open, the tab's (and the notes) with the newest at the bottom; closed, the newest of every channel.
   * Lines already drawn stay as they are, new ones rise in; switching tab or opening redraws without the rise. */
  renderLog(now) {
    const open = this.isOpen;
    const lines = this.model.lines;
    const want = open ? lines.filter((l) => l.channel === null || l.channel === this.tab).slice(-LOG_LINES) : lines.slice(-FEED_LINES);
    const still = this.rebuild;
    this.rebuild = false;
    if (still) {
      this.log.replaceChildren();
      this.nodes.clear();
    }
    const keep = new Set(want.map((l) => l.id));
    for (const [id, node] of this.nodes) {
      if (keep.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
    }
    const atBottom = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 4;
    for (const l of want) {
      if (this.nodes.has(l.id)) continue;
      const node = this.lineNode(l);
      if (still) node.classList.add('still');
      if (!open && !this.shown(l, now)) node.classList.add('gone');
      this.log.appendChild(node);
      this.nodes.set(l.id, node);
    }
    if (open && (still || atBottom)) this.log.scrollTop = this.log.scrollHeight;
  }

  lineNode(l) {
    const node = el('div', `sc-line ${l.kind}${l.channel ? ` ch-${l.channel}` : ''}${l.tone ? ` tone-${l.tone}` : ''}`);
    if (l.kind === 'chat') el('span', 'sc-who', node, l.from);
    el('span', 'sc-text', node, l.text);
    node.at = l.at;
    return node;
  }

  /** Whether a line still shows in the closed feed: ten seconds after it came, or a few after the panel closed. */
  shown(l, now) {
    return now - l.at < FEED_MS || now - this.closedAt < CLOSE_GRACE_MS;
  }

  /** The party frame: a row per member (the leader marked, the player's own, where the absent are, health), and while
   * the panel is open the requests: invite by name, leave, and for the leader promote and remove. */
  renderParty() {
    const m = this.model;
    const live = this.isOpen;
    const members = m.members();
    const key = JSON.stringify([live, m.leads, members.map((x) => [x.name, x.online, x.system, x.health === null ? null : Math.round(x.health * 100), x.leader])]);
    if (key === this.partyKey) return;
    this.partyKey = key;
    const box = this.partyEl;
    const old = new Map([...box.querySelectorAll('.sp-member')].map((r) => [r.dataset.name, r]));
    box.replaceChildren();
    if (!members.length && !live) return;
    const head = el('div', 'sp-head', box);
    el('span', '', head, 'Party');
    if (members.length) el('b', '', head, `${members.length}/${PARTY_MAX}`);
    if (!members.length) el('div', 'sp-none', box, 'Not in a party');
    const here = this.game.galaxy?.current?.id;
    for (const x of members) {
      const row = el('div', `sp-member${x.leader ? ' leader' : ''}${x.me ? ' me' : ''}${x.online ? '' : ' offline'}`, box);
      row.dataset.name = x.name;
      // (a member already shown does not rise in again)
      if (old.has(x.name)) row.classList.add('still');
      const mark = el('i', 'sp-mark', row);
      if (x.leader) mark.title = 'Leader';
      el('span', 'sp-name', row, x.name);
      // (where an absent member is: offline, or the star system it is in)
      el('span', 'sp-tag', row, !x.online ? 'Offline' : x.me ? 'You' : x.system !== null && x.system !== here ? (this.game.galaxy.systems[x.system]?.name ?? '') : '');
      // the leader's requests, beside the health bar
      if (live && m.leads && !x.me) {
        row.classList.add('acts');
        const acts = el('span', 'sp-acts', row);
        if (x.online) button('sp-act', acts, 'Lead', () => m.partyOp({ op: 'promote', name: x.name }));
        button('sp-act', acts, 'Kick', () => m.partyOp({ op: 'kick', name: x.name }));
      }
      if (x.health !== null) {
        const hp = el('div', 'sp-hp', row);
        const fill = el('b', '', hp);
        fill.style.width = `${(Math.max(0, Math.min(1, x.health)) * 100).toFixed(0)}%`;
        row.classList.toggle('hurt', x.health < 0.6);
        row.classList.toggle('low', x.health < 0.3);
      }
    }
    if (!live) return;
    const foot = el('div', 'sp-foot', box);
    const name = el('input', '', foot);
    name.type = 'text';
    name.placeholder = 'Invite by name';
    name.maxLength = 20;
    name.spellcheck = false;
    name.autocomplete = 'off';
    const invite = () => {
      const r = m.submit(`/invite ${name.value}`);
      if (r.ok) name.value = '';
    };
    name.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') invite();
    });
    button('btn small', foot, 'Invite', invite);
    if (members.length) button('btn small ghost', foot, 'Leave', () => m.partyOp({ op: 'leave' }));
  }

  /** The invites waiting: who, the time left (a hairline running down the minute), accept and decline. */
  renderInvites(now) {
    const m = this.model;
    const key = m.invites.map((i) => `${i.from}@${i.at}`).join('|');
    if (key === this.invitesKey) return;
    this.invitesKey = key;
    const old = new Map([...this.invitesEl.children].map((c) => [c.dataset.key, c]));
    this.invitesEl.replaceChildren();
    // (the newest first, three at most)
    for (const inv of m.invites.slice(-3).reverse()) {
      const k = `${inv.from}@${inv.at}`;
      const kept = old.get(k);
      if (kept) {
        this.invitesEl.appendChild(kept);
        continue;
      }
      const card = el('div', 'sp-invite', this.invitesEl);
      card.dataset.key = k;
      card.until = inv.until;
      const head = el('div', 'sp-inv-head', card);
      el('span', '', head, 'Party invite');
      card.left = el('b', '', head, clock((inv.until - now) / 1000));
      const who = el('div', 'sp-inv-who', card);
      el('b', '', who, inv.from);
      el('span', '', who, ' invites you to a party');
      const acts = el('div', 'sp-inv-acts', card);
      button('btn small', acts, 'Accept', () => m.partyOp({ op: 'accept', name: inv.from }));
      button('btn small ghost', acts, 'Decline', () => m.partyOp({ op: 'decline', name: inv.from }));
      const hint = el('span', 'sp-inv-hint', acts);
      el('kbd', '', hint, 'Enter');
      hint.title = 'Enter opens the chat panel, whose buttons take clicks';
      // the minute running out, as a hairline (set at its share now, then run down to nothing over the time left)
      const bar = el('i', 'sp-inv-time', card);
      const left = Math.max(0, inv.until - now);
      bar.style.transform = `scaleX(${(left / (inv.until - inv.at)).toFixed(4)})`;
      void bar.offsetWidth;
      bar.style.transition = `transform ${(left / 1000).toFixed(2)}s linear`;
      bar.style.transform = 'scaleX(0)';
    }
  }

  /** The beacon list: the player's own beacon (raise or lower it) over the shard's, newest first, each with its kind,
   * place, star system, caller, open slots, age and distance, and an answer, with the server's refusal under it. */
  renderBeacons(now) {
    const m = this.model;
    const beacons = m.net?.beacons;
    const serverNow = m.net?.serverTime() ?? null;
    const age = (t) => (serverNow === null ? '' : fmtAge(serverNow - t));
    const own = beacons?.own ?? null;
    this.ownEl.classList.toggle('up', !!own);
    this.ownText.textContent = own
      ? `${own.place} · ${own.open} of ${own.cap} open${serverNow === null ? '' : ` · lapses in ${fmtAge(own.until - serverNow)}`}`
      : 'Call the shard into the instance you are in';
    this.ownBtn.textContent = own ? 'Lower' : 'Raise beacon';
    this.ownRefusal.textContent = m.beaconRefusal?.text ?? '';
    const list = (beacons?.list() ?? []).filter((b) => b.id !== own?.id).slice(0, 50);
    const keep = new Set(list.map((b) => b.id));
    for (const [id, r] of this.rows) {
      if (keep.has(id)) continue;
      r.row.remove();
      this.rows.delete(id);
    }
    for (const b of list) {
      let r = this.rows.get(b.id);
      if (!r) {
        const row = el('div', 'sb-row');
        r = { row };
        r.kind = el('span', `sb-kind k-${b.kind}`, row, KIND_LABEL[b.kind] ?? b.kind);
        const main = el('div', 'sb-main', row);
        r.place = el('div', 'sb-place', main, b.place);
        r.meta = el('div', 'sb-meta', main);
        r.where = el('div', 'sb-meta', main);
        r.btn = button('btn small sb-answer', row, 'Answer', () => m.answer(b.id));
        r.refusal = el('div', 'sb-refusal', row);
        this.rows.set(b.id, r);
      }
      const system = this.game.galaxy?.systems[b.system]?.name ?? `System ${b.system}`;
      const dist = this.distanceTo(b);
      const ago = age(b.at);
      r.meta.textContent = `${b.from} · ${b.open} of ${b.cap} open${ago ? ` · ${ago} ago` : ''}`;
      r.where.textContent = dist ? `${system} · ${dist}` : system;
      r.refusal.textContent = m.answerRefusal?.id === b.id ? m.answerRefusal.text : '';
    }
    // (rows already in place are left there: a row moved under the pointer would lose its click)
    list.forEach((b, i) => {
      const row = this.rows.get(b.id).row;
      if (this.listEl.children[i] !== row) this.listEl.insertBefore(row, this.listEl.children[i] ?? null);
    });
    this.emptyEl.style.display = list.length ? 'none' : '';
  }

  /** How far the player is from a beacon's place ("here" inside it), when it is in this star system. */
  distanceTo(b) {
    const g = this.game;
    if (!g.system || g.universe?.deep || b.system !== g.galaxy?.current?.id) return '';
    const frame = frameOfId(g.system, g.station, b.frame);
    if (frame === undefined) return '';
    _there.fromArray(b.center);
    if (frame) frame.localToWorld(_there.clone(), _there);
    const st = g.mode === 'foot' ? g.player.state : g.ship.state;
    const d = st.worldPosition(_here).distanceTo(_there);
    return d <= b.radius ? 'here' : fmtDist(d - b.radius);
  }

  /** What changes with time alone: lines fading out of the closed feed, invites running down, a mute or a pace wait,
   * the party's health, and the beacons' ages. */
  tick(now) {
    const m = this.model;
    const open = this.isOpen;
    m.expireInvites();
    if (!open) for (const l of m.lines.slice(-FEED_LINES)) this.nodes.get(l.id)?.classList.toggle('gone', !this.shown(l, now));
    for (const card of this.invitesEl.children) if (card.left) card.left.textContent = clock((card.until - now) / 1000);
    const muted = m.mutedFor();
    const wait = muted ? 0 : m.paceWait();
    this.hintEl.textContent = muted ? `Muted · ${fmtWait(muted)}` : wait > 0.05 ? `Slow down · ${fmtWait(wait)}` : KEYS_HINT;
    this.hintEl.classList.toggle('warn', muted > 0 || wait > 0.05);
    this.renderParty();
    if (this.dirty) return;
    if (open && this.tab === 'beacons') this.renderBeacons(now);
  }

  // ---------- opening, closing, tabs ----------

  canOpen() {
    const g = this.game;
    return !!this.model.net && !g.overlay && (g.mode === 'ship' || g.mode === 'foot') && this.hud.visible && !g.cutscenes?.active && !g.warping;
  }

  /** Opens the panel, the input holding `prefill`. False when it cannot open now (a menu is up, a cutscene plays …). */
  open(prefill = '') {
    if (this.isOpen) {
      this.input.focus();
      return true;
    }
    if (!this.canOpen()) return false;
    const menus = this.game.menus;
    if (!this.registered) {
      this.registered = true;
      // (Esc closes it as it closes any menu; closing takes the mouse back)
      menus.extraOverlays = [...(menus.extraOverlays || []), { name: 'chat', el: this.chat, onClose: () => this.closed() }];
    }
    menus.open('chat', this.chat);
    this.input.value = prefill;
    this.updateCount();
    this.historyAt = this.history.length;
    this.input.focus();
    this.update();
    return true;
  }

  close() {
    if (this.isOpen) this.game.menus.closeAll();
  }

  /** Menus closed the panel (Esc, a click into the world, a send). */
  closed() {
    this.input.blur();
    for (const i of this.side.querySelectorAll('input')) i.blur();
  }

  setTab(t) {
    if (!TABS.includes(t)) return;
    if (t !== 'beacons') this.model.channel = t;
    this.dirty = true;
    if (t === this.tab) return;
    this.tab = t;
    this.dirty = this.rebuild = true;
    this.update();
    if (this.isOpen) this.input.focus();
  }

  cycleTab(step) {
    this.setTab(TABS[(TABS.indexOf(this.tab) + step + TABS.length) % TABS.length]);
  }

  // ---------- keys ----------

  /** Enter opens the panel (and / opens it with a command started); with it open, Enter takes the input back. */
  onKey(e) {
    if (e.defaultPrevented || e.repeat) return;
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Slash') return;
    const t = e.target;
    // (another field has the keys: the sign-in, the party's invite field)
    if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (this.isOpen) {
      if (e.code === 'Slash') return;
      e.preventDefault();
      this.input.focus();
      return;
    }
    if (!this.canOpen()) return;
    e.preventDefault();
    this.open(e.code === 'Slash' ? '/' : '');
  }

  /** The input's keys are its own (Space, Tab and the flight keys never reach the game while typing). Esc is the menus'. */
  onInputKey(e) {
    e.stopPropagation();
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      this.submit();
    } else if (e.code === 'Tab') {
      e.preventDefault();
      this.cycleTab(e.shiftKey ? -1 : 1);
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      this.recall(e.code === 'ArrowUp' ? -1 : 1);
    } else if (e.code === 'Escape') {
      this.close();
    }
  }

  /** Sends what is typed. A line that went closes the panel (a channel word or /help keeps it open); one refused keeps
   * its text to try again. */
  submit() {
    const text = this.input.value;
    if (!text.trim()) return this.close();
    const r = this.model.submit(text);
    if (r.channel) this.setTab(r.channel);
    if (r.keep) return;
    this.history.push(text);
    if (this.history.length > HISTORY) this.history.shift();
    this.input.value = '';
    this.updateCount();
    if (r.ok && !r.stay) this.close();
  }

  recall(step) {
    if (!this.history.length) return;
    this.historyAt = Math.max(0, Math.min(this.history.length, this.historyAt + step));
    this.input.value = this.history[this.historyAt] ?? '';
    this.updateCount();
  }

  /** The characters used, once the line nears its limit. */
  updateCount() {
    const n = this.input.value.length;
    this.countEl.textContent = n > CHAT_MAX - 60 ? `${n}/${CHAT_MAX}` : '';
  }
}
