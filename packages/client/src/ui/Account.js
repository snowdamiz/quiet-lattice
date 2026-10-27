// The title's sign-in and character screens (DESIGN 5.1, 6, 17; docs/ARCHITECTURE.md §9). Play opens them in the title's
// left column, where its menu was, over the title shot: sign in (or make an account), pick one of the account's
// characters or make one (a name and a people; the full creator with looks, perks and the home system's choice is
// P1.E05.T05's), and enter, through Net's hello and join to the welcome that places the character. The server decides
// everything and says why when it refuses; these screens show it.
//
// AccountFlow is the flow without a DOM (what each step shows, what a key or a click does, the server calls), so it is
// unit tested; Account draws it into the title and wires the keys: Enter submits, Esc goes back a step, the arrows move
// through the characters and the peoples.
import { getPeople, PEOPLES } from '@astra/shared/data';
import { nodePosition, strokeEnds, transliterate } from '@astra/shared/art';
import { CharacterName, Username } from '@astra/shared/protocol';
import { describeGalaxySystem, GALAXY_SEED, homeSystems } from '@astra/shared/world';
import * as api from '../net/api.js';
import { clearSession, loadSession, saveSession, sessionExpired } from '../net/session.js';

/** The look a character is made with until the creator offers one (P1.E05.T05). */
export const DEFAULT_LOOK = { palette: 0, pattern: 0, head: 0, suit: 0 };
export const SESSION_ENDED = 'Your session has ended. Sign in again.';
const NAME_RULE = 'Names are 2–20 letters, with single spaces, apostrophes or hyphens between words.';

/** What the entering step says of the connection, by Net's state (and the dev login's request before it). */
export const CONNECTION_TEXT = {
  'signing-in': 'Signing in',
  idle: 'Reaching the server',
  connecting: 'Reaching the server',
  joining: 'Joining the world',
  reconnecting: 'Reaching the server',
  joined: 'In the world',
  closed: 'Connection closed',
};

// the field a server refusal is about, by its code
const FIELD_OF = { reserved_username: 'username', username_taken: 'username', login_failed: 'password', invalid_name: 'name', name_taken: 'name' };

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** What a refused or failed request tells the player, and which field it is about. */
export function refusalOf(err, step) {
  const code = typeof err?.code === 'string' ? err.code : 'http';
  let text = typeof err?.message === 'string' && err.message ? err.message : 'Something went wrong. Try again.';
  let field = FIELD_OF[code] ?? null;
  if (code === 'rate_limited' && err.retryAfter) text = `Too many attempts. Try again in ${err.retryAfter} s.`;
  // (a create the wire schema refused: the server's message names schema paths)
  if (code === 'invalid' && step === 'create') [text, field] = [NAME_RULE, 'name'];
  return { text, field, code };
}

/** A sign-in or sign-up the client can already tell is incomplete or malformed; null when it is worth sending. */
export function credentialsProblem({ username, password }, register) {
  if (!username) return { text: 'Enter your username.', field: 'username' };
  if (!password) return { text: 'Enter your password.', field: 'password' };
  if (!register) return null;
  if (!Username.safeParse(username).success) return { text: 'Usernames are 3–24 letters, digits, - or _.', field: 'username' };
  if (password.length < 8 || password.length > 128) return { text: 'Passwords are 8–128 characters.', field: 'password' };
  return null;
}

/** A typed name as it is sent: trimmed, its spaces single. */
export function normalName(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** A name the wire schema would refuse; the server checks the rest (reserved words, taken names). */
export function nameProblem(name) {
  if (!name) return { text: 'Name your character.', field: 'name' };
  if (!CharacterName.safeParse(name).success) return { text: NAME_RULE, field: 'name' };
  return null;
}

const homeWorlds = new Map();
/** A people as the create step offers it (DESIGN 5.1): what they are, where they come from, and where a character of
 * theirs starts (the home system's world and Waystation), from the shared tables and the game's galaxy. */
export function peopleInfo(id, galaxy) {
  const p = getPeople(id);
  const home = homeSystems(GALAXY_SEED).find((h) => h.people === id);
  const sys = home && galaxy?.systems[home.systemIndex];
  if (sys && !homeWorlds.has(sys.id)) {
    const d = describeGalaxySystem(sys);
    homeWorlds.set(sys.id, d.bodies[d.home]?.name ?? null);
  }
  const [kind, body = ''] = p.biology.split(';').map((s) => s.trim());
  return {
    id,
    name: p.name,
    kind: `${cap(kind)} · ${p.homeWorld.text.replace(',', '')}`,
    body: body ? `${cap(body)}.` : '',
    capital: p.capital.name,
    world: sys ? homeWorlds.get(sys.id) : null,
    system: sys?.name ?? null,
    saying: cap(p.saying),
  };
}

/** A character's row: its people, level, and where it calls home (the summary carries its home system, not where it
 * stands now). */
export function characterView(c, galaxy) {
  const p = getPeople(c.people);
  const sys = galaxy?.systems[c.homeSystem]?.name;
  return { id: c.id, name: c.name, people: c.people, peopleName: p.name, level: c.level, home: sys ? `${p.capital.name}, ${sys} system` : p.capital.name };
}

/** A word in Cartographer signs (art bible §3), as an inline SVG drawn in the current colour: signs on their seven-node
 * lattice, side by side, a dot on each centre, the divider a lone dot. */
export function glyphWord(text, size = 18) {
  const signs = transliterate(text);
  const r = size * 0.46;
  const pitch = size * 1.22;
  const w = Math.max(size, (signs.length - 1) * pitch + size);
  const paths = [];
  const dots = [];
  signs.forEach((sign, i) => {
    const cx = size / 2 + i * pitch;
    const cy = size / 2;
    const at = (n) => {
      const [x, y] = nodePosition(n);
      return `${(cx + x * 2 * r).toFixed(2)} ${(cy - y * 2 * r).toFixed(2)}`;
    };
    for (const s of sign.strokes) {
      const [a, b] = strokeEnds(s);
      paths.push(`M${at(a)}L${at(b)}`);
    }
    dots.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(size * 0.075).toFixed(2)}"/>`);
  });
  return `<svg class="acct-glyphs" viewBox="0 0 ${w.toFixed(2)} ${size}" width="${w.toFixed(1)}" height="${size}" aria-hidden="true"><path d="${paths.join('')}" fill="none" stroke="currentColor" stroke-width="${(size * 0.09).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/><g fill="currentColor">${dots.join('')}</g></svg>`;
}

