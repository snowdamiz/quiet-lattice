// The browser backend smoke runs on: the real GPU (ANGLE on Metal) on macOS, outside CI. SMOKE_GL=swiftshader opts into
// software rendering for CI or a machine without a usable GPU; it is about 60 times slower here (`boot` takes 2.1 minutes
// against 2 s under load), so it is not the default. A stuck renderer is the hang guard's job (harness.ts), not the backend's.
export type SmokeGl = 'swiftshader' | 'metal';

export const smokeGl: SmokeGl =
  process.env.SMOKE_GL === 'swiftshader' || process.env.SMOKE_GL === 'metal'
    ? process.env.SMOKE_GL
    : process.platform === 'darwin' && !process.env.CI
      ? 'metal'
      : 'swiftshader';

export const smokeGlArgs =
  smokeGl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export const smokeViewport = smokeGl === 'metal' ? { width: 1280, height: 720 } : { width: 480, height: 270 };
