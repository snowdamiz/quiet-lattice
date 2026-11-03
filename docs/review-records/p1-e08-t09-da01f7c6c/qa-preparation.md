# P1.E08.T09 runtime QA preparation

Read-only Sol 6.1 extra-high inspection, 2026-11-03. This is a proposal, not runtime admission or completed QA. The inspected product source was clean at `2f36cdb2d6bdd1f40428b6b48c2c27fddbdcfcae`; source PASS report SHA256 is `6305f73723f18b48da6e25be99100c6867c6d524ac5bd8ec2441eeb0a18a3fa4`. No browser, server, container, test, database/Redis mutation, installation or cleanup ran.

## Existing test and command

From the task worktree, after a separately reviewed environment and ownership setup:

```sh
pnpm --filter @astra/tools exec playwright test src/smoke/fauna-online.spec.ts --workers=1 --retries=0 --repeat-each=1 --max-failures=1 --global-timeout=600000 --trace=off --reporter=list,json --output "$QA_OUT/test-results"
```

This selects one test, one Chromium browser, two contexts and two pages at 960×540. It creates two dev-login characters, teleports them onto dry ground, spawns four authoritative creatures and checks matching herd identities/species/names/frames, positions within four metres, instanced drawing on client A, picking/analysis, the server's `new` answer, species/Bond/XP presentation, and absence of browser errors. It does not test live combat feedback, capture pixels, grade appearance, measure performance or execute the merged tree.

Proposed environment: `CI=1` to forbid Vite reuse; `SMOKE_GL=metal`; a freshly checked `SMOKE_PORT`; explicit task-owned local `DATABASE_URL` and `REDIS_URL`; `PLAYWRIGHT_JSON_OUTPUT_FILE`; fresh private `TMPDIR`; `DEBUG=pw:browser` for launch receipts; fresh absolute `QA_OUT`. Never print credential values. The helper replaces the Redis database suffix with `/7`.

## Observed environment, subject to fresh verification

- Docker context `desktop-linux` is running. Shared `astra-postgres-1` and `astra-redis-1` are healthy on loopback 55432/56379 with existing volumes; they are not task-owned.
- Dependencies, Playwright 1.64.1 and Chromium/headless-shell revision 1248 are installed. Node reports v26.12.1. The available pnpm reports 11.25.0 while package metadata requests 12.15.0; resolve and pin the actual launcher before execution.
- `DATABASE_URL`, `REDIS_URL`, `CI`, `SMOKE_GL`, `SMOKE_PORT` and `ASTRA_SERVER` were unset; the worktree had no `.env`. No database/Redis connection was made.
- Free disk changed without QA action from about 8.1 GiB to 34 GiB at 05:31:14 UTC. Host memory is 48 GiB; an earlier sample showed about 25.97 GiB swap used. Docker VM memory is about 7.75 GiB. These observations are not reservations or memory qualification.

## Ownership and destructive operations

`startOnline()` creates and migrates a random scratch Postgres database, then drops that exact scratch database with `DROP DATABASE IF EXISTS ... WITH (FORCE)`. Game/migration writes target the scratch database. The selected spec does not call the helper's arbitrary SQL interface, shared-table truncate, `FLUSHDB` or `FLUSHALL`.

Redis is not isolated by task: every run uses database 7, shard `main`, and overwrites `astra:shard:main:world`, including at shutdown. `stop()` does not remove that Redis state. Do not silently use the shared Redis endpoint.

The test changes its created characters and spawned test herd. Server shutdown requests SIGTERM, waits ten seconds, then can SIGKILL without awaiting that final exit. External owned-process drain remains necessary.

Playwright recursively clears its configured output directory. Admission must require a fresh absolute path, never existing `test-results` or captures. Browser profiles are temporary owned resources; preserve required receipts through the accepted helper path.

The unchanged Playwright configuration starts an extra Vite on `SMOKE_PORT` (5190 was unoccupied when inspected), with the client configuration's all-interface `host:true`. The online helper separately starts loopback Vite, game HTTP and admin listeners on three ephemeral ports. Thus unchanged execution has four application listener ports, plus isolated Postgres/Redis ports. Any loopback-only override or removal of the redundant Vite needs a small reviewed task configuration; it has not been prepared. A port collision must fail, not silently reuse another server.

## Concrete isolated-service proposal

Create two uniquely named/labeled task-owned containers from installed pinned image IDs, with `--pull=never`, loopback-only published ports, bounded logs and memory, no existing volumes or additional Docker network:

- Postgres 16: `sha256:9e2cf6287f25c3151f4c9421ccce2b17f3e60061c111a29165e0d2cdd9ff0a97`.
- Redis 7: `sha256:44960b3100c48159a66d28c18b0588c193492e25f7551d60e51dd464fc3eca5b`.

Suggested, unmeasured ceilings are 1 GiB Postgres memory with 512 MiB data tmpfs and 128 MiB Redis memory with a 32 MiB nonpersistent dataset. Confirm needs and actual launch options before admission. Record returned container IDs and labels immediately. Preserve logs, stop/remove only those exact owned containers, and prove their IDs/port mappings absent. Preserve Docker itself and user containers/volumes. Host process cohorts do not establish ownership of Docker resources.

For host processes, reuse unchanged StationJob start/wait/drain/archive and private-TMP APIs from station helper commit `ca7d91e378e9d2f3f0ce8f0651475dcb843875d9`; all four supplied helper hashes matched at inspection. Record actual controller and process identities, kernel cohort, launchd registration, browser profile, listeners and assertions. Exact child count is dynamic. No alternative supervisor is proposed.

## Bounds and remaining work

Existing internal limits: outer Vite startup 120 seconds; online health 60 seconds; hooks inherit 180-second test timeout; test body overrides to 300 seconds; individual browser waits reach 120 seconds. Synchronous database creation/migration subprocesses have no individual timeout, so an external bound is required. Proposed Playwright global timeout is 600 seconds, host StationJob phase 660 seconds, accepted drain 60 seconds, and separately bounded Docker cleanup. No retry or automatic rerun.

A 1 GiB output budget and 6 GiB free-space stop floor are proposals only. Complete successful server-log retention is currently absent: the helper retains output in memory and prints it for some failures. A concrete caller must address required evidence retention, storage/copy/staging accounting, admission independent of removable Python assertions, input/route bindings, cleanup receipts and current capacity before a grant.

Offline visual capture, live combat coverage, independent visual grading, two-client execution and eventual task checks plus `pnpm typecheck && pnpm test && pnpm smoke` on the actual merged tree remain open.