const PEOPLE_IDS = PEOPLES.map((p) => p.id);
const STEPS = new Set(['closed', 'signin', 'register', 'characters', 'create', 'entering']);

/**
 * The flow, one step at a time: closed (the title's menu), signin, register, characters, create, entering. `deps`:
 * `api` (login, register, listCharacters, createCharacter, devLogin), `store` (load, save, clear, expired: the tab's
 * session), `enter(session, character, onFail)` → the Net it opened (on, close), `entered()` once the first welcome is in,
 * `galaxy`, and `onChange(view, prev)` for each new view. A request answered after the player moved on is dropped.
 */
export class AccountFlow {
  constructor(deps) {
    this.deps = deps;
    this.session = null;
    this.net = null;
    this.epoch = 0;
    this.view = { step: 'closed', busy: false, loading: false, message: null, username: '', characters: [], max: 0, selected: null, draft: { name: '', people: PEOPLE_IDS[0] }, entering: null, connection: null };
  }

  get step() {
    return this.view.step;
  }

  set(patch) {
    const prev = this.view;
    if (patch.step && !STEPS.has(patch.step)) throw new Error(`no step ${patch.step}`);
    if (patch.step && patch.step !== prev.step) this.epoch++;
    this.view = { ...prev, ...patch };
    this.deps.onChange?.(this.view, prev);
  }

  /** Play: the character list when this tab is signed in, else the sign-in. `notice`: why the title was come back to. */
  open(notice = null) {
    if (this.step !== 'closed') return;
    const note = (text) => (text ? { text, field: null, tone: 'notice' } : null);
    const s = this.deps.store.load();
    if (s && this.deps.store.expired(s)) {
      this.deps.store.clear();
      return this.set({ step: 'signin', message: note(notice || SESSION_ENDED), busy: false, username: s.username ?? '' });
    }
    if (!s) return this.set({ step: 'signin', message: note(notice), busy: false });
    this.session = s;
    return this.loadCharacters(note(notice));
  }

  /** Back to the title's menu (a request under way is let go). */
  close() {
    if (this.step === 'entering') return this.cancelEnter();
    this.set({ step: 'closed', busy: false, loading: false, message: null });
  }

  /** Esc: a step back. */
  back() {
    switch (this.step) {
      case 'register':
        return this.set({ step: 'signin', busy: false, message: null });
      case 'create':
        return this.leaveCreate();
      case 'entering':
        return this.cancelEnter();
      case 'signin':
      case 'characters':
        return this.close();
    }
  }

  /** Back from a new character to the list. A character asked for and not yet answered is made or refused as the server
   * decides, its answer to this step dropped: the list is read again once it is in, so a character made shows. */
  leaveCreate() {
    const pending = this.view.busy ? this.creating : null;
    if (!pending) return this.set({ step: 'characters', busy: false, message: null });
    this.set({ step: 'characters', busy: true, loading: true, message: null });
    const epoch = this.epoch;
    const reload = () => epoch === this.epoch && this.loadCharacters();
    pending.then(reload, reload);
  }

  toRegister(username = this.view.username) {
    if (this.step === 'signin') this.set({ step: 'register', busy: false, message: null, username });
  }

  toSignIn(username = this.view.username) {
    if (this.step === 'register') this.set({ step: 'signin', busy: false, message: null, username });
  }

  /** The player changed a field: an error about that field is answered. */
  edited(field) {
    if (this.view.message?.field === field) this.set({ message: null });
  }

  /** Sign in, or make the account (on the register step), then the account's characters. */
  async submitCredentials({ username = '', password = '' }) {
    const step = this.step;
    if ((step !== 'signin' && step !== 'register') || this.view.busy) return;
    const register = step === 'register';
    username = username.trim();
    const problem = credentialsProblem({ username, password }, register);
    if (problem) return this.set({ message: { ...problem, tone: 'error' }, username });
    this.set({ busy: true, message: null, username });
    const epoch = this.epoch;
    let auth;
    try {
      auth = await (register ? this.deps.api.register : this.deps.api.login)({ username, password });
    } catch (e) {
      if (epoch === this.epoch) this.failed(e);
      return;
    }
    if (epoch !== this.epoch) return;
    this.session = { token: auth.token, accountId: auth.accountId, username };
    this.deps.store.save(this.session);
    return this.loadCharacters();
  }

