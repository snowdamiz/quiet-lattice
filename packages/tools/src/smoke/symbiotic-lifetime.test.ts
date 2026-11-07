import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeServerMessage, encodeSnapshot } from '@astra/shared/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSourceFile,
  forEachChild,
  isAwaitExpression,
  isClassDeclaration,
  isClassExpression,
  isBinaryExpression,
  isExpressionStatement,
  isIfStatement,
  isMethodDeclaration,
  isBlock,
  ScriptTarget,
  transpileModule,
  type Node,
} from 'typescript';

const client = (path: string) => new URL(`../../../client/src/${path}`, import.meta.url);
const { Net } = await import(pathToFileURL(client('net/Net.js').pathname).href);
const spec = readFileSync(new URL('./symbiotic-online.spec.ts', import.meta.url), 'utf8');
const gameSource = readFileSync(client('Game.js'), 'utf8');
const mainSource = createSourceFile('main.js', readFileSync(client('main.js'), 'utf8'), ScriptTarget.Latest, true);
const require = createRequire(import.meta.url);
const testRequire = createRequire(require.resolve('@playwright/test/package.json'));
const playwrightRequire = createRequire(testRequire.resolve('playwright/package.json'));
const playwright = readFileSync(join(dirname(playwrightRequire.resolve('playwright-core/package.json')), 'lib/coreBundle.js'), 'utf8');
const playwrightSource = createSourceFile('coreBundle.js', playwright, ScriptTarget.Latest, true);

