// The chat panel, the party frame and the call-for-aid list (P1.E15.T03; DESIGN 16.6 "Social", docs/ARCHITECTURE.md §13,
// §21), drawn into the HUD from what SocialModel holds.
//
// Closed, the chat panel is a feed in the bottom-left corner: each new line (of any channel, and the news and refusals)
// rises in on a plate of its own, the lines above easing up to make room, and fades out of the way ten seconds later, as
// the location line's objective settles. Enter (or /) opens it: the panel's plate, its tabs (shard, system, party, and
// the beacons), the log of the tab and the input, the feed cross-fading into the log where it stands; the mouse is freed
// (the panel is a HUD overlay, 'chat', which Esc closes like any menu) so the party frame's and the beacon list's buttons
// take clicks while it is open. Enter sends and closes, re-capturing the mouse.
//
// The party frame sits under the location line: each member's name, health and the leader's mark, where an absent
// member is (offline, another system); invites waiting are cards there, with the minute they have left. Whatever grows
// or goes (a row, a card, the requests under the frame, a refusal under a beacon) eases its height, so nothing below it
// jumps. Everything the server or a player wrote goes into the page as text (textContent), never as markup.
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
/** Beacons the list shows at most (the rest are counted under it). */
const LIST_MAX = 50;
/** Sent lines the input remembers (Up and Down). */
const HISTORY = 20;
/** The fades, countdowns, ages and the party's health are looked at this often (ms). */
const TICK_MS = 250;
/** The panel's own motion: the HUD's ease-out, and how long a move, a cross-fade and a fade out take (ms). */
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const MOVE_MS = 240;
const FADE_MS = 200;
/** How far round the fixed panels a world marker is hidden (px). */
const MARKER_MARGIN = 12;
const TABS = ['shard', 'system', 'party', 'beacons'];
const TAB_LABEL = { shard: 'Shard', system: 'System', party: 'Party', beacons: 'Beacons' };
const PLACEHOLDER = { shard: 'Say something to the shard', system: 'Say something to this system', party: 'Say something to your party' };
const KEYS_HINT = 'Enter send · Esc close · Tab channel · /help';
const OWN_IDLE = 'Call the shard into the instance you are in';

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

/** Sets a node's text only when it changed (no layout work for the same words). */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/** "0:52": the time an invite has left. */
const clock = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The box properties that open and close with an element, at nothing. */
const SHUT = { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' };

/** Its box properties as they stand (mid-animation, as animated). */
function openBox(e) {
  const cs = getComputedStyle(e);
  return { height: `${e.offsetHeight}px`, opacity: Number(cs.opacity), marginTop: cs.marginTop, marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom };
}

/** Clips an element's content while its height animates. */
function clipping(e, a) {
  e.classList.add('sizing');
  const done = () => e.classList.remove('sizing');
  a.addEventListener('finish', done);
  a.addEventListener('cancel', done);
  return a;
}

/** Opens an element from nothing to its own height, fading it in. */
function reveal(e) {
  for (const a of e.getAnimations()) a.cancel();
  return clipping(e, e.animate([SHUT, openBox(e)], { duration: MOVE_MS, easing: EASE }));
}

/** Closes an element from where it stands to nothing, fading it out; `done()` once it is shut. */
function conceal(e, done) {
  const from = openBox(e);
  for (const a of e.getAnimations()) a.cancel();
  const a = clipping(e, e.animate([from, SHUT], { duration: MOVE_MS, easing: EASE, fill: 'forwards' }));
  a.addEventListener('finish', () => {
    done();
    a.cancel();
  });
  return a;
}

/** Eases an element's height from `from` (px) to what it is now. */
function resize(e, from) {
  const to = e.offsetHeight;
  if (Math.abs(to - from) < 0.5) return;
  clipping(e, e.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: MOVE_MS, easing: EASE }));
}