  /** The account's characters from the server (an account with none shows its empty list, a new character offered). */
  async loadCharacters(message = null) {
    this.set({ step: 'characters', loading: true, busy: true, listFailed: false, characters: [], max: 0, selected: null, message, username: this.session.username ?? '' });
    const epoch = this.epoch;
    let list;
    try {
      list = await this.deps.api.listCharacters(this.session.token);
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.failed(e);
      // (the list could not be had: it offers to try again rather than a new character)
      if (this.step === 'characters') this.set({ listFailed: true });
      return;
    }
    if (epoch !== this.epoch) return;
    this.set({ loading: false, busy: false, characters: list.characters, max: list.max, selected: list.characters[0]?.id ?? null });
  }

  /** A refusal on the step it was made from; a session the server no longer takes goes back to the sign-in. */
  failed(err, step = this.step) {
    if (err?.status === 401 && step !== 'signin' && step !== 'register') return this.sessionEnded();
    this.set({ busy: false, loading: false, message: { ...refusalOf(err, step), tone: 'error' } });
  }

  sessionEnded(text = SESSION_ENDED) {
    this.deps.store.clear();
    const username = this.session?.username ?? '';
    this.session = null;
    this.set({ step: 'signin', busy: false, loading: false, characters: [], selected: null, message: { text, field: null, tone: 'notice' }, username });
  }

  signOut() {
    if (this.step !== 'characters') return;
    this.deps.store.clear();
    this.session = null;
    this.set({ step: 'signin', busy: false, loading: false, characters: [], max: 0, selected: null, message: null, username: '' });
  }

  select(id) {
    if (this.step === 'characters' && this.view.characters.some((c) => c.id === id)) this.set({ selected: id });
  }

  get full() {
    return this.view.max > 0 && this.view.characters.length >= this.view.max;
  }

  /** The list again, after it could not be loaded. */
  retry() {
    if (this.step === 'characters' && this.view.listFailed && !this.view.busy) this.loadCharacters();
  }

  newCharacter(message = null) {
    if (this.step !== 'characters' || this.view.busy || this.view.listFailed) return;
    if (this.full) return this.set({ message: { text: `An account holds at most ${this.view.max} characters.`, field: null, tone: 'error' } });
    this.set({ step: 'create', busy: false, message, draft: { name: '', people: PEOPLE_IDS[0] } });
  }

  setPeople(people) {
    if (this.step === 'create' && PEOPLE_IDS.includes(people)) this.set({ draft: { ...this.view.draft, people } });
  }

  /** Makes the character; the list then shows it, picked. */
  async create({ name, people }) {
    if (this.step !== 'create' || this.view.busy) return;
    name = normalName(name);
    people = PEOPLE_IDS.includes(people) ? people : this.view.draft.people;
    this.set({ draft: { name, people } });
    const problem = nameProblem(name);
    if (problem) return this.set({ message: { ...problem, tone: 'error' } });
    this.set({ busy: true, message: null });
    const epoch = this.epoch;
    const request = (this.creating = this.deps.api.createCharacter(this.session.token, { name, people, look: DEFAULT_LOOK }));
    let c;
    try {
      c = await request;
    } catch (e) {
      if (epoch === this.epoch) this.failed(e);
      return;
    } finally {
      if (this.creating === request) this.creating = null;
    }
    if (epoch !== this.epoch) return;
    this.set({ step: 'characters', busy: false, message: null, characters: [...this.view.characters, c], selected: c.id, draft: { name: '', people: PEOPLE_IDS[0] } });
  }

  /** Enters the world as the picked character (or `id`). */
  enter(id = this.view.selected) {
    if (this.step !== 'characters' || this.view.busy) return;
    const c = this.view.characters.find((x) => x.id === id);
    if (c) this.startEntering(c);
  }

  startEntering(c) {
    this.set({ step: 'entering', busy: false, message: null, selected: c.id, entering: c, connection: 'connecting', arriving: false });
    let net = null;
    // (the connection's end before a welcome: a refusal, a server that cannot be reached, or Esc)
    net = this.net = this.deps.enter(this.session, c, (reason, code) => this.enterFailed(net, reason, code));
    net?.on?.('state', (state) => this.net === net && this.step === 'entering' && this.set({ connection: state }));
    net?.on?.('welcome', (_m, first) => first && this.net === net && this.entered());
  }

  enterFailed(net, reason, code) {
    if (this.net !== net) return;
    this.net = null;
    this.settle(false);
    if (this.step !== 'entering') return;
    if (code === 'auth') return this.sessionEnded(reason || SESSION_ENDED);
    this.set({ step: 'characters', connection: null, message: { text: reason || 'The connection to the server closed.', field: null, tone: 'error' } });
  }

  /** The welcome is in and held while the screen goes dark: the character is on its way into the world, past
   * cancelling (Esc no longer lets the socket go, the game takes the held welcome as soon as it is dark). */
  arriving() {
    if (this.step === 'entering') this.set({ arriving: true, connection: 'joined' });
  }

