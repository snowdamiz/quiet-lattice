// `pnpm smoke -- boot` runs src/smoke/boot.spec.ts: a bare name is a spec file's name, anything with a path separator or
// a .ts suffix goes to Playwright as is, and flags pass through. With no file, the whole smoke directory runs.
export function smokeArgs(argv: readonly string[]): string[] {
  const rest = argv.filter((a) => a !== '--');
  const files = rest.filter((a) => !a.startsWith('-')).map((a) => (/[\\/]|\.ts$/.test(a) ? a : `src/smoke/${a}.spec.ts`));
  const flags = rest.filter((a) => a.startsWith('-'));
  return ['test', ...(files.length > 0 ? files : ['smoke']), ...flags];
}
