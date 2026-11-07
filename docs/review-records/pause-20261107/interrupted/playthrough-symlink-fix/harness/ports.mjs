const s = globalThis.__playthroughReview;
const phaseNames = ['leave', 'descend', 'land', 'disembark', 'mine', 'analyze', 'board', 'climb', 'dock'];
function step(name) { return s.step(name); }
export function startVite() {
  step('startVite');
  return Promise.resolve({
    get url() { step('url'); return 'http://stub.invalid'; },
    stop() {
      step('stop');
      return s.stopPromise || Promise.resolve().then(() => step('stop:done'));
    },
  });
}
export function glArgs() {
  step('glArgs');
  return { get args() { step('glArgs.args'); return ['--stub']; } };
}
export const chromium = {
  launch(options) {
    step('launch');
    s.launchOptions = options;
    return Promise.resolve({
      newPage(options) {
        step('newPage');
        s.pageOptions = options;
        let evaluateCount = 0;
        return Promise.resolve({
          on(event, listener) {
            step('on:' + event);
            if (s.config.pageErrors && event === 'pageerror') listener(new Error('page broke'));
            if (s.config.pageErrors && event === 'console') {
              listener({ type: () => 'warning', text: () => 'ignored' });
              listener({ type: () => 'error', text: () => 'console broke' });
            }
          },
          goto(url) { step('goto'); s.url = url; return Promise.resolve(); },
          waitForFunction(fn, arg, options) {
            step('ready');
            s.readyArgs = { fn, arg, options };
            return Promise.resolve();
          },
          async evaluate(fn, arg) {
            evaluateCount++;
            if (evaluateCount === 1) { step('initialize'); return; }
            if (typeof arg === 'string') {
              step('phase:' + arg);
              const handlers = Object.fromEntries(phaseNames.map(name => [name, async () => (s.config.phaseResults?.[name] ?? name + ' ok')]));
              globalThis.window = { __pt: handlers };
              return await fn(arg);
            }
            step('dockState');
            const ship = { mode: 'docked' };
            globalThis.window = { game: { ship, station: { pads: [{ occupied: ship }, { occupied: {} }, { occupied: null }] }, hud: { root: { innerText: 'Docked' } } } };
            return await fn();
          },
        });
      },
      close() {
        step('close');
        return s.closePromise || Promise.resolve().then(() => step('close:done'));
      },
    });
  },
};
