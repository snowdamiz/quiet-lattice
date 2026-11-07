// Read dependencies from an explicit existing checkout; never install or create node_modules.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const deps = process.env.EXACT_MASK_DEPS;
if (!deps) throw new Error('EXACT_MASK_DEPS must name an existing dependency checkout');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@astra/shared' || specifier.startsWith('@astra/shared/')) {
      const suffix = specifier.slice('@astra/shared'.length);
      return nextResolve(new URL(`../../../shared/src${suffix || ''}/index.ts`, import.meta.url).href, context);
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) throw error;
      for (const pkg of ['packages/tools', 'packages/client', '.']) {
        try {
          return nextResolve(specifier, { ...context, parentURL: pathToFileURL(resolve(deps, pkg, 'package.json')).href });
        } catch (fallback) {
          if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(fallback.code)) throw fallback;
        }
      }
      throw error;
    }
  },
});
