// `pnpm smoke -- boot` runs src/smoke/boot.spec.ts: a bare name is a spec file's name, anything with a path separator or
// a .ts suffix goes to Playwright as is. Put file selectors before flags; flags and their values pass through unchanged.
// With no file, the whole smoke directory runs.
export function smokeArgs(argv: readonly string[]): string[] {
  const rest = argv[0] === '--' ? argv.slice(1) : argv;
  const firstFlag = rest.findIndex((a) => a.startsWith('-'));
  const split = firstFlag === -1 ? rest.length : firstFlag;
  const files = rest.slice(0, split).map((a) => (/[\\/]|\.ts(?::\d+)?$/.test(a) ? a : `src/smoke/${a}.spec.ts`));
  const flags = rest.slice(split);
  return ['test', ...(files.length > 0 ? files : ['smoke']), ...flags];
}
