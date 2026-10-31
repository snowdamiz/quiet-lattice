// The sign-in and character flow without a DOM (P1.E04.T05): what each step shows, the server's refusals on the field
// they are about, a session the server no longer takes, answers that come after the player moved on, entering and its
// failures, and the dev login the online dev scenarios use.
import { describe, expect, it, vi } from 'vitest';
import { GALAXY_SEED, Galaxy } from '@astra/shared/world';
import { SIGNS } from '@astra/shared/art';
import { AccountFlow, characterView, credentialsProblem, glyphWord, holdFirstWelcome, nameProblem, normalName, peopleInfo, refusalOf, SESSION_ENDED } from './Account.js';

const LOOK = { palette: 0, pattern: 0, head: 0, suit: 0 };
const TESS = { id: 'c1', name: 'Tess Arlo', people: 'thalune', look: LOOK, level: 7, homeSystem: 0 };
const QUILL = { id: 'c2', name: 'Quill Ventrasse', people: 'ixari', look: LOOK, level: 3, homeSystem: 59 };
const AUTH = { token: 'tok', accountId: 'a1' };

/** A refusal as api.js throws it. */
const refused = (status, code, message, retryAfter = null) => Object.assign(new Error(message), { status, code, retryAfter });

/** A promise settled from outside. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/** A Net as the flow sees it: listeners, and close(). */
function fakeNet() {
  const handlers = {};
  return {
    on: (t, fn) => (handlers[t] ||= []).push(fn),
    emit: (t, ...a) => (handlers[t] || []).forEach((fn) => fn(...a)),
    close: vi.fn(),
  };
}

