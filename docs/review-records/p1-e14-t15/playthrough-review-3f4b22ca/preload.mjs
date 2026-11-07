import { registerHooks } from 'node:module';
import { appendFileSync, writeFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const target = process.env.REVIEW_TARGET;
if (!target) throw new Error('REVIEW_TARGET is required');
const targetURL = pathToFileURL(realpathSync(target)).href;
const loaded = [];
process.on('exit', code => {
  if (process.env.REVIEW_META) writeFileSync(process.env.REVIEW_META, JSON.stringify({ code, version: process.version, execPath: process.execPath, argv: process.argv, loaded, trace: globalThis.__playthroughReview.trace }, null, 2) + '\n');
});
const scenarios = JSON.parse(process.env.REVIEW_CASE || '{}');
const state = globalThis.__playthroughReview = {
  trace: [], faults: new Map(), hook: undefined, config: scenarios,
  step(name) {
    this.trace.push(name);
    if (process.env.REVIEW_TRACE) appendFileSync(process.env.REVIEW_TRACE, name + '\n');
    this.hook?.(name);
    if (this.faults.has(name)) throw this.faults.get(name);
    if (Object.hasOwn(this.config.faults || {}, name)) throw decode(this.config.faults[name]);
  },
};
function decode(tag) {
  if (tag === 'undefined') return undefined;
  if (tag === 'null') return null;
  if (tag === 'false') return false;
  if (tag === 'zero') return 0;
  if (tag === 'abort') return new DOMException('cancelled', 'AbortError');
  return new Error(tag);
}
Date.now = () => 0;
const stubURL = new URL('./ports.mjs', import.meta.url).href;
registerHooks({
  load(url, context, next) {
    if (url.split('?')[0] === targetURL) loaded.push(url);
    return next(url, context);
  },
  resolve(specifier, context, next) {
    const fromTarget = context.parentURL?.split('?')[0] === targetURL;
    if (fromTarget && (specifier === './capture.ts' || specifier === '@playwright/test')) {
      return { url: stubURL, shortCircuit: true };
    }
    if (specifier === 'vite' || specifier.includes('playwright') || (specifier.endsWith('/capture.ts') && !fromTarget)) {
      throw new Error('Real resource dependency blocked: ' + specifier);
    }
    return next(specifier, context);
  },
});
