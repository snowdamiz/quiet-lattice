// The browser backend smoke runs on. Software (SwiftShader) everywhere, this machine's included: smoke is a
// correctness check, and a Chromium on the real GPU shares it with every Blender bake and capture running beside it,
// which stalls its renderer for minutes. `pnpm capture` measures frame cost and keeps the real GPU (capture.ts).
// SMOKE_GL=metal opts a smoke run back into ANGLE on Metal.
export type SmokeGl = 'swiftshader' | 'metal';

export const smokeGl: SmokeGl = process.env.SMOKE_GL === 'metal' ? 'metal' : 'swiftshader';

export const smokeGlArgs =
  smokeGl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export const smokeViewport = smokeGl === 'metal' ? { width: 1280, height: 720 } : { width: 480, height: 270 };