function setup({ session = null, expired = false, api = {} } = {}) {
  const store = { session, load: () => store.session, save: vi.fn((s) => (store.session = s)), clear: vi.fn(() => (store.session = null)), expired: () => expired };
  const nets = [];
  const enter = vi.fn((s, c, onFail) => {
    const net = fakeNet();
    net.onFail = onFail;
    nets.push(net);
    return net;
  });
  const entered = vi.fn();
  const views = [];
  const flow = new AccountFlow({
    api: {
      login: vi.fn(async () => AUTH),
      register: vi.fn(async () => AUTH),
      listCharacters: vi.fn(async () => ({ characters: [TESS, QUILL], max: 6 })),
      createCharacter: vi.fn(async (_t, c) => ({ id: 'c9', ...c, level: 1, homeSystem: 59 })),
      devLogin: vi.fn(async () => ({ ...AUTH, character: TESS })),
      ...api,
    },
    store,
    enter,
    entered,
    onChange: (v) => views.push(v),
  });
  return { flow, store, enter, entered, nets, views };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the flow', () => {
  it('signs in, then lists the characters with the first picked', async () => {
    const { flow, store } = setup();
    flow.open();
    expect(flow.view).toMatchObject({ step: 'signin', message: null });
    await flow.submitCredentials({ username: ' tess_arlo ', password: 'correct-horse' });
    expect(flow.deps.api.login).toHaveBeenCalledWith({ username: 'tess_arlo', password: 'correct-horse' });
    expect(store.save).toHaveBeenCalledWith({ token: 'tok', accountId: 'a1', username: 'tess_arlo' });
    expect(flow.view).toMatchObject({ step: 'characters', loading: false, busy: false, max: 6, selected: 'c1' });
    expect(flow.view.characters.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it("shows the server's refusal of a sign-in on the field it is about, and a rate limit's wait", async () => {
    const { flow } = setup({ api: { login: vi.fn(async () => Promise.reject(refused(401, 'login_failed', 'Wrong username or password.'))) } });
    flow.open();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'wrong-one' });
    expect(flow.view).toMatchObject({ step: 'signin', busy: false, username: 'tess_arlo', message: { text: 'Wrong username or password.', field: 'password', tone: 'error' } });
    flow.edited('username');
    expect(flow.view.message).not.toBeNull();
    flow.edited('password');
    expect(flow.view.message).toBeNull();
    flow.deps.api.login = vi.fn(async () => Promise.reject(refused(429, 'rate_limited', 'Too many attempts. Try again in a moment.', 12)));
    await flow.submitCredentials({ username: 'tess_arlo', password: 'wrong-one' });
    expect(flow.view.message).toMatchObject({ text: 'Too many attempts. Try again in 12 s.', field: null });
  });

  it('checks a sign-up before sending it, and shows what the server refuses of it', async () => {
    const { flow } = setup({ api: { register: vi.fn(async () => Promise.reject(refused(409, 'username_taken', 'That username is taken.'))) } });
    flow.open();
    flow.toRegister('x');
    expect(flow.view).toMatchObject({ step: 'register', username: 'x' });
    await flow.submitCredentials({ username: 'x', password: 'long enough' });
    expect(flow.view.message).toMatchObject({ field: 'username', text: 'Usernames are 3–24 letters, digits, - or _.' });
    expect(flow.deps.api.register).not.toHaveBeenCalled();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'short' });
    expect(flow.view.message).toMatchObject({ field: 'password' });
    await flow.submitCredentials({ username: 'tess_arlo', password: 'long enough' });
    expect(flow.view.message).toMatchObject({ field: 'username', text: 'That username is taken.', tone: 'error' });
    flow.back();
    expect(flow.view).toMatchObject({ step: 'signin', message: null });
  });

  it('a new account lands on its empty list, a new character offered', async () => {
    const { flow } = setup({ api: { listCharacters: vi.fn(async () => ({ characters: [], max: 6 })) } });
    flow.open();
    flow.toRegister();
    await flow.submitCredentials({ username: 'new_pilot', password: 'long enough' });
    expect(flow.view).toMatchObject({ step: 'characters', loading: false, characters: [], max: 6, selected: null });
    flow.enter();
    expect(flow.step).toBe('characters');
    flow.newCharacter();
    expect(flow.view).toMatchObject({ step: 'create', draft: { name: '', people: 'thalune' } });
    // Esc: the (empty) list, then the title
    flow.back();
    expect(flow.view).toMatchObject({ step: 'characters', characters: [] });
    flow.back();
    expect(flow.view.step).toBe('closed');
  });

  it('a second sign-in or create while the first is with the server is ignored', async () => {
    const login = deferred();
    const { flow } = setup({ api: { login: vi.fn(() => login.promise) } });
    flow.open();
    const first = flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    await flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    expect(flow.deps.api.login).toHaveBeenCalledTimes(1);
    login.resolve(AUTH);
    await first;
    expect(flow.view.step).toBe('characters');

    const made = deferred();
    flow.deps.api.createCharacter = vi.fn(() => made.promise);
    flow.newCharacter();
    const creating = flow.create({ name: 'Ilya Sarn', people: 'ixari' });
    await flow.create({ name: 'Ilya Sarn', people: 'ixari' });
    expect(flow.deps.api.createCharacter).toHaveBeenCalledTimes(1);
    made.resolve({ ...TESS, id: 'c9', name: 'Ilya Sarn', people: 'ixari' });
    await creating;
    expect(flow.view.characters.map((c) => c.id)).toEqual(['c1', 'c2', 'c9']);
  });

  it('drops a refused sign-in that comes after Esc', async () => {
    const login = deferred();
    const { flow } = setup({ api: { login: vi.fn(() => login.promise) } });
    flow.open();
    const pending = flow.submitCredentials({ username: 'tess_arlo', password: 'wrong-one' });
    flow.back();
    login.reject(refused(401, 'login_failed', 'Wrong username or password.'));
    await pending;
    expect(flow.view).toMatchObject({ step: 'closed', message: null, busy: false });
  });

  it('drops a list, or its failure, that comes after Esc', async () => {
    const list = deferred();
    const session = { token: 'tok', accountId: 'a1', username: 'tess_arlo' };
    const ok = setup({ session, api: { listCharacters: vi.fn(() => list.promise) } });
    const loading = ok.flow.open();
    ok.flow.back();
    list.resolve({ characters: [TESS, QUILL], max: 6 });
    await loading;
    expect(ok.flow.view).toMatchObject({ step: 'closed', characters: [], selected: null });

    const down = deferred();
    const failed = setup({ session, api: { listCharacters: vi.fn(() => down.promise) } });
    const failing = failed.flow.open();
    failed.flow.back();
    down.reject(refused(0, 'network', 'The server cannot be reached. Is it running?'));
    await failing;
    expect(failed.flow.view).toMatchObject({ step: 'closed', message: null });
    expect(failed.flow.view.listFailed).toBeFalsy();
  });

  it('Esc from a character being made: the list is read again once the server has answered, and not after the title', async () => {
    const made = deferred();
    const { flow } = setup();
    flow.open();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    flow.newCharacter();
    flow.deps.api.createCharacter = vi.fn(() => made.promise);
    const creating = flow.create({ name: 'Ilya Sarn', people: 'ixari' });
    flow.back();
    expect(flow.view).toMatchObject({ step: 'characters', loading: true });
    const NEW = { ...TESS, id: 'c9', name: 'Ilya Sarn', people: 'ixari' };
    flow.deps.api.listCharacters = vi.fn(async () => ({ characters: [TESS, QUILL, NEW], max: 6 }));
    made.resolve(NEW);
    await creating;
    await tick();
    // (its answer to the create step was dropped: the list as the server has it now, the first picked)
    expect(flow.deps.api.listCharacters).toHaveBeenCalledTimes(1);
    expect(flow.view).toMatchObject({ step: 'characters', loading: false, selected: 'c1' });
    expect(flow.view.characters.map((c) => c.id)).toEqual(['c1', 'c2', 'c9']);

    // and gone back to the title before the answer: nothing comes of it
    const again = deferred();
    flow.newCharacter();
    flow.deps.api.createCharacter = vi.fn(() => again.promise);
    flow.deps.api.listCharacters = vi.fn(async () => ({ characters: [], max: 6 }));
    const late = flow.create({ name: 'Odo Kell', people: 'ulgani' });
    flow.back();
    flow.back();
    expect(flow.step).toBe('closed');
    again.resolve({ ...TESS, id: 'c10', name: 'Odo Kell', people: 'ulgani' });
    await late;
    await tick();
    expect(flow.view.step).toBe('closed');
    expect(flow.deps.api.listCharacters).not.toHaveBeenCalled();
  });

  it('a tab already signed in opens on its list; an expired or refused session asks to sign in again', async () => {
    const signedIn = setup({ session: { token: 'tok', accountId: 'a1', username: 'tess_arlo' } });
    signedIn.flow.open();
    expect(signedIn.flow.view).toMatchObject({ step: 'characters', loading: true });
    await tick();
    expect(signedIn.flow.view).toMatchObject({ step: 'characters', loading: false, username: 'tess_arlo', selected: 'c1' });

    const expired = setup({ session: { token: 'old', accountId: 'a1', username: 'tess_arlo' }, expired: true });
    expired.flow.open();
    expect(expired.store.clear).toHaveBeenCalled();
    expect(expired.flow.view).toMatchObject({ step: 'signin', username: 'tess_arlo', message: { text: SESSION_ENDED, tone: 'notice' } });
    expect(expired.flow.deps.api.listCharacters).not.toHaveBeenCalled();

    const refusedList = setup({ session: { token: 'tok', accountId: 'a1', username: 'tess_arlo' }, api: { listCharacters: vi.fn(async () => Promise.reject(refused(401, 'unauthorized', 'Sign in first.'))) } });
    refusedList.flow.open();
    await tick();
    expect(refusedList.store.clear).toHaveBeenCalled();
    expect(refusedList.flow.view).toMatchObject({ step: 'signin', message: { text: SESSION_ENDED } });
  });

  it('a list that could not be loaded offers to try again, not a new character', async () => {
    const down = vi.fn(async () => Promise.reject(refused(0, 'network', 'The server cannot be reached. Is it running?')));
    const { flow } = setup({ session: { token: 'tok', accountId: 'a1', username: 'tess_arlo' }, api: { listCharacters: down } });
    flow.open();
    await tick();
    expect(flow.view).toMatchObject({ step: 'characters', loading: false, listFailed: true, message: { text: 'The server cannot be reached. Is it running?' } });
    flow.newCharacter();
    expect(flow.view.step).toBe('characters');
    flow.deps.api.listCharacters = vi.fn(async () => ({ characters: [TESS], max: 6 }));
    flow.retry();
    await tick();
    expect(flow.view).toMatchObject({ step: 'characters', listFailed: false, selected: 'c1', message: null });
  });

  it('the notice the title was come back with is said on the step Play opens', async () => {
    const { flow } = setup();
    flow.open('The server refused this character.');
    expect(flow.view.message).toEqual({ text: 'The server refused this character.', field: null, tone: 'notice' });
  });

  it('drops an answer that comes after the player went back', async () => {
    const login = deferred();
    const { flow, store } = setup({ api: { login: vi.fn(() => login.promise) } });
    flow.open();
    const pending = flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    expect(flow.view.busy).toBe(true);
    flow.back();
    expect(flow.view).toMatchObject({ step: 'closed', busy: false });
    flow.open();
    login.resolve(AUTH);
    await pending;
    expect(store.save).not.toHaveBeenCalled();
    expect(flow.view.step).toBe('signin');
  });

  it("picks only the account's characters", async () => {
    const { flow } = setup();
    flow.open();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    flow.select('c2');
    expect(flow.view.selected).toBe('c2');
    flow.select('nobody');
    expect(flow.view.selected).toBe('c2');
  });

  it('makes a character: the name checked, a refusal on the name, then the list with it picked', async () => {
    const { flow } = setup();
    flow.open();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    flow.newCharacter();
    expect(flow.view.step).toBe('create');
    flow.setPeople('ixari');
    expect(flow.view.draft.people).toBe('ixari');
    await flow.create({ name: '  ', people: 'ixari' });
    expect(flow.view.message).toMatchObject({ text: 'Name your character.', field: 'name' });
    await flow.create({ name: 'R2 D2', people: 'ixari' });
    expect(flow.view.message).toMatchObject({ field: 'name' });
    expect(flow.deps.api.createCharacter).not.toHaveBeenCalled();
    flow.deps.api.createCharacter = vi.fn(async () => Promise.reject(refused(409, 'name_taken', 'That name is taken.')));
    await flow.create({ name: 'Ilya  Sarn', people: 'ixari' });
    expect(flow.view).toMatchObject({ step: 'create', draft: { name: 'Ilya Sarn', people: 'ixari' }, message: { text: 'That name is taken.', field: 'name' } });
    flow.deps.api.createCharacter = vi.fn(async (_t, c) => ({ id: 'c9', ...c, level: 1, homeSystem: 59 }));
    await flow.create({ name: 'Ilya Sarn', people: 'ixari' });
    expect(flow.deps.api.createCharacter).toHaveBeenCalledWith('tok', { name: 'Ilya Sarn', people: 'ixari', look: LOOK });
    expect(flow.view).toMatchObject({ step: 'characters', selected: 'c9', message: null });
    expect(flow.view.characters.map((c) => c.id)).toEqual(['c1', 'c2', 'c9']);
  });

  it('refuses a new character on a full account before asking the server', async () => {
    const { flow } = setup({ api: { listCharacters: vi.fn(async () => ({ characters: [TESS, QUILL], max: 2 })) } });
    flow.open();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    flow.newCharacter();
    expect(flow.view).toMatchObject({ step: 'characters', message: { text: 'An account holds at most 2 characters.' } });
  });

  it('enters through Net: its states shown, the first welcome closing the flow', async () => {
    const { flow, enter, entered, nets } = setup();
    flow.open();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    flow.select('c2');
    flow.enter();
    expect(enter).toHaveBeenCalledWith({ token: 'tok', accountId: 'a1', username: 'tess_arlo' }, QUILL, expect.any(Function));
    expect(flow.view).toMatchObject({ step: 'entering', entering: QUILL, connection: 'connecting' });
    nets[0].emit('state', 'joining');
    expect(flow.view.connection).toBe('joining');
    nets[0].emit('welcome', {}, true);
    expect(flow.view.step).toBe('closed');
    expect(entered).toHaveBeenCalledTimes(1);
  });

  it('a failure to enter goes back to the list with why; a refused session to the sign-in; Esc lets the socket go', async () => {
    const { flow, nets } = setup();
    flow.open();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    flow.enter();
    nets[0].onFail('The server is full. Try again in a moment.', 'full');
    expect(flow.view).toMatchObject({ step: 'characters', message: { text: 'The server is full. Try again in a moment.', tone: 'error' } });

    flow.enter();
    flow.back();
    expect(nets[1].close).toHaveBeenCalled();
    expect(flow.view).toMatchObject({ step: 'characters', message: null });
    // (the close it caused is not taken for a failure)
    nets[1].onFail('The connection to the server closed.', null);
    expect(flow.view.message).toBeNull();

    flow.enter();
    nets[2].onFail('Your session has expired.', 'auth');
    expect(flow.deps.store.clear).toHaveBeenCalled();
    expect(flow.view).toMatchObject({ step: 'signin', message: { text: 'Your session has expired.' } });
  });

  it('once the welcome is in and held, Esc no longer cancels: the socket stays and the world is entered', async () => {
    const { flow, nets, entered } = setup();
    flow.open();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    flow.enter();
    flow.arriving();
    expect(flow.view).toMatchObject({ step: 'entering', arriving: true, connection: 'joined' });
    flow.back();
    flow.close();
    expect(nets[0].close).not.toHaveBeenCalled();
    expect(flow.view.step).toBe('entering');
    nets[0].emit('welcome', {}, true);
    expect(flow.view).toMatchObject({ step: 'closed', arriving: false });
    expect(entered).toHaveBeenCalledTimes(1);
  });

  it('signs out', async () => {
    const { flow, store } = setup();
    flow.open();
    await flow.submitCredentials({ username: 'tess_arlo', password: 'correct-horse' });
    flow.signOut();
    expect(store.clear).toHaveBeenCalled();
    expect(flow.view).toMatchObject({ step: 'signin', username: '', characters: [] });
  });

  it('dev login: signs in as dev-<name> and enters at once, true once welcomed', async () => {
    const { flow, store, enter, nets } = setup();
    const done = flow.devLogin({ name: 'Foot', people: 'ixari' });
    expect(flow.view).toMatchObject({ step: 'entering', connection: 'signing-in', username: 'dev-Foot' });
    expect(flow.deps.api.devLogin).toHaveBeenCalledWith({ name: 'Foot', people: 'ixari' });
    await tick();
    expect(store.save).toHaveBeenCalledWith({ token: 'tok', accountId: 'a1', username: 'dev-foot' });
    expect(enter).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok' }), TESS, expect.any(Function));
    nets[0].emit('welcome', {}, true);
    expect(await done).toBe(true);
  });

  it('dev login: a server without it, or a refusal, says so on the sign-in and resolves false', async () => {
    const off = setup({ api: { devLogin: vi.fn(async () => Promise.reject(refused(404, 'not_found', 'No route for POST /auth/dev.'))) } });
    expect(await off.flow.devLogin({ name: 'foot' })).toBe(false);
    expect(off.flow.view).toMatchObject({ step: 'signin', message: { text: expect.stringContaining('ASTRA_DEV_LOGIN=1'), tone: 'error' } });
    expect(off.flow.deps.api.devLogin).toHaveBeenCalledWith({ name: 'foot' });

    const { flow, nets } = setup();
    const done = flow.devLogin({ name: 'foot' });
    await tick();
    nets[0].onFail('That character is already in the world.', 'character');
    expect(await done).toBe(false);
  });

  it('dev login: an answer that comes after Esc enters nothing', async () => {
    const answer = deferred();
    const { flow, store, enter } = setup({ api: { devLogin: vi.fn(() => answer.promise) } });
    const done = flow.devLogin({ name: 'foot' });
    flow.back();
    expect(await done).toBe(false);
    expect(flow.view.step).toBe('signin');
    answer.resolve({ ...AUTH, character: TESS });
    await tick();
    expect(enter).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(flow.view).toMatchObject({ step: 'signin', characters: [] });

    // and a refusal that comes late says nothing
    const refusedLate = deferred();
    const late = setup({ api: { devLogin: vi.fn(() => refusedLate.promise) } });
    late.flow.devLogin({ name: 'foot' });
    late.flow.back();
    late.flow.back();
    refusedLate.reject(refused(404, 'not_found', 'No route for POST /auth/dev.'));
    await tick();
    expect(late.flow.view).toMatchObject({ step: 'closed', message: null });
  });
});

