# Failure tails (exact-base RED)

## own-exact-base-red (exit 1)

### native category discovery regression retains the detached category reply during cancelled-return

```text
AssertionError: expected { kind: 'trace-on', …(14) } to match object { categories: { …(2) }, …(2) }
(12 matching properties omitted from actual)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:2066:10)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:1958:14)
    at Proxy.methodWrapper (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/chai@6.3.0/node_modules/chai/index.js:1737:25)
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/trace-observer.test.ts:1159:37
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

### native category discovery regression retains the detached category reply during deadline-draining-return

```text
AssertionError: expected { kind: 'trace-on', …(14) } to match object { categories: { …(2) }, …(2) }
(12 matching properties omitted from actual)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:2066:10)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:1958:14)
    at Proxy.methodWrapper (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/chai@6.3.0/node_modules/chai/index.js:1737:25)
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/trace-observer.test.ts:1159:37
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

### native category discovery regression cuts off a category reply after publication without changing failed evidence or writing sinks

```text
AssertionError: expected { kind: 'ports-unsettled', …(2) } to match object { kind: 'ports-unsettled', …(2) }
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:2066:10)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:1958:14)
    at Proxy.methodWrapper (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/chai@6.3.0/node_modules/chai/index.js:1737:25)
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/trace-observer.test.ts:1186:35
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

### drains the page before browser disposal through nativeMain, actual adapter and dispatcher: category-cancel

```text
AssertionError: expected null to deeply equal { categories: [], unknown: { …(1) } }
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/trace_observer_packet/worker.drain.test.ts:163:48
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

## own-exact-base-red-2 (exit 1)

### native category discovery regression retains the detached category reply during cancelled-return

```text
AssertionError: expected { kind: 'trace-on', …(14) } to match object { categories: { …(2) }, …(2) }
(12 matching properties omitted from actual)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:2066:10)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:1958:14)
    at Proxy.methodWrapper (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/chai@6.3.0/node_modules/chai/index.js:1737:25)
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/trace-observer.test.ts:1175:37
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

### native category discovery regression retains the detached category reply during deadline-draining-return

```text
AssertionError: expected { kind: 'trace-on', …(14) } to match object { categories: { …(2) }, …(2) }
(12 matching properties omitted from actual)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:2066:10)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:1958:14)
    at Proxy.methodWrapper (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/chai@6.3.0/node_modules/chai/index.js:1737:25)
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/trace-observer.test.ts:1175:37
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

### drains the page before browser disposal through nativeMain, actual adapter and dispatcher: category-cancel

```text
AssertionError: expected null to deeply equal { categories: [], unknown: { …(1) } }
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/trace_observer_packet/worker.drain.test.ts:174:48
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

## reviewer-exact-base-red (exit 1)

### reviewer retains raw category reply at cancelled-return

```text
AssertionError: expected { kind: 'trace-on', …(14) } to match object { Object (categories) }
(15 matching properties omitted from actual)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:2066:10)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:1958:14)
    at Proxy.methodWrapper (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/chai@6.3.0/node_modules/chai/index.js:1737:25)
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/reviewer-neighbors.test.ts:336:34
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

### reviewer retains raw category reply at deadline-draining-return

```text
AssertionError: expected { kind: 'trace-on', …(14) } to match object { Object (categories) }
(15 matching properties omitted from actual)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:2066:10)
    at Proxy.<anonymous> (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/index.aTZaPVhf.js:1958:14)
    at Proxy.methodWrapper (file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/chai@6.3.0/node_modules/chai/index.js:1737:25)
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/reviewer-neighbors.test.ts:336:34
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

### drains the page before browser disposal through nativeMain, actual adapter and dispatcher: category-cancel

```text
AssertionError: expected null to deeply equal { categories: [] }
    at /private/tmp/p1-e14-t13-category-retention-sczivq8g/source/packages/tools/src/capture/trace_observer_packet/reviewer-worker.test.ts:173:77
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:20
```

