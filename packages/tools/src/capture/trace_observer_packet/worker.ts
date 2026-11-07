import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, loadavg } from 'node:os';
import type { NativePorts } from './adapter.ts';
import { EvidenceStore, failureSnapshot, readBytes, readSnapshot, sha256 } from './evidence.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Admission object missing');
  return Object.fromEntries(Object.entries(value));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function string(value: unknown) {
  if (typeof value !== 'string' || !value) throw new Error('Admission string missing');
  return value;
}
function records(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Admission records missing');
  return Array.from(value, object);
}
export function workerAdmission(args: string[]) {
  if (args.length !== 3 || args[0] !== '--owned') throw new Error('Disabled entry; exact owned admission required');
  const receipt = readSnapshot(args[1], args[2]);
  const ready = object(receipt.value);
  if (ready.runtimeAuthorized !== true || ready.purpose !== 'P1.E14.T13/unchanged-reference-trace-observer-v1')
    throw new Error('Trace observer readiness disabled');
  const binding = object(ready.binding),
    grant = object(ready.grant);
  if (process.version !== 'v22.23.3' || process.execPath !== binding.node || process.env.SMOKE_GL !== 'metal')
    throw new Error('Exact Node22/Metal binding required');
  const consumed = readSnapshot(join(string(binding.consumption), 'grant.json'), string(ready.grantSha256));
  if (
    canonical(consumed.value) !== canonical(grant) ||
    grant.purpose !== ready.purpose ||
    grant.readinessSha256 !== ready.admittedReadinessSha256 ||
    grant.planSha256 !== ready.planSha256 ||
    grant.head !== ready.head ||
    grant.tree !== ready.tree ||
    grant.output !== binding.output ||
    typeof grant.expiresAtEpochSeconds !== 'number' ||
    grant.expiresAtEpochSeconds * 1000 <= Date.now()
  )
    throw new Error('Owned grant/consumption expired or changed');
  const expected = object(binding.expectedDevice),
    control = object(binding.controlledLoad);
  if (
    expected.backend !== 'metal' ||
    !string(expected.rendererContains) ||
    !Array.isArray(control.maxLoad) ||
    control.maxLoad.length !== 3 ||
    Array.from(control.maxLoad).some((x) => typeof x !== 'number' || !Number.isFinite(x) || x < 0)
  )
    throw new Error('Device/load expectation missing');
  return { ready, binding, expected, control, receipt };
}
export async function nativeMain(args: string[]) {
  const { ready, binding, expected, control, receipt } = workerAdmission(args); // Refusal precedes native imports/acquisition.
  const [{ chromium }, capture, viteModule, probe, trace, report, adapter, budget] = await Promise.all([
    import('@playwright/test'),
    import('../capture.ts'),
    import('../native-vite.ts'),
    import('../browser-work-probe.ts'),
    import('../native-trace.ts'),
    import('../trace-observer-report.ts'),
    import('./adapter.ts'),
    import('../native-work-class-budget.ts'),
  ]);
  const store = new EvidenceStore([string(ready.capture), string(ready.fallback)]);
  let browserServer: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connect>> | undefined;
  let vite: Awaited<ReturnType<typeof viteModule.startOwnedVite>> | undefined;
  let session: Awaited<ReturnType<typeof capture.openReview>> | undefined;
  const helpers: import('../native-trace.ts').CommandRecord[] = [];
  const abort = new AbortController();
  const stop = () => abort.abort(new Error('External observer cancellation'));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  type Failure = { error: unknown; snapshot: ReturnType<typeof failureSnapshot> };
  let primary: Failure | undefined;
  const secondary: (Failure & { phase: string })[] = [];
  const retainSecondary = (phase: string, error: unknown) => {
    secondary.push({ phase, error, snapshot: failureSnapshot(error) });
  };
  let closing: Promise<void> | undefined;
  const stopOwned = async () => {
    const failures: unknown[] = [];
    for (const [phase, operation] of [
      ['browser.close', () => browser?.close()],
      ['browserServer.close', () => browserServer?.close()],
      ['vite.stop', () => vite?.stop()],
    ] satisfies [string, () => Promise<unknown> | undefined][]) {
      try {
        await trace.bounded(Promise.resolve(operation()), 10000, 'worker cleanup');
      } catch (error) {
        retainSecondary(phase, error);
        failures.push(error);
      }
    }
    try {
      store.put('worker-close.json', {
        failures: secondary.map(({ phase, snapshot }) => ({ phase, error: snapshot })),
        helpers,
        physicalSettlement: 'EXTERNAL_CONTROLLER_REQUIRED',
      });
    } catch (error) {
      retainSecondary('worker-close publication', error);
      failures.push(error);
    }
    if (failures.length) throw new AggregateError(failures, 'Worker cleanup failed', { cause: failures[0] });
  };
  const close = () => {
    closing ??= stopOwned();
    return closing;
  };
  try {
    store.put('admission-snapshot.json', receipt.raw);
    await budget.withNativeWorkClassDeadline(async (deadlineSignal) => {
      const signal = AbortSignal.any([abort.signal, deadlineSignal]);
      const phase = <T>(task: Promise<T>, ms: number, label: string) => trace.bounded(task, ms, label, signal);
      signal.throwIfAborted();
      const { raw: body } = readBytes(string(binding.assetPath), report.observerAssetSha256, 64 * 1024 * 1024);
      if (body.toString('ascii', 0, 4) !== 'glTF') throw new Error('Exact prehydrated asset differs');
      vite = await viteModule.startOwnedVite(string(ready.frozenRoot), helpers);
      signal.throwIfAborted();
      browserServer = await chromium.launchServer({ executablePath: string(binding.browser), args: capture.glArgs().args, timeout: 30000 });
      const child = browserServer.process();
      store.put('browser-launch.json', {
        kind: 'T13_BROWSER_LAUNCH_CHILD_PROCESS_V1',
        provenance: 'BrowserServer.process() ChildProcess',
        prefix: string(binding.prefix),
        pid: child.pid ?? null,
        spawnfile: child.spawnfile,
        spawnargs: [...child.spawnargs],
        at: new Date().toISOString(),
        monotonicNs: process.hrtime.bigint().toString(),
      });
      signal.throwIfAborted();
      browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 30000 });
      const cdp = await phase(browser.newBrowserCDPSession(), 10000, 'CDP');
      const version = object(await phase(cdp.send('Browser.getVersion'), 10000, 'browser version'));
      session = await phase(
        capture.openReview(browser, vite.url, report.observerScene.spec, { url: '/models/characters/thalune.glb', body }),
        240000,
        'review load',
      );
      const page = session.page,
        errors = session.errors;
      await phase(
        page.evaluate(async () => {
          await window.review.light('noon-lush');
          window.review.lod(0);
          window.review.wireframe(false);
        }),
        120000,
        'standard light',
      );
      let deviceObservation = 0;
      const observeDevice = async () => {
        const device = await page.evaluate(() => (window.review as unknown as { device(): unknown }).device());
        store.put(`device-${deviceObservation++}.json`, device);
        const actual = object(device);
        if (
          typeof actual.renderer !== 'string' ||
          !actual.renderer.includes(string(expected.rendererContains)) ||
          !actual.renderer.toLowerCase().includes('metal')
        )
          throw new Error('Observed device/backend differs from explicit expectation');
        return device;
      };
      const device = await phase(observeDevice(), 10000, 'initial device');
      if (cpus().length !== control.logicalCores) throw new Error('Expected logical core count differs');
      const rawProcesses = await phase(cdp.send('SystemInfo.getProcessInfo'), 10000, 'process info');
      store.put('process-info.json', rawProcesses);
      const processes = records(rawProcesses.processInfo).map((p) => {
        if (!Number.isInteger(p.id) || Number(p.id) < 2 || Number(p.id) > 2147483647) throw new Error('Real PID domain required');
        return { id: Number(p.id), type: string(p.type) };
      });
      const request = { prefix: binding.prefix, browserPid: browserServer.process().pid, processes, device };
      store.put('kernel-request.json', request);
      const requestHash = sha256(Buffer.from(JSON.stringify(request)));
      const release = await phase(
        (async () => {
          const path = join(string(ready.capture), 'kernel-release.json');
          while (!existsSync(path)) {
            signal.throwIfAborted();
            await new Promise((r) => setTimeout(r, 20));
          }
          // Supervisor-authenticated current identities are tied to the exact request bytes.
          const snapshot = readSnapshot(path, undefined, 65536);
          store.put('kernel-release-snapshot.json', snapshot.raw);
          return object(snapshot.value);
        })(),
        10000,
        'current kernel release',
      );
      if (
        release.prefix !== binding.prefix ||
        release.browserPid !== browserServer.process().pid ||
        release.requestSha256 !== requestHash ||
        !Array.isArray(release.rendererPids)
      )
        throw new Error('Kernel release does not match actual request');
      const rendererPids = Array.from(release.rendererPids, (pid) => {
        if (!Number.isInteger(pid) || pid <= 1 || pid > 2147483647 || !processes.some((p) => p.id === pid && p.type.toLowerCase() === 'renderer'))
          throw new Error('Invalid current renderer');
        return Number(pid);
      });
      const sources = Object.fromEntries(records(ready.sources).map((r) => [string(r.relative), string(r.sha256)]));
      const binary = records(binding.binaries).find((r) => r.path === binding.browser);
      const loadContract = object(object(ready.grant).controlledLoad);
      const pins = report.parseObserverPins({
        source: { commit: ready.head, tree: ready.tree, files: sources },
        asset: { path: binding.assetPath, sha256: report.observerAssetSha256 },
        scene: report.observerScene,
        browser: { version: string(version.product), executableSha256: string(binary?.sha256), backend: 'metal' },
        device,
        loadCondition: {
          description: 'Reserved GPU; our heavy CPU jobs quiesced. External contenders unknown, not excluded.',
          logicalCores: cpus().length,
          gpuReservation: string(loadContract.gpuReservation),
        },
        traceInitiallyIdle: true,
      });
      const ports: NativePorts = {
        trace: {
          send: (command) => ('params' in command ? cdp.send(command.method, command.params) : cdp.send(command.method)),
          on: (event, fn) => {
            if (event === 'close') cdp.on('close', fn);
            else cdp.on(event, fn);
          },
          off: (event, fn) => {
            if (event === 'close') cdp.off('close', fn);
            else cdp.off(event, fn);
          },
          disconnect: close,
        },
        pageCall: async (input) => ({ ...(await page.evaluate(probe.observerProbePageCall, input)), pageErrors: [...errors] }),
        cancel: () => page.evaluate(() => window.review.nativeWorkClassProbe('cancel')).then(() => {}),
        observeDevice,
        host: () => ({
          at: new Date().toISOString(),
          monotonicMs: performance.now(),
          logicalCores: cpus().length,
          load: loadavg(),
          errors: [...errors],
          externalContenders: 'unknown-not-excluded',
        }),
        close,
      };
      await adapter.runAdapter({ prefix: string(binding.prefix), rendererPids, pins, maxLoad: Array.from(control.maxLoad as number[]) }, ports, store, signal);
    });
  } catch (error) {
    primary = { error, snapshot: failureSnapshot(error) };
    try {
      store.put('worker-failure.json', {
        error: primary.snapshot,
        helpers,
        evidence: store.receipt(),
      });
    } catch (publication) {
      retainSecondary('worker-failure publication', publication);
    }
  } finally {
    try {
      await close();
    } catch {
      // Each stop and publication error was captured before the next operation.
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
  const terminal = () => ({
    accepted: false,
    physicalSettlement: 'EXTERNAL_CONTROLLER_REQUIRED',
    primary: primary?.snapshot ?? null,
    secondary: secondary.map(({ phase, snapshot }) => ({ phase, error: snapshot })),
    evidence: store.receipt(),
  });
  try {
    store.put('worker-terminal.json', terminal());
  } catch (error) {
    retainSecondary('worker-terminal publication', error);
  }
  if (store.failures.length || Object.keys(store.receipt().undurable).length) {
    try {
      process.stderr.write(JSON.stringify({ kind: 'T13_UNDURABLE_EVIDENCE', ...terminal() }) + '\n');
    } catch (error) {
      retainSecondary('stderr fallback', error);
    }
  }
  if (secondary.length) {
    const errors = [...(primary ? [primary.error] : []), ...secondary.map(({ error }) => error)];
    throw Object.assign(new AggregateError(errors, 'Worker failed; original cause and secondary failures retained', { cause: errors[0] }), {
      facts: terminal(),
    });
  }
  if (primary) throw primary.error;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  nativeMain(process.argv.slice(2)).catch((error) => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  });
}