describe('the welcome held until the screen is dark', () => {
  it('holds the first welcome and what comes after it, then lets them through in order; a later welcome passes', async () => {
    const net = fakeNet();
    const seen = [];
    for (const t of ['welcome', 'world', 'inventory']) net.on(t, (m, first) => seen.push(first === undefined ? t : `${t}:${first}`));
    const dark = deferred();
    const arrive = vi.fn(() => dark.promise);
    holdFirstWelcome(net, arrive);
    net.emit('world', {});
    expect(seen).toEqual(['world']);
    net.emit('welcome', {}, true);
    net.emit('inventory', {}, true);
    net.emit('world', {});
    await tick();
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['world']);
    dark.resolve();
    await tick();
    expect(seen).toEqual(['world', 'welcome:true', 'inventory:true', 'world']);
    net.emit('welcome', {}, false);
    expect(seen.at(-1)).toBe('welcome:false');
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  it('a listener that throws is reported, and the rest of what was held still goes', async () => {
    const net = fakeNet();
    const seen = [];
    const boom = new Error('a listener failed');
    net.on('welcome', () => {
      throw boom;
    });
    net.on('welcome', () => seen.push('welcome'));
    net.on('world', () => seen.push('world'));
    const report = vi.fn();
    holdFirstWelcome(net, async () => {}, report);
    net.emit('welcome', {}, true);
    net.emit('world', {});
    await tick();
    expect(report).toHaveBeenCalledWith(boom);
    // (the welcome's own listeners stop at the throw, as fakeNet's emit does; the next message is delivered)
    expect(seen).toEqual(['world']);
  });

  it('lets them through even if the screen never says it is dark', async () => {
    const net = fakeNet();
    const seen = [];
    net.on('welcome', () => seen.push('welcome'));
    holdFirstWelcome(net, () => Promise.reject(new Error('no animation')));
    net.emit('welcome', {}, true);
    await tick();
    expect(seen).toEqual(['welcome']);
  });
});

describe('what the screens say', () => {
  it('keeps the server words, and the field they are about', () => {
    expect(refusalOf(refused(409, 'name_taken', 'That name is taken.'), 'create')).toEqual({ text: 'That name is taken.', field: 'name', code: 'name_taken' });
    expect(refusalOf(refused(400, 'reserved_username', 'Usernames starting with "dev-" are reserved for development.'), 'register').field).toBe('username');
    expect(refusalOf(refused(400, 'invalid', 'name: Invalid'), 'create')).toMatchObject({ field: 'name', text: expect.stringMatching(/^Names are 2–20 letters/) });
    expect(refusalOf(refused(0, 'network', 'The server cannot be reached. Is it running?'), 'signin')).toEqual({ text: 'The server cannot be reached. Is it running?', field: null, code: 'network' });
    expect(refusalOf(null, 'signin').text).toBe('Something went wrong. Try again.');
  });

  it('checks only what the client can tell', () => {
    expect(credentialsProblem({ username: '', password: 'x' }, false)).toMatchObject({ field: 'username' });
    expect(credentialsProblem({ username: 'a', password: '' }, false)).toMatchObject({ field: 'password' });
    // (a sign-in is the server's to judge, malformed or not)
    expect(credentialsProblem({ username: 'a', password: 'x' }, false)).toBeNull();
    expect(credentialsProblem({ username: 'tess arlo', password: 'long enough' }, true)).toMatchObject({ field: 'username' });
    expect(credentialsProblem({ username: 'tess_arlo', password: 'x'.repeat(129) }, true)).toMatchObject({ field: 'password' });
    expect(credentialsProblem({ username: 'tess_arlo', password: 'long enough' }, true)).toBeNull();
    expect(normalName('  Ilya   Sarn ')).toBe('Ilya Sarn');
    expect(nameProblem('Ilya Sarn')).toBeNull();
    expect(nameProblem("O'Neil-Vey")).toBeNull();
    expect(nameProblem('X')).toMatchObject({ field: 'name' });
  });

  it('describes each people and where a character of theirs starts, from the shared tables', () => {
    const galaxy = new Galaxy(GALAXY_SEED);
    const t = peopleInfo('thalune', galaxy);
    expect(t).toMatchObject({ name: 'Thalune', kind: 'Amphibious · lush tidal coast', capital: 'Sarelun', system: galaxy.systems[0].name, saying: 'The tide takes and the tide returns' });
    expect(t.world).toMatch(new RegExp(`^${galaxy.systems[0].name} `));
    expect(t.body).toMatch(/^Smooth skin .*second lid\.$/);
    expect(peopleInfo('ixari', galaxy).system).toBe(galaxy.systems[59].name);
    expect(peopleInfo('ulgani', null)).toMatchObject({ kind: 'Fungal-symbiont · toxic spore moors', system: null, world: null });
    expect(characterView(QUILL, galaxy)).toEqual({ id: 'c2', name: 'Quill Ventrasse', people: 'ixari', peopleName: 'Ixari', level: 3, home: `Quavel, ${galaxy.systems[59].name} system` });
  });

  it('writes a name in Cartographer signs, one stroke a path segment', () => {
    const svg = glyphWord('Ixari');
    const strokes = (svg.match(/M[\d.]+ [\d.]+L/g) || []).length;
    // i, k, s (x is written ks), a, r, i
    const want = ['i', 'k', 's', 'a', 'r', 'i'].reduce((n, l) => n + SIGNS.find((s) => s.letter === l).strokes.length, 0);
    expect(strokes).toBe(want);
    expect((svg.match(/<circle/g) || []).length).toBe(6);
    expect(svg).toContain('stroke="currentColor"');
  });
});
