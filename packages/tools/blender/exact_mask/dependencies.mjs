// Read dependencies from an explicit existing checkout; never install or create node_modules.
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const deps = process.env.EXACT_MASK_DEPS;
if (!deps) throw new Error('EXACT_MASK_DEPS must name an existing dependency checkout');
const ts = createRequire(pathToFileURL(resolve(deps, 'package.json')))('typescript');
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return loaded;
    // Engine reaches parameter properties in shared/world/sites.ts. Node's native
    // strip-only loader cannot execute them; use the already installed compiler.
    const { outputText, diagnostics } = ts.transpileModule(Buffer.from(loaded.source).toString(), {
      fileName: fileURLToPath(url),
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    });
    const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(ts.formatDiagnostics(errors, {
      getCanonicalFileName: (name) => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
    }));
    return { ...loaded, format: 'module', source: outputText };
  },
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