// Compile the actual method bodies with inert platform ports; no Game/renderer/browser is constructed.
function method(source: ReturnType<typeof createSourceFile>, className: string, name: string) {
  let result: string | undefined;
  const visit = (node: Node) => {
    if (
      (isClassDeclaration(node) || isClassExpression(node)) &&
      (node.name?.text === className || (isBinaryExpression(node.parent) && node.parent.left.getText(source) === className))
    ) {
      const found = node.members.find((m) => isMethodDeclaration(m) && m.name.getText(source) === name);
      if (found) result = found.getText(source);
      return;
    }
    forEachChild(node, visit);
  };
  visit(source);
  if (!result) throw new Error(`Missing actual ${className}.${name}`);
  return result;
}
const gameMethods = new Function(
  'setNotice',
  'clearSession',
  `return ({${['onNetClosed', 'leaveWorld'].map((name) => method(createSourceFile('Game.js', gameSource, ScriptTarget.Latest, true), 'Game', name)).join(',')}})`,
)(
  () => {},
  () => {},
);
const bootstrap = mainSource.statements.find((s) => isIfStatement(s) && s.expression.getText(mainSource).includes("params.has('dev')"));
if (!bootstrap || !isIfStatement(bootstrap) || !isBlock(bootstrap.thenStatement)) throw new Error('Missing actual dev bootstrap');
const [wait, start] = bootstrap.thenStatement.statements;
if (!wait || !start || !isExpressionStatement(start)) throw new Error('Missing actual dev bootstrap producer');
const boot = new Function('game', 'params', 'scenarioName', 'SCENARIOS', `${wait.getText(mainSource)}; return ${start.expression.getText(mainSource)};`);
const welcome = {
  t: 'welcome',
  accountId: 'a1',
  character: { id: 'c1', name: 'Tess Arlo', people: 'thalune', look: { palette: 0, pattern: 0, head: 0, suit: 0 }, level: 1, homeSystem: 0 },
  entityId: 7,
  serverTime: 1000,
  zone: { id: 'sys:0', systemSeed: 1 },
  pose: { frame: '1:station', pos: [30, 2.4, 22], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
  mode: 'docked',
} satisfies Parameters<typeof encodeServerMessage>[0];

function owner() {
  const calls: string[] = [];
  const sockets: Socket[] = [];
  const retry = vi.fn();
  class Socket {
    readyState = 0;
    onopen?: () => void;
    onclose?: (event: { code: number; reason: string }) => void;
    onmessage?: (event: { data: string | ArrayBuffer }) => void;
    constructor() {
      sockets.push(this);
    }
    send() {}
    close(code: number, reason: string) {
      this.readyState = 3;
      this.onclose?.({ code, reason });
    }
  }
  const createGame = () => {
    const net = new Net({
      url: 'ws://inert/ws',
      token: 'tok',
      characterId: 'c1',
      WebSocket: Socket,
      now: () => 1000,
      timers: { setTimeout: retry, clearTimeout() {} },
    });
    const game = { ...gameMethods, net, inventory: { send: null }, mode: 'foot' };
    // The real enterWorld registration, not a copy of its closed handler.
    const registration = gameSource.match(/net\.on\('closed', [^\n]+/u)?.[0];
    if (!registration) throw new Error('Missing Game closed registration');
    new Function('net', 'onFail', registration).call(game, net, undefined);
    net.connect();
    const socket = sockets.at(-1)!;
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({ data: encodeServerMessage(welcome) });
    const bytes = encodeSnapshot({ tick: 1, time: 1000, ack: 1, full: true, entities: [], removed: [] });
    socket.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
    expect(net.joined).toBe(true);
    return game;
  };
  const realm = { game: createGame() };
  let live = true;
  let navigation = false;
  vi.stubGlobal('window', realm);
  vi.stubGlobal('location', {
    reload() {
      calls.push('reload');
      navigation = true;
      Reflect.deleteProperty(realm, 'game');
    },
  });
  return {
    calls,
    sockets,
    retry,
    realm,
    evaluate: async (fn: () => unknown) => fn(),
    destroy() {
      live = false;
      navigation = false;
      // Platform target destruction discards the realm: no script onclose/reload can execute there.
      for (const socket of sockets) socket.readyState = 3;
      Reflect.deleteProperty(realm, 'game');
      calls.push('destroy');
    },
    async navigate() {
      if (!live || !navigation) return;
      navigation = false;
      const game = {
        menus: {
          ready: true,
          account: {
            devLogin: async ({ name }: { name: string }) => {
              calls.push(`devLogin:${name}`);
              Object.assign(game, createGame());
              return true;
            },
          },
        },
      };
      realm.game = game;
      // Exact online bootstrap branch; only its dev-login transport is an inert port.
      await boot(game, new URLSearchParams('dev=bond-r5'), 'foot', new Set(['foot']));
    },
  };
}

type Owner = ReturnType<typeof owner>;
function terminalPage(o: Owner, options: { hold?: boolean; fail?: boolean } = {}) {
  const commands: [string, unknown][] = [];
  let resolve!: () => void;
  const closedPromise = Object.assign(
    new Promise<void>((done) => {
      resolve = done;
    }),
    { resolve: () => resolve() },
  );
  const methods = new Function(
    'TargetClosedError',
    '_Page',
    'BrowserContext',
    'debugLogger',
    `return ({${['_close', '_didClose', 'isClosed'].map((name) => method(playwrightSource, 'Page', name)).join(',')}})`,
  )(Error, { Events: { Close: 'close' } }, { Events: { PageClosed: 'pageclosed' } }, { log() {} });
  // CRPage is anonymous in the bundle: compile its exact protocol dispatch method.
  const crClose = new Function(`return ({${method(playwrightSource, 'CRPage', 'closePage')}})`)().closePage;
  const browserClose = new Function(`return ({${method(playwrightSource, '_CRBrowser', '_closePage')}})`)()._closePage;
  const clientMethods = new Function(
    'isTargetClosedError2',
    'kNoTimeout',
    'Events',
    `return ({${['close', 'isClosed', '_onClose'].map((name) => method(playwrightSource, 'Page3', name)).join(',')}})`,
  )(() => false, {}, { Page: { Close: 'close' }, BrowserContext: { PageClose: 'pageclose' } });
  const publicPage = { ...clientMethods, _closed: false, _disposeHarRouters() {}, emit() {}, _browserContext: { _pages: new Set(), emit() {} } };
  const page = {
    ...methods,
    _lifecycle: 'open',
    closedPromise,
    instrumentation: { onPageWillClose: async () => {}, onPageDidClose: () => o.calls.push('closed-receipt') },
    screencast: { handlePageOrContextClose: async () => {} },
    closeReason: () => '',
    _didDisconnect() {},
    emit: () => publicPage._onClose(),
    browserContext: { emit() {} },
  };
  const receipt = () => {
    o.destroy();
    page._didClose();
  };
  const browser = {
    _closePage: browserClose,
    _session: {
      send: async (command: string, args: unknown) => {
        commands.push([command, args]);
        if (options.fail) throw new Error('target close rejected');
        if (!options.hold) receipt();
      },
    },
  };
  page.delegate = { closePage: crClose, _targetId: 'owner-target', _browserContext: { _browser: browser } };
  publicPage._channel = {
    close: async (opts: { reason?: string }) => {
      // A controlled deadline port replaces the live test/hang-guard deadline. Neither command
      // acceptance nor a swallowed protocol rejection may substitute for the closed notification.
      await Promise.race([page._close(opts), ...(options.fail ? [new Promise((_, reject) => setTimeout(() => reject(new Error('close deadline')), 10))] : [])]);
    },
    runBeforeUnload: async () => {
      throw new Error('beforeunload must not run');
    },
  };
  return { commands, receipt, evaluate: o.evaluate, close: publicPage.close.bind(publicPage), isClosed: publicPage.isClosed.bind(publicPage) };
}

function release(page: ReturnType<typeof terminalPage>, calls: string[], captureFails = false) {
  const begin = spec.indexOf('    // Close the owner while combat is frozen');
  const end = spec.indexOf('    await online.clock.thaw();', begin);
  if (begin < 0 || end < 0) throw new Error('Missing fixture release block');
  const code = transpileModule(spec.slice(begin, end + '    await online.clock.thaw();'.length), {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  const run = new Function('a', 'online', 'until', 'expect', 'pixels', 'info', 'evidence', `return (async () => {${code}})();`);
  return run(
    { page },
    { clock: { thaw: async () => calls.push('thaw') } },
    async (_page: unknown, predicate: string) => {
      expect(new Function(`return (${predicate})`)()).toBe(true);
    },
    expect,
    async (_info: unknown, pages: unknown[], label: string) => {
      expect(pages).toEqual([page]);
      if (captureFails) throw new Error('capture failed');
      calls.push(label);
    },
    {},
    {},
  );
}

function fixtureAwait(fragment: string) {
  const source = createSourceFile('symbiotic-online.spec.ts', spec, ScriptTarget.Latest, true);
  let found: string | undefined;
  const visit = (node: Node) => {
    if (isAwaitExpression(node) && node.expression.getText(source).startsWith(fragment)) found = node.getText(source);
    forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`Missing fixture await ${fragment}`);
  return transpileModule(found, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
}

describe('owner disconnect uses terminal page lifetime', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reproduces Net.close -> Game reload -> missing game -> online dev rejoin', async () => {
    const o = owner();
    const first = o.realm.game.net;
    first.close();
    expect(first.state).toBe('closed');
    expect(o.calls).toEqual(['reload']);
    expect(() => new Function('return !window.game.net || window.game.net.state === "closed"')()).toThrow(/net/);
    await o.navigate();
    expect(o.calls).toEqual(['reload', 'devLogin:bond-r5']);
    expect(o.realm.game.net).not.toBe(first);
    expect(o.realm.game.net.joined).toBe(true);
    expect(o.sockets).toHaveLength(2);
  });
  it('dispatches target close before thaw, without executing Net.close or rejoining', async () => {
    const o = owner();
    const page = terminalPage(o);
    await release(page, o.calls);
    expect(page.isClosed()).toBe(true);
    expect(page.commands).toEqual([['Target.closeTarget', { targetId: 'owner-target' }]]);
    expect(o.calls).toEqual(['before-disconnect', 'destroy', 'closed-receipt', 'thaw']);
    expect(o.sockets.every((s) => s.readyState === 3)).toBe(true);
    await o.navigate();
    expect(o.sockets).toHaveLength(1);
    expect(o.calls).not.toContain('reload');
  });
  it('waits for the closed receipt, not just command acceptance', async () => {
    const o = owner();
    const page = terminalPage(o, { hold: true });
    const pending = release(page, o.calls);
    await Promise.race([pending, vi.waitFor(() => expect(page.commands).toHaveLength(1))]);
    expect(page.isClosed()).toBe(false);
    expect(o.calls).not.toContain('thaw');
    page.receipt();
    await pending;
    expect(o.calls.at(-1)).toBe('thaw');
  });
  it('rejects a failed close without thawing or claiming retirement', async () => {
    const o = owner();
    const page = terminalPage(o, { fail: true });
    await expect(release(page, o.calls)).rejects.toThrow('close deadline');
    expect(page.commands).toHaveLength(1);
    expect(page.isClosed()).toBe(false);
    expect(o.calls).not.toContain('thaw');
  });
  it('retains a capture failure before closing the owner', async () => {
    const o = owner();
    const page = terminalPage(o);
    await expect(release(page, o.calls, true)).rejects.toThrow('capture failed');
    expect(page.commands).toEqual([]);
    expect(o.calls).not.toContain('thaw');
  });
  it('captures post-retirement pixels from the surviving observer only', async () => {
    const screenshot = vi.fn(async () => Buffer.from('CPU screenshot port, not pixels'));
    const attach = vi.fn();
    const run = new Function('b', 'info', `return (async () => {${fixtureAwait("info.attach('disconnect-observer'")}})();`);
    await run({ page: { screenshot } }, { attach });
    expect(screenshot).toHaveBeenCalledExactlyOnceWith({ timeout: 15_000 });
    expect(attach).toHaveBeenCalledExactlyOnceWith('disconnect-observer', { body: Buffer.from('CPU screenshot port, not pixels'), contentType: 'image/png' });
  });
  it('does not evaluate the closed owner again during existing final cleanup', async () => {
    const closedOwner = {
      isClosed: () => true,
      evaluate: vi.fn(async () => {
        throw new Error('closed owner evaluated');
      }),
    };
    const remaining = {
      isClosed: () => false,
      evaluate: vi.fn(async () => {
        throw new Error('observer cleanup failed');
      }),
    };
    const run = new Function('pages', `return (async () => {${fixtureAwait('Promise.all(pages')}})();`);
    await run([closedOwner, remaining]);
    expect(closedOwner.evaluate).not.toHaveBeenCalled();
    expect(remaining.evaluate).toHaveBeenCalledTimes(1);
    // The fixture still leaves final context closure (including failed best-effort Net.close) to hangGuard.
  });
});