  /** Esc while entering: the connection is let go, back to the list. */
  cancelEnter() {
    if (this.step !== 'entering' || this.view.arriving) return;
    const net = this.net;
    this.net = null;
    this.settle(false);
    this.set({ step: this.view.characters.length ? 'characters' : 'signin', connection: null, message: null });
    net?.close?.();
  }

  entered() {
    this.net = null;
    this.set({ step: 'closed', connection: 'joined', arriving: false, message: null });
    this.deps.entered?.();
    this.settle(true);
  }

  settle(ok) {
    const done = this.pending;
    this.pending = null;
    done?.(ok);
  }

  /**
   * Dev builds: signs in through the server's dev login as `dev-<name>` (a character of `people`, made on first use) and
   * enters at once, as the dev scenarios do online (ARCHITECTURE §16). Resolves true once in the world; false when it
   * could not get in (the sign-in then says why).
   */
  devLogin({ name, people } = {}) {
    // (compiled out of production builds, as the server's route is absent there)
    if (!import.meta.env.DEV || this.step === 'entering') return Promise.resolve(false);
    this.settle(false);
    const promise = new Promise((resolve) => (this.pending = resolve));
    this.set({ step: 'entering', busy: false, message: null, entering: null, username: `dev-${name}`, connection: 'signing-in' });
    const epoch = this.epoch;
    this.deps.api.devLogin(people ? { name, people } : { name }).then(
      (r) => {
        if (epoch !== this.epoch) return;
        this.session = { token: r.token, accountId: r.accountId, username: `dev-${String(name).toLowerCase()}` };
        this.deps.store.save(this.session);
        this.set({ characters: [r.character], max: 0, selected: r.character.id });
        this.startEntering(r.character);
      },
      (e) => {
        if (epoch !== this.epoch) return;
        this.settle(false);
        const text = e?.status === 404 ? 'The server’s dev login is off: start it with ASTRA_DEV_LOGIN=1.' : refusalOf(e, 'signin').text;
        this.set({ step: 'signin', message: { text, field: null, tone: 'error' }, username: '' });
      },
    );
    return promise;
  }
}

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

