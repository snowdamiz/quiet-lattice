// Describes star systems as the server will: describeGalaxySystem from @astra/shared/world, run by Node under tsx with no
// client code and no DOM. Prints the descriptions of a galaxy's first systems as JSON, and the modules that were loaded.
//   pnpm exec tsx packages/tools/src/fixtures/describe-systems.ts [galaxySeed=424242] [count=10]
import { registerHooks } from 'node:module';

if ('window' in globalThis || 'document' in globalThis) throw new Error('describe-systems must run without a DOM');

// every module loaded from here on, by URL
const loaded: string[] = [];
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    loaded.push(r.url);
    return r;
  },
});

const { Galaxy, describeGalaxySystem } = await import('@astra/shared/world');
const [seed = 424242, count = 10] = process.argv.slice(2).map(Number);
const systems = new Galaxy(seed).systems.slice(0, count).map(describeGalaxySystem);
process.stdout.write(JSON.stringify({ systems, modules: [...new Set(loaded)] }));
