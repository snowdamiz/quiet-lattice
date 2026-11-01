// Smoke uses the real GPU (ANGLE on Metal on macOS). SMOKE_GL=swiftshader opts into
// software rendering for CI or a machine without a usable GPU; it is about 60 times slower here (`boot` takes 2.1 minutes
// against 2 s under load), so it is not the default. A stuck renderer is the hang guard's job (harness.ts), not the backend's.
export type SmokeGl = 'swiftshader' | 'metal' | 'gpu';

export function smokeBackend(value: string | undefined, platform: NodeJS.Platform): SmokeGl {
  if (value === undefined) return platform === 'darwin' ? 'metal' : 'gpu';
  if (value === 'swiftshader' || value === 'metal' || value === 'gpu') return value;
  throw new Error(`Unknown SMOKE_GL=${value}; use gpu, metal or swiftshader`);
}

export const smokeGl = smokeBackend(process.env.SMOKE_GL, process.platform);

export const smokeGlArgs =
  smokeGl === 'swiftshader'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : [...(smokeGl === 'metal' ? ['--use-angle=metal'] : []), '--enable-gpu', '--ignore-gpu-blocklist'];

export const smokeViewport = smokeGl === 'swiftshader' ? { width: 480, height: 270 } : { width: 1280, height: 720 };