/** The vertical offset an element's running transform animation has it at (px). */
function offsetY(e) {
  const t = getComputedStyle(e).transform;
  return t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
}

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
    this.partyShown = false;
    this.footShown = false;
    this.invitesKey = '';
    /** the screen boxes of the fixed panels, where world markers are hidden */
    this.keepOut = [];
    this.build(hud.layer);
    window.addEventListener('keydown', (e) => this.onKey(e));
    // a click into the world closes the panel and takes the mouse back
    game.engine.renderer.domElement.addEventListener('mousedown', () => this.close());
  }

  /** Listens to the connection (Net) the character is in play on; null when there is none. */
  attach(net) {
    this.offWelcome?.();
    this.offWelcome = null;
    this.model.attach(net);
    // (said once, as the world first shows)
    if (net) this.offWelcome = net.on('welcome', (m, first) => first && this.model.note('Enter to chat · /help for commands'));
  }

  get isOpen() {
    return this.game.overlay === 'chat';
  }

  /** Whether a world marker at (x, y) on screen sits under (or left of) one of the fixed panels: the HUD hides it there. */
  covers(x, y) {
    for (const r of this.keepOut) if (x <= r.right + MARKER_MARGIN && y >= r.top - MARKER_MARGIN && y <= r.bottom + MARKER_MARGIN) return true;
    return false;
  }

  // ---------- the page ----------

  build(layer) {
    // the party frame and the invites waiting, under the location line
    this.side = el('div', 'social-side', layer);
    this.partyEl = el('div', 'sp-party', this.side);
    this.rowsEl = el('div', 'sp-rows', this.partyEl);
    // (kept as it is while the rows are redrawn, so a name half typed into it stays)
    this.footEl = el('div', 'sp-foot', this.partyEl);
    this.footEl.style.display = 'none';
    this.inviteName = el('input', '', this.footEl);
    this.inviteName.type = 'text';
    this.inviteName.placeholder = 'Invite by name';
    this.inviteName.maxLength = 20;
    this.inviteName.spellcheck = false;
    this.inviteName.autocomplete = 'off';
    const invite = () => {
      if (this.model.submit(`/invite ${this.inviteName.value}`).ok) this.inviteName.value = '';
    };
    this.inviteName.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') invite();
    });
    button('btn small', this.footEl, 'Invite', invite);
    this.leaveBtn = button('btn small ghost', this.footEl, 'Leave', () => this.model.partyOp({ op: 'leave' }));
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
    this.body = el('div', 'sc-body', this.panel);
    this.logEl = null;
    this.beaconsEl = el('div', 'sc-beacons', this.body);
    this.ownEl = el('div', 'sb-own', this.beaconsEl);
    this.ownTitle = el('div', 'sb-own-title', this.ownEl, 'Your beacon');
    this.ownText = el('div', 'sb-own-text', this.ownEl, OWN_IDLE);
    this.ownBtn = button('btn small ghost', this.ownEl, 'Raise beacon', () => (this.model.net?.beacons.own ? this.model.lower() : this.model.raise()));
    this.listEl = el('div', 'sb-list', this.beaconsEl);
    this.moreEl = el('div', 'sb-more', this.beaconsEl);
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
    // (the log's scroll read first, before anything is written)
    const log = this.logEl;
    const pre = log ? { atBottom: log.scrollTop + log.clientHeight >= log.scrollHeight - 4 } : null;
    const beacons = open && this.tab === 'beacons';
    if (beacons !== this.chat.classList.contains('tab-beacons')) {
      this.chat.classList.toggle('tab-beacons', beacons);
      if (beacons) this.beaconsEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
    }
    for (const t of TABS) this.tabButtons[t].classList.toggle('on', t === this.tab);
    setText(this.chanEl, TAB_LABEL[m.channel]);
    this.chanEl.className = `sc-chan ch-${m.channel}`;
    this.input.placeholder = PLACEHOLDER[m.channel];
    if (open && this.tab !== 'beacons') this.seen[this.tab] = m.lineId;
    this.renderBadges();
    this.renderLog(now, pre);
    if (beacons) this.renderBeacons();
    this.renderParty();
    this.renderInvites(now);
  }

  renderBadges() {
    const m = this.model;
    for (const t of ['shard', 'system', 'party']) {
      const n = t === this.tab && this.isOpen ? 0 : m.lines.filter((l) => l.channel === t && l.id > this.seen[t] && !l.mine).length;
      setText(this.tabButtons[t].badge, n ? String(Math.min(n, 99)) : '');
    }
    const own = m.net?.beacons.own?.id;
    const calls = m.net ? [...m.net.beacons.byId.keys()].filter((id) => id !== own).length : 0;
    setText(this.tabButtons.beacons.badge, calls ? String(calls) : '');
  }

  /**
   * The lines showing: open, the tab's (and the notes), newest at the bottom; closed, the newest of every channel, each
   * on a plate. A new line rises in and the lines above ease up to make room for it; one pushed out of the feed fades.
   * Opening, closing or switching tab cross-fades the lines where they stand into the new set.
   */
  renderLog(now, pre) {
    const open = this.isOpen;
    const lines = this.model.lines;
    const want = open ? lines.filter((l) => l.channel === null || l.channel === this.tab).slice(-LOG_LINES) : lines.slice(-FEED_LINES);
    const fresh = this.rebuild || !this.linesEl;
    if (fresh) {
      this.rebuild = false;
      this.crossfade(open);
    }
    const box = this.linesEl;
    const keep = new Set(want.map((l) => l.id));
    for (const [id, node] of this.nodes) {
      if (keep.has(id)) continue;
      this.nodes.delete(id);
      // (the oldest line pushed out of the feed fades where it is; nothing below it moves)
      if (open || node.classList.contains('gone')) node.remove();
      else node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' }).addEventListener('finish', () => node.remove());
    }
    const added = [];
    for (const l of want) {
      if (this.nodes.has(l.id)) continue;
      const node = this.lineNode(l);
      if (fresh) node.classList.add('still');
      if (!open && !this.shown(l, now)) node.classList.add('gone');
      box.appendChild(node);
      this.nodes.set(l.id, node);
      added.push(node);
    }
    const log = this.logEl;
    if (open && (fresh || added.length)) log.classList.toggle('long', log.scrollHeight > log.clientHeight + 1);
    if (fresh) {
      if (open) log.scrollTop = log.scrollHeight;
      return;
    }
    if (!added.length || (open && !pre.atBottom)) return;
    if (open) log.scrollTop = log.scrollHeight;
    // the lines already there ease up by the room the new ones took (each line and the gap over it), from wherever a
    // slide still had them; lines gone from the top of a bottom-anchored stack move nothing
    const gap = parseFloat(getComputedStyle(box).rowGap) || 0;
    const rise = added.reduce((h, n) => h + n.offsetHeight + gap, 0) + offsetY(box);
    this.slide?.cancel();
    this.slide = box.animate([{ transform: `translateY(${rise}px)` }, { transform: 'translateY(0)' }], { duration: MOVE_MS, easing: EASE });
  }

  /** A new log for the lines (the feed's, or the open tab's), fading in over the old one as it fades out where it stands. */
  crossfade(open) {
    const old = this.logEl;
    const log = el('div', `sc-log ${open ? 'full' : 'feed'}`);
    this.body.insertBefore(log, this.beaconsEl);
    this.linesEl = el('div', 'sc-lines', log);
    this.logEl = log;
    this.nodes.clear();
    this.slide = null;
    if (!old) return;
    old.classList.add('ghost');
    old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' }).addEventListener('finish', () => old.remove());
    log.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
  }

  lineNode(l) {
    const node = el('div', `sc-line ${l.kind}${l.channel ? ` ch-${l.channel}` : ''}${l.tone ? ` tone-${l.tone}` : ''}`);
    if (l.kind === 'chat') el('span', 'sc-who', node, l.from);
    el('span', 'sc-text', node, l.text);
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
    // (health in steps of 2%: an entity's hp in view moves finer than the bar shows)
    const key = JSON.stringify([live, m.leads, members.map((x) => [x.name, x.online, x.system, x.health === null ? null : Math.round(x.health * 50), x.leader])]);
    if (key === this.partyKey) return;
    this.partyKey = key;
    const shown = live || members.length > 0;
    if (!shown) {
      // (the frame closes with its rows as they were)
      if (this.partyShown) {
        this.partyShown = false;
        conceal(this.partyEl, () => {
          if (this.partyShown) return;
          this.partyEl.classList.remove('shown');
          this.rowsEl.replaceChildren();
          this.footShown = false;
          this.footEl.style.display = 'none';
        });
      }
      return;
    }
    const box = this.rowsEl;
    const from = this.partyShown ? box.offsetHeight : null;
    for (const a of box.getAnimations()) a.cancel();
    const old = new Set([...box.querySelectorAll('.sp-member')].map((r) => r.dataset.name));
    box.replaceChildren();
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
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, x.health)) * 50) * 2}%`;
        row.classList.toggle('hurt', x.health < 0.6);
        row.classList.toggle('low', x.health < 0.3);
      }
    }
    this.leaveBtn.style.display = members.length ? '' : 'none';
    if (live !== this.footShown) {
      this.footShown = live;
      if (live) {
        this.footEl.style.display = '';
        if (this.partyShown) reveal(this.footEl);
      } else {
        this.inviteName.blur();
        conceal(this.footEl, () => !this.footShown && (this.footEl.style.display = 'none'));
      }
    }
    if (!this.partyShown) {
      this.partyShown = true;
      this.partyEl.classList.add('shown');
      reveal(this.partyEl);
    } else resize(box, from);
  }

  /** The invites waiting: who, the time left (a hairline running down the minute), accept and decline. A new card opens
   * in, one answered or lapsed closes out, and those below ease along. */
  renderInvites(now) {
    const m = this.model;
    const key = m.invites.map((i) => `${i.from}@${i.at}`).join('|');
    if (key === this.invitesKey) return;
    this.invitesKey = key;
    // (the newest first, three at most)
    const want = m.invites.slice(-3).reverse();
    const keys = new Set(want.map((i) => `${i.from}@${i.at}`));
    for (const card of [...this.invitesEl.children]) {
      if (keys.has(card.dataset.key) || card.leaving) continue;
      card.leaving = true;
      conceal(card, () => card.remove());
    }
    let before = this.invitesEl.firstChild;
    for (const inv of want) {
      const k = `${inv.from}@${inv.at}`;
      const kept = [...this.invitesEl.children].find((c) => c.dataset.key === k && !c.leaving);
      if (kept) {
        before = kept.nextSibling;
        continue;
      }
      const card = el('div', 'sp-invite');
      this.invitesEl.insertBefore(card, before);
      before = card.nextSibling;
      this.game.audio?.play('ui');
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
      reveal(card);
    }
  }

  /** The beacon list: the player's own beacon (raise or lower it, or why the server would not) over the shard's, newest
   * first, each with its kind, place, star system, caller, open slots, age and distance, and an answer, with the server's
   * refusal opening in under the beacon answered. */
  renderBeacons() {
    const m = this.model;
    const beacons = m.net?.beacons;
    const serverNow = m.net?.serverTime() ?? null;
    const age = (t) => (serverNow === null ? '' : fmtAge(serverNow - t));
    const own = beacons?.own ?? null;
    this.ownEl.classList.toggle('up', !!own);
    // (a refused raise or lower says why in the line under the title, in place of what the button does)
    const refused = m.beaconRefusal?.text ?? null;
    const ownText = refused ?? (own ? `${own.place} · ${own.open} of ${own.cap} open${serverNow === null ? '' : ` · lapses in ${fmtAge(own.until - serverNow)}`}` : OWN_IDLE);
    if (this.ownText.textContent !== ownText) {
      const was = this.ownText.classList.contains('refused');
      this.ownText.textContent = ownText;
      this.ownText.classList.toggle('refused', !!refused);
      if (was !== !!refused) this.ownText.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
    }
    setText(this.ownBtn, own ? 'Lower' : 'Raise beacon');
    const all = (beacons?.list() ?? []).filter((b) => b.id !== own?.id);
    const list = all.slice(0, LIST_MAX);
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
        r = { row, refusal: null };
        r.kind = el('span', `sb-kind k-${b.kind}`, row, KIND_LABEL[b.kind] ?? b.kind);
        const main = el('div', 'sb-main', row);
        r.place = el('div', 'sb-place', main, b.place);
        r.meta = el('div', 'sb-meta', main);
        r.where = el('div', 'sb-meta', main);
        r.btn = button('btn small sb-answer', row, 'Answer', () => m.answer(b.id));
        this.rows.set(b.id, r);
      }
      const system = this.game.galaxy?.systems[b.system]?.name ?? `System ${b.system}`;
      const dist = this.distanceTo(b);
      const ago = age(b.at);
      setText(r.meta, `${b.from} · ${b.open} of ${b.cap} open${ago ? ` · ${ago} ago` : ''}`);
      setText(r.where, dist ? `${system} · ${dist}` : system);
      this.refusalUnder(r, m.answerRefusal?.id === b.id ? m.answerRefusal.text : '');
    }
    // (rows already in place are left there: a row moved under the pointer would lose its click)
    list.forEach((b, i) => {
      const row = this.rows.get(b.id).row;
      if (this.listEl.children[i] !== row) this.listEl.insertBefore(row, this.listEl.children[i] ?? null);
    });
    setText(this.moreEl, all.length > list.length ? `+${all.length - list.length} more` : '');
    this.emptyEl.style.display = list.length ? 'none' : '';
    // (a list longer than the panel fades at its foot over a scrollbar)
    const el2 = this.beaconsEl;
    el2.classList.toggle('scrolls', el2.scrollHeight > el2.clientHeight + 1);
  }

  /** The server's refusal under a beacon's row: a new one opens in, the old one closes out, and the rows below ease. */
  refusalUnder(r, text) {
    if ((r.refusal?.textContent ?? '') === text) return;
    const old = r.refusal;
    r.refusal = null;
    if (old) conceal(old, () => old.remove());
    if (!text) return;
    r.refusal = el('div', 'sb-refusal', r.row, text);
    reveal(r.refusal);
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
   * the party's health, and the beacons' ages; and where the fixed panels are, for the markers. */
  tick(now) {
    const m = this.model;
    const open = this.isOpen;
    // (read before anything here writes)
    this.keepOut = [];
    if (this.partyShown) this.keepOut.push(this.partyEl.getBoundingClientRect());
    if (this.invitesEl.firstChild) this.keepOut.push(this.invitesEl.getBoundingClientRect());
    if (open) this.keepOut.push(this.panel.getBoundingClientRect());
    m.expireInvites();
    if (!open) for (const l of m.lines.slice(-FEED_LINES)) this.nodes.get(l.id)?.classList.toggle('gone', !this.shown(l, now));
    for (const card of this.invitesEl.children) if (card.left) setText(card.left, clock((card.until - now) / 1000));
    const muted = m.mutedFor();
    const wait = muted ? 0 : m.paceWait();
    const warn = muted > 0 || wait > 0.05;
    setText(this.hintEl, muted ? `Muted · ${fmtWait(muted)}` : warn ? `Slow down · ${fmtWait(wait)}` : KEYS_HINT);
    if (warn !== this.hintEl.classList.contains('warn')) this.hintEl.classList.toggle('warn', warn);
    this.renderParty();
    if (this.dirty) return;
    if (open && this.tab === 'beacons') this.renderBeacons();
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

  /** Menus closed the panel (Esc, a click into the world, a send): nothing of it keeps the keys. */
  closed() {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && (this.chat.contains(focused) || this.side.contains(focused))) focused.blur();
    this.side.classList.remove('live');
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

  /** Enter opens the panel (and / opens it with a command started); with it open, Enter takes the input back, unless a
   * button has the keys (Enter presses it). */
  onKey(e) {
    if (e.defaultPrevented || e.repeat) return;
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    if (!enter && e.key !== '/') return;
    const t = e.target;
    // (another field has the keys, the sign-in or the party's invite field; or a button, which Enter presses)
    if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A' || t.isContentEditable)) return;
    if (this.isOpen) {
      if (!enter) return;
      e.preventDefault();
      this.input.focus();
      return;
    }
    if (!this.canOpen()) return;
    e.preventDefault();
    this.open(enter ? '' : '/');
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
    setText(this.countEl, n > CHAT_MAX - 60 ? `${n}/${CHAT_MAX}` : '');
  }
}