function esc(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Holds a Net's first welcome, and everything the server says after it, until `arrive()` settles: the game places the
 * character once the screen has gone dark, then takes what came meanwhile in the order it came, as if it had all come
 * that much later. A later welcome (a reconnect) passes straight through.
 */
export function holdFirstWelcome(net, arrive, report = rethrowLater) {
  const emit = net.emit;
  let held = null;
  const release = () => {
    const queue = held;
    held = null;
    net.emit = emit;
    // (a listener that throws is reported, as it would have been had its message come straight from the socket, and
    // the rest of the queue still goes)
    for (const [type, args] of queue) {
      try {
        emit.call(net, type, ...args);
      } catch (err) {
        report(err);
      }
    }
  };
  net.emit = function (type, ...args) {
    if (held) return void held.push([type, args]);
    if (type !== 'welcome' || args[1] !== true) return emit.call(this, type, ...args);
    held = [[type, args]];
    Promise.resolve()
      .then(arrive)
      .then(release, release);
  };
}

/** An error raised again on its own task, so it shows as uncaught without stopping what threw it. */
function rethrowLater(err) {
  setTimeout(() => {
    throw err;
  });
}

/** A line of text changed in place: the old words fade out where they stand as the new ones fade in over them. */
function crossFade(box, text) {
  const now = box.lastElementChild;
  if (now?.textContent === text && !now.classList.contains('gone')) return;
  for (const old of box.children) {
    if (old.classList.contains('gone')) continue;
    old.classList.add('gone');
    old.addEventListener('animationend', () => old.remove(), { once: true });
    setTimeout(() => old.remove(), 4000);
  }
  const line = document.createElement('span');
  line.textContent = text;
  // (the first words the line shows just appear with their step)
  if (now) line.className = 'fresh';
  box.appendChild(line);
}

function clearPasswords(root) {
  for (const i of root.querySelectorAll('input[type="password"]')) i.value = '';
}

const keyHints = (pairs) => pairs.map(([k, what]) => `<span>${k.map((x) => `<kbd>${x}</kbd>`).join('')}${what}</span>`).join('');
const keys = (...pairs) => `<footer class="acct-keys">${keyHints(pairs)}</footer>`;
const LIST_KEYS = [
  [['↑', '↓'], 'Pick'],
  [['Enter'], 'Enter the world'],
  [['N'], 'New'],
  [['Esc'], 'Back'],
];
// (an account with no characters yet: the new character has the focus)
const EMPTY_LIST_KEYS = [
  [['Enter'], 'New character'],
  [['Esc'], 'Back'],
];
/** What a primary action says while the server has it. */
const pending = (text) => `<span class="acct-pending mono" aria-live="polite"><i class="acct-bar"><b></b></i>${text}</span>`;
const msgBox = '<div class="acct-msgwrap"><p class="acct-msg" role="alert"><span></span></p></div>';
const RAIL = { signin: 1, register: 1, characters: 2, create: 2, entering: 3 };

/** The flow drawn into the title screen. `menus` is the game's Menus, whose title it shares. */
export class Account {
  constructor(menus) {
    this.menus = menus;
    this.game = menus.game;
    this.title = menus.title;
    el('div', 'acct-scrim', this.title);
    this.root = el('section', 'acct', this.title);
    this.root.setAttribute('aria-label', 'Sign in and characters');
    // (it holds the focus itself while a step has no field: entering, so Esc reaches it)
    this.root.tabIndex = -1;
    this.root.innerHTML = `<header class="acct-head">
        <div class="acct-mark"><b>Next</b> Horizon</div>
        <ol class="acct-rail"><li data-n="1"><i>01</i>Sign in</li><li data-n="2"><i>02</i>Character</li><li data-n="3"><i>03</i>Enter</li></ol>
      </header>
      <div class="acct-body"></div>`;
    this.body = this.root.querySelector('.acct-body');
    this.flow = new AccountFlow({
      api,
      store: { load: loadSession, save: saveSession, clear: clearSession, expired: (s) => sessionExpired(s) },
      enter: (session, character, onFail) => {
        this.game.enterWorld(session, character, onFail);
        const net = this.game.net;
        // the welcome waits until the screen has gone dark, so the title's shot never cuts to the world
        if (net)
          holdFirstWelcome(net, () => {
            this.flow.arriving();
            return this.darken();
          });
        return net;
      },
      entered: () => this.reveal(),
      galaxy: this.game.galaxy,
      onChange: (v, prev) => this.render(v, prev),
    });
    this.bind();
  }

  get open() {
    return this.flow.step !== 'closed';
  }

  /** Play. */
  show(notice = null) {
    this.title.querySelectorAll('.sheet.open, .t-item.open').forEach((e) => e.classList.remove('open'));
    this.flow.open(notice);
  }

  devLogin(request) {
    return this.flow.devLogin(request);
  }

  /** The welcome is in: Enter is marked done, then the menu and the title's shot fade to black over the whole page (a
   * veil above every screen). Resolves once dark, when the game places the character (holdFirstWelcome). */
  darken() {
    const veil = this.veilEl();
    veil.className = 'acct-veil dark';
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', hidden);
        resolve();
      };
      // (the fade runs on the page's animation clock, which a hidden tab stops: there, nobody is looking, it goes on
      // at once; and in any case after a while)
      const hidden = () => document.hidden && finish();
      const timer = setTimeout(finish, 10_000);
      document.addEventListener('visibilitychange', hidden);
      hidden();
      veil.addEventListener('animationend', (e) => e.target === veil && finish(), { once: true });
    });
  }

  /** In the world, placed: the veil lifts off the character's place. */
  reveal() {
    const veil = this.veilEl();
    veil.className = 'acct-veil up';
    veil.addEventListener('animationend', () => veil.classList.remove('up'), { once: true });
  }

  veilEl() {
    return (this.veil ||= el('div', 'acct-veil', this.menus.root));
  }

  // ---------- drawing ----------

  render(v, prev) {
    const changed = v.step !== prev.step;
    this.title.classList.toggle('flow', v.step !== 'closed');
    if (v.step === 'closed') {
      clearPasswords(this.body);
      if (changed && prev.step !== 'entering') this.menus.startBtn?.focus({ preventScroll: true });
      return;
    }
    // (all three ticked once the welcome is in)
    const n = v.arriving ? 4 : RAIL[v.step];
    this.root.querySelectorAll('.acct-rail li').forEach((li) => {
      li.classList.toggle('on', Number(li.dataset.n) === n);
      li.classList.toggle('done', Number(li.dataset.n) < n);
    });
    if (changed) this.build(v, prev);
    this.sync(v, prev, changed);
    if (changed) this.game.audio?.play('ui');
  }

  /** A new step: the old one fades out where it stood (at its own height, never clipped), then the new one's rows rise
   * in, one after another. */
  build(v, prev) {
    // (opened again from the title, the column itself fades in: what it last showed just goes)
    if (prev.step === 'closed') {
      this.body.replaceChildren();
      this.holdHeight();
    }
    const old = this.body.querySelector('.acct-step:not(.leaving)');
    if (old) {
      // a password never outlives its step in the page
      clearPasswords(old);
      old.classList.add('leaving');
      this.holdHeight();
      const drop = () => {
        if (!old.isConnected) return;
        old.remove();
        this.holdHeight();
      };
      old.addEventListener('animationend', (e) => e.target === old && drop());
      // (and in any case a little later: its animation never ends while the title is hidden)
      setTimeout(drop, 4000);
    }
    const step = el('div', 'acct-step', null, this.stepHTML(v));
    step.dataset.step = v.step;
    this.body.appendChild(step);
    // rows rise in one after another, a form's own rows among them
    step.querySelectorAll(':scope > :not(form), :scope > form > *').forEach((c, i) => c.style.setProperty('--i', i));
    step.querySelectorAll('.acct-peoples > .acct-people').forEach((c, i) => c.style.setProperty('--j', i));
    // (the username typed carries across sign-in and sign-up; the flow keeps it)
    const username = step.querySelector('input[name="username"]');
    if (username) username.value = v.username || '';
    this.focusFirst(step, v);
  }

  /** The column keeps the height of a step fading out until it has gone, so nothing is cut off mid-fade (the column
   * draws nothing of its own: the release shows nowhere). */
  holdHeight() {
    const leaving = [...this.body.querySelectorAll(':scope > .acct-step.leaving')];
    this.body.style.minHeight = leaving.length ? `${Math.max(...leaving.map((s) => s.offsetHeight))}px` : '';
  }

  focusFirst(step, v) {
    let target;
    if (v.step === 'signin' || v.step === 'register') {
      const u = step.querySelector('input[name="username"]');
      target = u.value ? step.querySelector('input[name="password"]') : u;
    } else if (v.step === 'create') target = step.querySelector('input[name="name"]');
    // (the list then focuses its picked row once it is drawn, in sync; until then the column holds the keys)
    else target = this.root;
    target.focus({ preventScroll: true });
  }

  stepHTML(v) {
    switch (v.step) {
      case 'signin':
      case 'register':
        return this.credentialsHTML(v.step === 'register');
      case 'characters':
        return `<div class="acct-titlerow"><h2 class="acct-title">Characters</h2><span class="acct-count mono"></span></div>
          <p class="acct-lede">Signed in as <b>${esc(v.username)}</b></p>
          <div class="acct-list" role="listbox" aria-label="Characters"></div>
          ${msgBox}
          <div class="acct-actions"><button type="button" class="btn" data-do="enter">Enter the world<em>→</em></button><button type="button" class="btn ghost" data-do="signout">Sign out</button></div>
          ${keys(...LIST_KEYS)}`;
      case 'create':
        return this.createHTML(v);
      case 'entering':
        return `<h2 class="acct-title">Entering</h2>
          <div class="acct-entering"></div>
          <div class="acct-progress"><div class="acct-bar"><b></b><i></i></div><span class="acct-conn mono" data-connection></span></div>
          ${keys([['Esc'], 'Cancel'])}`;
    }
    return '';
  }

  credentialsHTML(register) {
    const hint = (t) => (register ? `<span class="acct-hint mono">${t}</span>` : '');
    return `<h2 class="acct-title">${register ? 'Create account' : 'Sign in'}</h2>
      <p class="acct-lede">${register ? 'One account holds all your characters. Everything they carry is kept on the server.' : 'Your characters, and everything they carry, are kept on the server.'}</p>
      <form class="acct-form" data-form="${register ? 'register' : 'signin'}" novalidate>
        <label class="acct-field" data-field="username"><span class="acct-label mono">Username</span>${hint('3–24 letters, digits, - or _')}
          <input name="username" autocomplete="username" maxlength="24" spellcheck="false" autocapitalize="off"><i class="acct-line"></i></label>
        <label class="acct-field" data-field="password"><span class="acct-label mono">Password</span>${hint('8–128 characters')}
          <input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" maxlength="128"><i class="acct-line"></i></label>
        ${msgBox}
        <div class="acct-actions">
          <button type="submit" class="btn" data-do="${register ? 'register' : 'signin'}">${register ? 'Create account' : 'Sign in'}<em>→</em></button>
          <button type="button" class="acct-link" data-do="${register ? 'to-signin' : 'to-register'}">${register ? 'I have an account' : 'Create an account'}</button>
          ${pending(register ? 'Creating the account' : 'Signing in')}
        </div>
      </form>
      ${keys([['Enter'], register ? 'Create account' : 'Sign in'], [['Tab'], 'Next field'], [['Esc'], 'Back'])}`;
  }

  createHTML(v) {
    const cards = PEOPLE_IDS.map((id) => {
      const p = peopleInfo(id, this.game.galaxy);
      const where = [p.world && `${p.world}, ${p.system} system`, `capital ${p.capital}`].filter(Boolean).join(' · ');
      return `<label class="acct-people ppl-${id}" data-v="${id}">
          <input type="radio" name="people" value="${id}"${id === v.draft.people ? ' checked' : ''}>
          <i class="acct-emblem"></i><span class="acct-people-name">${esc(p.name)}</span><span class="acct-people-tag mono">${esc(p.capital)}</span>
          <span class="acct-people-sub">${esc(p.kind)}</span>
          <span class="acct-people-more"><span class="acct-people-inner">
            <span class="acct-people-body">${esc(p.body)}</span>
            <span class="acct-people-home mono">${esc(where)}</span>
            <span class="acct-saying">${glyphWord(p.name)}<q>${esc(p.saying)}</q></span>
          </span></span>
        </label>`;
    }).join('');
    return `<h2 class="acct-title">New character</h2>
      <p class="acct-lede">A people sets your home world and the system you start in. None is stronger than another.</p>
      <form class="acct-form" data-form="create" novalidate>
        <label class="acct-field" data-field="name"><span class="acct-label mono">Name</span><span class="acct-hint mono">2–20 letters</span>
          <input name="name" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(v.draft.name)}"><i class="acct-line"></i></label>
        <fieldset class="acct-peoples" data-people><legend class="acct-label mono">People</legend>${cards}</fieldset>
        ${msgBox}
        <div class="acct-actions">
          <button type="submit" class="btn" data-do="create">Create character<em>→</em></button>
          <button type="button" class="btn ghost" data-do="back">Back</button>
          ${pending('Making the character')}
        </div>
      </form>
      ${keys([['Enter'], 'Create'], [['↑', '↓'], 'People'], [['Esc'], 'Back'])}`;
  }

  /** A character's row: a button in the list, or (`still`) the one being entered. */
  rowHTML(c, selected, still = false) {
    const r = characterView(c, this.game.galaxy);
    const inner = `<i class="acct-emblem"></i><span class="acct-char-name">${esc(r.name)}</span><span class="acct-char-lv mono">Lv ${r.level}</span>
        <span class="acct-char-sub">${esc(r.peopleName)} · Home ${esc(r.home)}</span>`;
    if (still) return `<div class="acct-char static ppl-${r.people}">${inner}</div>`;
    return `<button type="button" class="acct-char ppl-${r.people}" role="option" data-id="${esc(r.id)}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${inner}</button>`;
  }

  /** What changes within a step: the list, the picked row and people, the message, busy, the connection. */
  sync(v, prev, built) {
    const step = this.body.querySelector('.acct-step:not(.leaving)');
    if (!step) return;
    if (v.step === 'characters') this.syncList(step, v, prev, built);
    if (v.step === 'create') {
      step.querySelectorAll('.acct-people').forEach((l) => {
        const on = l.dataset.v === v.draft.people;
        l.classList.toggle('on', on);
        const r = l.querySelector('input');
        if (r.checked !== on) r.checked = on;
      });
    }
    if (v.step === 'entering') {
      const c = v.entering;
      const box = step.querySelector('.acct-entering');
      const key = c ? c.id : `dev:${v.username}`;
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = c ? this.rowHTML(c, true, true) : `<div class="acct-char static"><i class="acct-emblem dev"></i><span class="acct-char-name">${esc(v.username)}</span><span class="acct-char-sub">Dev login</span></div>`;
      }
      const text = v.connection === 'joined' ? CONNECTION_TEXT.joined : `${CONNECTION_TEXT[v.connection] ?? CONNECTION_TEXT.connecting}…`;
      crossFade(step.querySelector('[data-connection]'), text);
      // once the welcome is in: the bar fills as the screen goes dark, and Esc no longer cancels
      step.classList.toggle('arriving', !!v.arriving);
    }
    // busy: the primary action waits, a sweep along its foot and a line beside it saying what it waits for
    const primary = step.querySelector('.acct-actions .btn:not(.ghost)');
    if (primary) {
      primary.classList.toggle('busy', v.busy);
      primary.disabled = v.busy || (v.step === 'characters' && !v.selected);
    }
    step.querySelector('.acct-actions')?.classList.toggle('busy', v.busy);
    this.syncMessage(step, v, prev, built);
  }

  syncList(step, v, prev, built) {
    const list = step.querySelector('.acct-list');
    const key = `${v.loading}|${v.listFailed}|${v.characters.map((c) => c.id).join(',')}|${v.max}`;
    const redraw = list.dataset.key !== key;
    if (redraw) {
      list.dataset.key = key;
      // (redrawn in place, as the list comes in: it eases to its new height, so what is below it never jumps)
      const from = built ? null : list.offsetHeight;
      const rows = v.characters.map((c) => this.rowHTML(c, c.id === v.selected));
      const slots = v.max ? `${v.characters.length} of ${v.max} slots` : '';
      if (v.loading) list.innerHTML = '<div class="acct-loading"><div class="acct-bar"><b></b></div><span class="mono">Loading characters…</span></div>';
      else if (v.listFailed)
        list.innerHTML = `<button type="button" class="acct-char acct-new" data-do="retry"><i class="acct-plus" data-mark="↻"></i><span class="acct-char-name">Try again</span><span class="acct-char-sub">Load this account’s characters</span></button>`;
      else
        list.innerHTML =
          rows.join('') +
          `<button type="button" class="acct-char acct-new" data-do="new" tabindex="${v.characters.length ? -1 : 0}"${this.flow.full ? ' disabled' : ''}><i class="acct-plus"></i><span class="acct-char-name">New character</span><span class="acct-char-sub">${v.characters.length ? slots : 'No characters yet: make your first'}</span></button>`;
      list.querySelectorAll(':scope > *').forEach((c, i) => c.style.setProperty('--j', i));
      list.classList.toggle('fresh', !built);
      step.querySelector('.acct-count').textContent = v.max ? `${v.characters.length} / ${v.max}` : '';
      const empty = !v.loading && !v.listFailed && !v.characters.length;
      step.querySelector('.acct-keys').innerHTML = keyHints(empty ? EMPTY_LIST_KEYS : LIST_KEYS);
      const to = list.offsetHeight;
      if (from !== null && from !== to) {
        list.animate([{ height: `${from}px`, overflowY: 'clip' }, { height: `${to}px`, overflowY: 'clip' }], { duration: 380, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
      }
    }
    let picked = null;
    list.querySelectorAll('.acct-char[data-id]').forEach((b) => {
      const on = b.dataset.id === v.selected;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) picked = b;
    });
    // the picked row takes the focus when the list is drawn, or when the keys moved it there
    const within = this.root.contains(document.activeElement) && document.activeElement !== this.root;
    if (picked && (redraw || (v.selected !== prev.selected && within && document.activeElement?.closest('.acct-list')))) picked.focus({ preventScroll: false });
    else if (redraw && !picked && !v.loading) list.querySelector('.acct-new')?.focus({ preventScroll: true });
  }

  syncMessage(step, v, prev, built) {
    const wrap = step.querySelector('.acct-msgwrap');
    if (!wrap) return;
    const m = v.message;
    const p = built ? null : prev.message;
    if (m !== p) {
      const box = wrap.querySelector('.acct-msg');
      const from = built ? null : wrap.offsetHeight;
      if (m) {
        const line = box.firstElementChild;
        line.textContent = m.text;
        box.className = `acct-msg ${m.tone === 'notice' ? 'notice' : 'error'}`;
        // (restarted, so a refusal said again is seen to come again)
        line.style.animation = 'none';
        void line.offsetWidth;
        line.style.animation = '';
      }
      wrap.classList.toggle('on', !!m);
      // the room it takes eases open or shut, and the box with it, on one curve (anchored to its foot, the box shrinks
      // as the room does, gone just as what is below has settled; opening, it also fades in, its own animation)
      const to = wrap.offsetHeight;
      if (from !== null && from !== to) wrap.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 340, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
      if (m?.tone === 'error' && !built) this.game.audio?.play('error');
    }
    step.querySelectorAll('.acct-field').forEach((f) => f.classList.toggle('bad', !!m && m.tone === 'error' && m.field === f.dataset.field));
    // an error about a field puts the cursor there, its text selected to retype
    if (m && m !== p && m.field) {
      const input = step.querySelector(`.acct-field[data-field="${m.field}"] input`);
      if (input) {
        input.focus({ preventScroll: true });
        input.select?.();
      }
    }
  }

  // ---------- input ----------

  bind() {
    const root = this.root;
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const val = (n) => f.querySelector(`[name="${n}"]`)?.value ?? '';
      if (f.dataset.form === 'signin' || f.dataset.form === 'register') {
        this.flow.submitCredentials({ username: val('username'), password: val('password') });
        // (once on its way, the password leaves the page; one the client refused stays to be put right)
        if (this.flow.view.busy) clearPasswords(f);
      } else if (f.dataset.form === 'create') this.flow.create({ name: val('name'), people: f.querySelector('input[name="people"]:checked')?.value });
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || b.type === 'submit') return;
      const act = b.dataset.do;
      if (act === 'to-register') this.flow.toRegister(this.body.querySelector('input[name="username"]')?.value.trim());
      else if (act === 'to-signin') this.flow.toSignIn(this.body.querySelector('input[name="username"]')?.value.trim());
      else if (act === 'enter') this.flow.enter();
      else if (act === 'new') this.flow.newCharacter();
      else if (act === 'retry') this.flow.retry();
      else if (act === 'signout') this.flow.signOut();
      else if (act === 'back') this.flow.back();
      else if (b.dataset.id) this.flow.select(b.dataset.id);
    });
    root.addEventListener('dblclick', (e) => {
      const b = e.target.closest('.acct-char[data-id]');
      if (b) this.flow.enter(b.dataset.id);
    });
    root.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.acct-char:not(.static), .acct-people');
      if (b && b !== this.hovered && !b.disabled) this.game.audio?.play('hover');
      this.hovered = b;
    });
    root.addEventListener('change', (e) => {
      if (e.target.name === 'people') {
        this.flow.setPeople(e.target.value);
        this.game.audio?.play('ui');
      }
    });
    root.addEventListener('input', (e) => {
      const f = e.target.closest('.acct-field');
      if (f) this.flow.edited(f.dataset.field);
    });
    // the keys stay in the flow: the game's own (which take Tab, Space and the arrows) never see them
    root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      this.key(e);
    });
    // Esc with the focus outside the flow (a click on the backdrop)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open && this.title.classList.contains('show') && !root.contains(e.target)) this.flow.back();
    });
  }

  key(e) {
    const step = this.flow.step;
    const typing = e.target.tagName === 'INPUT' && e.target.type !== 'radio';
    if (e.key === 'Escape') {
      e.preventDefault();
      this.flow.back();
    } else if (step === 'characters' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const rows = [...this.body.querySelectorAll('.acct-step:not(.leaving) .acct-list > .acct-char:not(:disabled)')];
      const i = rows.indexOf(document.activeElement);
      // (from outside the list, the arrows first go to the picked row)
      const picked = Math.max(0, rows.findIndex((r) => r.dataset.id === this.flow.view.selected));
      const next = rows[i < 0 ? picked : Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next?.dataset.id) this.flow.select(next.dataset.id);
      next?.focus();
    } else if (step === 'characters' && e.key === 'Enter' && e.target.closest?.('.acct-char[data-id]')) {
      e.preventDefault();
      this.flow.enter(e.target.closest('.acct-char').dataset.id);
    } else if (step === 'characters' && !typing && e.code === 'KeyN' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      this.flow.newCharacter();
    } else if (step === 'create' && e.key === 'Enter' && e.target.type === 'radio') {
      e.preventDefault();
      e.target.form?.requestSubmit();
    } else if (step === 'create' && typing && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // from the name field the arrows still pick the people
      e.preventDefault();
      const ids = PEOPLE_IDS;
      const i = ids.indexOf(this.flow.view.draft.people);
      this.flow.setPeople(ids[(i + (e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length]);
    }
  }
}
