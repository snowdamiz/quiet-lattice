# Progress log

One entry per merged task of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), newest last: date, task id, summary, files
touched, gate verdicts. Only the orchestrator writes here.

| Date | Task | Summary | Files | Gates |
|---|---|---|---|---|
| 2026-10-26 | P1.E01.T01 | git + LFS (`*.blend`, `assets/renders/**`, `*.mp4`); pnpm workspace with `packages/{shared,client,server,tools}`; the demo moved to `packages/client` unchanged; Vite port follows `PORT`. | root, `packages/*`, `.claude/launch.json` | `pnpm i && pnpm -r build` ok; demo boots, no console errors |
| 2026-10-26 | P1.E01.T02 | `tsconfig.base.json`, strict TS for shared/server/tools, client `allowJs`; ESLint flat config + Prettier; 22 dead variables in the demo removed. | root configs, `packages/*/tsconfig.json`, 13 client files | `pnpm typecheck`, `pnpm lint` pass |
| 2026-10-26 | P1.E01.T04 | Postgres 16 + Redis 7 with health checks; `pnpm db:up/down/migrate`. | `infra/docker-compose.yml`, `.env.example` | `pnpm db:up` reports both healthy |
| 2026-10-26 | P1.E01.T06 | This log, the decisions log, the art bible's outline; README for the monorepo. | `docs/*.md`, `README.md` | files present; `pnpm lint` passes |
| 2026-10-26 | P1.E01.T03 | vitest projects per package (`pnpm test`); Playwright smoke boots the client with `dev.boot()`, steps 180 frames, asserts no console errors and a non-black frame (`pnpm smoke`); ANGLE/Metal locally, SwiftShader at 480×270 in CI. | `vitest.config.ts`, `packages/*/vitest.config.ts`, `packages/tools/playwright.config.ts`, `packages/tools/src/smoke/*` | `pnpm test`, `pnpm smoke` (both backends) pass; a console error fails it |
| 2026-10-26 | P1.E01.T07 | `pnpm gate:removed`: 18 rules pairing DESIGN 20.3's demo code with the tasks that replace it; fails once a task is `[x]` while its code remains. | `packages/tools/src/gates/*` | gate passes (0 enforced, 18 waiting); 7 unit tests |
| 2026-10-26 | P1.E01.T05 | CI workflow (typecheck, lint, unit, integration with service containers, gate, SwiftShader smoke; Blender job for changed `.blend`); `pnpm test:int`. **Blocked:** no GitHub remote to run it on. | `.github/workflows/ci.yml`, `vitest.int.config.ts` | actionlint clean; not run on GitHub |
| 2026-10-26 | P1.E02.T08 | `@astra/shared/protocol`: versioned zod messages (HTTP bodies, client and server control, events), msgpack snapshots with baseline ticks, field-level deltas with `clear`, sanitised encoding, per-entity decoding, a frozen `hello`. | `packages/shared/src/protocol/*`, `docs/ARCHITECTURE.md` | 55 tests; review REVISE ×2 (deltas, baselines, bad numbers, bounds, leaks, desync) → PASS on round 3 |
| 2026-10-26 | P1.E02.T01 | rng, noise, planetgen, sites, cities, galaxy, cosmos and the Edge constants ported to strict TS in `@astra/shared/world`; client copies deleted; golden fixture for seed 424242 recorded from the original JS. | `packages/shared/src/world/*`, 24 client files (imports), fixtures and generators in tools | 77 tests then; fixture byte-identical; title shot 0.0000% diff; review PASS (reviewer rebuilt the fixture from main independently) |
