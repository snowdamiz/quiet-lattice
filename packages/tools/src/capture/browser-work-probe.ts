// Candidate-only browser diagnostic. Never calls the native recorder or standard perf/capture entry points.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type BrowserServer } from '@playwright/test';
import { glArgs, openReview } from './capture.ts';
import { startOwnedVite } from './native-vite.ts';
import { bounded, type CommandRecord } from './native-trace.ts';
import { withNativeWorkClassDeadline } from './native-work-class-budget.ts';
import { saveNativeOutputs } from './native-pass-probe.ts';
import { BrowserWorkError, categoryReplyBytes, isRecord, runBrowserWorkTrace, type WorkClass } from './browser-work-trace.ts';
import { validateControl, validatePreparation } from './browser-work-report.ts';
import { cloudModeForId, validateCloudMarch } from './cloud-march-report.ts';
import { cloudMarchPageCall, cancelCloudMarchPage } from './cloud-march-page.ts';
import type { BrowserDiagnosticProtocol } from './browser-work-trace.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const frozenThalune = Object.freeze({
  spec: 'characters/thalune:thalune/thalune_suit2',
  light: 'noon-lush',
  sha256: 'dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27',
});
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
export function retainBrowserStep(out: string, id: string, value: unknown) {
  if (!/^bwt-[a-f0-9]{32}-s\d{2}-(prepare|run)$/.test(id)) throw new Error('Invalid raw step identity');
  const directory = join(out, 'steps');
  mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const cap = 16 * 1024 * 1024;
  if (bytes.length > cap) {
    writeFileSync(join(directory, `${id}.json.prefix`), bytes.subarray(0, cap), { flag: 'wx' });
    writeFileSync(join(directory, `${id}.overflow.json`), JSON.stringify({ bytes: bytes.length, sha256: sha(bytes), retainedBytes: cap, complete: false }), {
      flag: 'wx',
    });
    throw new Error('Raw step receipt byte overflow; prefix/hash retained');
  }
  writeFileSync(join(directory, `${id}.json`), bytes, { flag: 'wx' });
}

/** Public ChildProcess facts only; ownership remains the caller's current-kernel observation. */
export function retainBrowserLaunch(out: string, prefix: string, child: ReturnType<BrowserServer['process']>) {
  const value = {
    kind: 'T13_BROWSER_LAUNCH_CHILD_PROCESS_V1',
    provenance: 'BrowserServer.process() ChildProcess',
    prefix,
    pid: child.pid ?? null,
    spawnfile: child.spawnfile,
    spawnargs: [...child.spawnargs],
    at: new Date().toISOString(),
    monotonicNs: process.hrtime.bigint().toString(),
  };
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const path = join(out, 'browser-launch.json');
  if (bytes.length > 65536) {
    writeFileSync(path + '.prefix', bytes.subarray(0, 65536), { flag: 'wx' });
    writeFileSync(path + '.overflow.json', JSON.stringify({ bytes: bytes.length, sha256: sha(bytes), retainedBytes: 65536 }), { flag: 'wx' });
    throw new Error('Browser launch receipt byte overflow; prefix/hash retained');
  }
  // Publish the complete receipt atomically and exclusively; observers never parse an in-flight write.
  writeFileSync(path + '.writing', bytes, { flag: 'wx', mode: 0o600 });
  linkSync(path + '.writing', path);
  unlinkSync(path + '.writing');
  return value;
}

/** Terminal evidence snapshots are separate from the final capture/cleanup verdict. */
export function retainBrowserCheckpoint(out: string, name: 'before-browser-teardown' | 'returned-trace-evidence', value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const path = join(out, `${name}.json`);
  const cap = 64 * 1024 * 1024;
  if (bytes.length > cap) {
    writeFileSync(path + '.prefix', bytes.subarray(0, cap), { flag: 'wx' });
    writeFileSync(path + '.overflow.json', JSON.stringify({ bytes: bytes.length, sha256: sha(bytes), retainedBytes: cap, complete: false }), { flag: 'wx' });
    throw new Error('Browser checkpoint byte overflow; prefix/hash retained');
  }
  writeFileSync(path + '.writing', bytes, { flag: 'wx', mode: 0o600 });
  linkSync(path + '.writing', path);
  unlinkSync(path + '.writing');
}

function observeBrowserExit(out: string, child: ReturnType<BrowserServer['process']>, cleanupErrors: string[]) {
  const path = join(out, 'browser-child-events.jsonl');
  writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
  let events = 0;
  const record = (kind: string, value: unknown) => {
    if (++events > 8) {
      if (events === 9) cleanupErrors.push('Public browser child observation count overflow');
      return;
    }
    try {
      appendFileSync(
        path,
        JSON.stringify({ kind, pid: child.pid ?? null, at: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString(), value }) + '\n',
      );
    } catch (error) {
      cleanupErrors.push(`Public browser child observation: ${String(error)}`);
    }
  };
  const exited = (code: number | null, signal: string | null) => record('exit', { code, signal });
  const closed = (code: number | null, signal: string | null) => record('close', { code, signal });
  const error = (value: Error) => record('error', String(value).slice(0, 4096));
  child.on('exit', exited);
  child.on('close', closed);
  child.on('error', error);
  record('observation-started', { exitCode: child.exitCode, signalCode: child.signalCode });
  return () => {
    child.off('exit', exited);
    child.off('close', closed);
    child.off('error', error);
    record('observation-ended', { exitCode: child.exitCode, signalCode: child.signalCode });
  };
}

/** Retain the returned CDP JSON value, not an inferred category capability or wire packet. */
export async function observeBrowserCategories(options: { out: string; send: () => Promise<unknown>; pageErrors: () => unknown; cleanupErrors: string[] }) {
  const requested = { at: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString() };
  const retain = (response: unknown, protocolFailure: string | null) => {
    const observation = {
      method: 'Tracing.getCategories',
      requested,
      received: { at: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString() },
      representation: 'Complete returned CDP JSON value, not wire bytes',
      response,
      protocolFailure,
      pageErrors: options.pageErrors(),
    };
    const bytes = Buffer.from(JSON.stringify(observation, null, 2) + '\n');
    const path = join(options.out, 'protocol-categories.json');
    if (bytes.length > categoryReplyBytes) {
      writeFileSync(path + '.prefix', bytes.subarray(0, categoryReplyBytes), { flag: 'wx' });
      writeFileSync(path + '.overflow.json', JSON.stringify({ bytes: bytes.length, sha256: sha(bytes), retainedBytes: categoryReplyBytes, complete: false }), {
        flag: 'wx',
      });
      throw new Error('Category protocol receipt byte overflow; prefix/hash retained');
    }
    writeFileSync(path + '.writing', bytes, { flag: 'wx', mode: 0o600 });
    linkSync(path + '.writing', path);
    unlinkSync(path + '.writing');
  };
  let response: unknown;
  try {
    response = await options.send();
  } catch (error) {
    try {
      retain(null, String(error));
    } catch (persistence) {
      options.cleanupErrors.push(`Category failure receipt: ${String(persistence)}`);
    }
    throw error;
  }
  // Deliberately inside the owned send promise: even a returned value during cancellation is retained.
  retain(response, null);
  return response;
}

/** Runs in the page. Marks bracket the unchanged accepted operation, not a guessed native execution interval. */
export async function browserProbePageCall(input: { action: 'prepare' | 'run'; workClass: WorkClass; id: string }) {
  const markers: { name: string; monotonicMs: number }[] = [];
  let failure: string | null = null;
  let value: unknown;
  const start = performance.mark(`${input.id}-start`);
  markers.push({ name: start.name, monotonicMs: start.startTime });
  try {
    value = await window.review.nativeWorkClassProbe(input.action, input.workClass);
  } catch (error) {
    failure = String(error);
    value = window.review.lastNativeWorkClassProbe;
  } finally {
    const end = performance.mark(`${input.id}-end`);
    markers.push({ name: end.name, monotonicMs: end.startTime });
  }
  return { value, failure, markers };
}

export function browserWorkAdmission(args: string[]) {
  const { values } = parseArgs({ args, options: { admission: { type: 'string' }, out: { type: 'string' } }, strict: true });
  if (!values.admission || !values.out) throw new Error('Required task-owned --admission and fresh --out; runtime grant is closed by default');
  const admissionPath = resolve(values.admission),
    out = resolve(values.out);
  const value: unknown = JSON.parse(readFileSync(admissionPath, 'utf8'));
  if (
    !isRecord(value) ||
    value.purpose !== 'T13_BROWSER_WORK_ONLY' ||
    value.out !== out ||
    value.cwd !== ROOT.replace(/\/$/, '') ||
    typeof value.prefix !== 'string' ||
    !/^bwt-[a-f0-9]{32}$/.test(value.prefix) ||
    value.prefix !== process.env.T13_BROWSER_WORK_ADMISSION ||
    typeof value.assetPath !== 'string' ||
    !isRecord(value.inputs) ||
    !Array.isArray(value.rendererPids)
  )
    throw new Error('Invalid task-owned browser admission');
  // Renderer IDs are supplied by the later current-kernel handshake, never by this prelaunch file.
  if (value.rendererPids.length) throw new Error('Prelaunch renderer identities must be empty');
  const inputs: Record<string, string> = {};
  for (const [path, expected] of Object.entries(value.inputs)) {
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || sha(readFileSync(path)) !== expected)
      throw new Error(`Admission input changed: ${path}`);
    inputs[path] = expected;
  }
  const body = readFileSync(value.assetPath);
  if (sha(body) !== frozenThalune.sha256 || body.toString('ascii', 0, 4) !== 'glTF') throw new Error('Frozen Thalune input changed/not hydrated');
  if (existsSync(out)) throw new Error('EEXIST: browser diagnostic output must be fresh');
  return { out, admissionPath, prefix: value.prefix, assetPath: value.assetPath, inputs, body };
}
function ids(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.processInfo)) throw new Error('Missing browser process info');
  return value.processInfo.map((p) => {
    if (!isRecord(p) || typeof p.id !== 'number' || !Number.isSafeInteger(p.id) || p.id <= 1 || typeof p.type !== 'string')
      throw new Error('Invalid browser process identity');
    return { id: p.id, type: p.type };
  });
}
export async function captureBrowserWork(
  admission: ReturnType<typeof browserWorkAdmission>,
  outerSignal: AbortSignal,
  protocol: BrowserDiagnosticProtocol = 'frame-output',
) {
  if (protocol !== 'frame-output' && protocol !== 'cloud-march-reuse') throw new Error('Unknown fixed browser diagnostic protocol');
  if (platform() !== 'darwin' || glArgs().gl !== 'metal') throw new Error('This frozen diagnostic requires macOS/Metal');
  writeFileSync(admission.admissionPath + '.claimed', admission.prefix, { flag: 'wx' });
  mkdirSync(admission.out);
  const save = (name: string, value: unknown) => writeFileSync(join(admission.out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const helpers: CommandRecord[] = [],
    cleanupErrors: string[] = [],
    errors: string[] = [],
    host: unknown[] = [];
  const counts: unknown[] = [];
  const cancellation = new AbortController();
  const signal = AbortSignal.any([outerSignal, cancellation.signal]);
  const pending = new Set<Promise<unknown>>();
  const phase = async <T>(task: Promise<T>, ms: number, label: string) => {
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    try {
      return await bounded(task, ms, label, signal);
    } catch (error) {
      cancellation.abort(error);
      throw error;
    }
  };
  let vite: Awaited<ReturnType<typeof startOwnedVite>> | undefined;
  let browserServer: BrowserServer | undefined, browser: Browser | undefined;
  let session: Awaited<ReturnType<typeof openReview>> | undefined;
  let failure: string | null = null;
  let evidence: unknown = null;
  let traceSettlement: 'not-returned' | 'returned' | 'error-returned' | 'error-without-evidence' = 'not-returned';
  let stopChildObservation: (() => void) | undefined;
  const pageErrors = () => ({
    total: session?.errors.length ?? 0,
    retained: session?.errors.slice(0, 128).map((e) => e.slice(0, 4096)) ?? [],
    dropped: Math.max(0, (session?.errors.length ?? 0) - 128),
    truncatedMessages: session?.errors.filter((e) => e.length > 4096).length ?? 0,
  });
  // A failure receipt is secondary to the already observed page/protocol failure.
  const retainFailureStep = (id: string, value: unknown) => {
    try {
      retainBrowserStep(admission.out, id, value);
    } catch (error) {
      cleanupErrors.push(`Failure receipt ${id}: ${String(error)}`);
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let stage = 'startup';
  const checkpoint = (name: 'before-browser-teardown' | 'returned-trace-evidence') =>
    retainBrowserCheckpoint(admission.out, name, {
      diagnosticOnly: true,
      checkpoint: name,
      protocol,
      finalAcceptance: 'NOT_EVALUATED',
      at: new Date().toISOString(),
      monotonicNs: process.hrtime.bigint().toString(),
      traceSettlement,
      evidence,
      failure,
      cleanupErrors: [...cleanupErrors],
      errors: [...errors],
      pageErrors: pageErrors(),
      counts: [...counts],
      host: [...host],
      scope: 'Only already returned or known facts; not a final cleanup, loss, completeness or performance verdict',
    });
  let closing: Promise<void> | undefined;
  const closeBrowser = () =>
    (closing ??= (async () => {
      try {
        checkpoint('before-browser-teardown');
      } catch (error) {
        // The collector may still owe its primary protocol/timeout error. Never replace it.
        cleanupErrors.push(`Before browser teardown checkpoint: ${String(error)}`);
      }
      if (browser) {
        const close = browser.close({ reason: 'T13 diagnostic terminal cleanup' });
        try {
          await bounded(close, 30000, 'browser close');
        } catch (error) {
          cleanupErrors.push(String(error));
          if (browserServer) await browserServer.kill();
        }
        await close.catch((error) => cleanupErrors.push(`Browser close settlement: ${String(error)}`));
      }
      if (browserServer) {
        const close = browserServer.close();
        try {
          await bounded(close, 30000, 'browser server close');
        } catch (error) {
          cleanupErrors.push(String(error));
          await browserServer.kill();
        }
        await close.catch((error) => cleanupErrors.push(`Browser server settlement: ${String(error)}`));
      }
    })());
  const cancelPage = async () => {
    if (!session || session.page.isClosed()) return;
    // Closing the realm also interrupts a preparation whose unchanged warm-up is still in flight.
    const cancelled =
      protocol === 'cloud-march-reuse'
        ? session.page.evaluate(cancelCloudMarchPage)
        : session.page.evaluate(() => window.review.nativeWorkClassProbe('cancel'));
    void cancelled.catch(() => {});
    const closed = session.page.close({ runBeforeUnload: false });
    try {
      await bounded(closed, 10000, 'diagnostic page close');
    } catch (error) {
      cleanupErrors.push(String(error));
      await closeBrowser();
    }
    await Promise.allSettled([cancelled, closed]);
  };
  const check = () => {
    signal.throwIfAborted();
    for (const [path, expected] of Object.entries(admission.inputs)) if (sha(readFileSync(path)) !== expected) throw new Error(`Source/input changed: ${path}`);
    if (sha(readFileSync(admission.assetPath)) !== frozenThalune.sha256) throw new Error('Frozen asset changed');
  };
  const sampleHost = () => {
    if (host.length >= 256) throw new Error('Host observation cap exceeded');
    host.push({ at: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString(), phase: stage, load: loadavg(), logicalCores: cpus().length });
  };
  try {
    check();
    sampleHost();
    timer = setInterval(() => {
      try {
        sampleHost();
      } catch (error) {
        errors.push(String(error));
      }
    }, 5000);
    vite = await startOwnedVite(ROOT, helpers);
    signal.throwIfAborted();
    const { args } = glArgs();
    browserServer = await chromium.launchServer({ args, timeout: 30000 });
    signal.throwIfAborted();
    retainBrowserLaunch(admission.out, admission.prefix, browserServer.process());
    stopChildObservation = observeBrowserExit(admission.out, browserServer.process(), cleanupErrors);
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 30000 });
    signal.throwIfAborted();
    const cdp = await phase(browser.newBrowserCDPSession(), 10000, 'browser CDP');
    const browserVersion: unknown = await phase(cdp.send('Browser.getVersion'), 10000, 'browser version');
    stage = 'review-load';
    session = await phase(
      openReview(browser, vite.url, frozenThalune.spec, { url: '/models/characters/thalune.glb', body: admission.body }),
      240000,
      'review load',
    );
    await phase(
      session.page.evaluate(async () => {
        await window.review.light('noon-lush');
        window.review.lod(0);
        window.review.wireframe(false);
      }),
      120000,
      'review light',
    );
    const processes = ids(await phase(cdp.send('SystemInfo.getProcessInfo'), 10000, 'browser process info'));
    const browserPid = browserServer.process().pid;
    const request = { prefix: admission.prefix, browserPid, processes, at: new Date().toISOString() };
    save('kernel-request.json', request);
    stage = 'kernel-admission';
    await phase(
      (async () => {
        const path = join(admission.out, 'kernel-release.json');
        while (!existsSync(path)) {
          signal.throwIfAborted();
          await new Promise((r) => setTimeout(r, 20));
        }
        const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (
          !isRecord(value) ||
          value.prefix !== admission.prefix ||
          value.browserPid !== browserPid ||
          !Array.isArray(value.rendererPids) ||
          !value.rendererPids.length ||
          !value.rendererPids.every((pid) => typeof pid === 'number' && processes.some((p) => p.id === pid && p.type.toLowerCase() === 'renderer'))
        )
          throw new Error('Kernel receipt handshake does not match actual owned browser/renderer IDs');
        return value.rendererPids.filter((v): v is number => typeof v === 'number');
      })(),
      10000,
      'kernel receipts',
    ).then(async (rendererPids) => {
      check();
      stage = 'browser-diagnostic';
      const page = session?.page;
      if (!page) throw new Error('Review session missing');
      save('context.json', {
        protocol,
        browserVersion,
        browserPid,
        processes,
        rendererPids,
        viteUrl: vite?.url,
        args,
        frozenThalune,
        inputSha256: admission.inputs,
      });
      writeFileSync(join(admission.out, 'browser-trace.json'), '', { flag: 'wx' });
      let traceFailure: { error: unknown } | null = null;
      try {
        evidence = await runBrowserWorkTrace({
          protocol,
          prefix: admission.prefix,
          rendererPids,
          signal,
          trace: {
            send: (command) =>
              command.method === 'Tracing.getCategories'
                ? observeBrowserCategories({ out: admission.out, send: () => cdp.send('Tracing.getCategories'), pageErrors, cleanupErrors })
                : 'params' in command
                  ? cdp.send(command.method, command.params)
                  : cdp.send(command.method),
            on: (event, fn) => {
              if (event === 'close') cdp.on('close', fn);
              else cdp.on(event, fn);
            },
            off: (event, fn) => {
              if (event === 'close') cdp.off('close', fn);
              else cdp.off(event, fn);
            },
            disconnect: closeBrowser,
          },
          probe: {
            call: async (action, workClass, id) => {
              if (session?.errors.length) {
                const error = new Error(`Review page errors before issuance: ${session.errors.slice(0, 128).join('; ')}`);
                retainFailureStep(id, {
                  action,
                  workClass,
                  id,
                  response: null,
                  notIssued: true,
                  pageErrors: pageErrors(),
                  at: new Date().toISOString(),
                });
                throw error;
              }
              check();
              try {
                const response =
                  protocol === 'cloud-march-reuse'
                    ? await page.evaluate(cloudMarchPageCall, { action, mode: cloudModeForId(id), id })
                    : await page.evaluate(browserProbePageCall, { action, workClass, id });
                return { ...response, pageErrors: pageErrors() };
              } catch (error) {
                retainFailureStep(id, {
                  action,
                  workClass,
                  id,
                  response: null,
                  protocolFailure: String(error),
                  pageErrors: pageErrors(),
                  at: new Date().toISOString(),
                });
                throw error;
              }
            },
            cancel: cancelPage,
          },
          sink: {
            append: (bytes) => appendFileSync(join(admission.out, 'browser-trace.json'), bytes),
            read: () => readFileSync(join(admission.out, 'browser-trace.json')),
            retainStep: (index, action, workClass, id, raw) => {
              // Keep returned predicates and accumulated errors before any schema/readiness/work assertion.
              retainBrowserStep(admission.out, id, { index, action, workClass, response: raw, pageErrors: pageErrors(), at: new Date().toISOString() });
            },
            validateStep: (_index, action, workClass, _id, raw) => {
              if (isRecord(raw) && raw.failure === null) {
                if (protocol === 'cloud-march-reuse') validateCloudMarch(raw.value, action, cloudModeForId(_id), workClass);
                else if (action === 'prepare') validatePreparation(raw.value, workClass);
                else validateControl(raw.value, workClass);
              }
              if (session?.errors.length) throw new Error(`Review page errors: ${session.errors.slice(0, 128).join('; ')}`);
            },
            retainSample: (index, workClass, value) => {
              const counted =
                protocol === 'cloud-march-reuse'
                  ? validateCloudMarch(value, 'run', cloudModeForId(`${admission.prefix}-s${String(index).padStart(2, '0')}-run`), workClass)
                  : validateControl(value, workClass);
              counts.push({ index, workClass, ...counted });
              const dir = join(admission.out, `control-${String(index).padStart(2, '0')}`);
              mkdirSync(dir);
              saveNativeOutputs(protocol === 'cloud-march-reuse' && isRecord(value) ? value.native : value, dir);
              writeFileSync(join(dir, 'report.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
            },
          },
        });
        traceSettlement = 'returned';
      } catch (error) {
        failure = String(error);
        if (error instanceof BrowserWorkError) {
          evidence = error.evidence;
          traceSettlement = 'error-returned';
        } else traceSettlement = 'error-without-evidence';
        traceFailure = { error };
      }
      try {
        checkpoint('returned-trace-evidence');
      } catch (error) {
        if (traceFailure === null) throw error;
        cleanupErrors.push(`Returned trace evidence checkpoint: ${String(error)}`);
      }
      if (traceFailure !== null) throw traceFailure.error;
    });
    check();
    if (errors.length) throw new Error(errors.join('; '));
  } catch (error) {
    failure = String(error);
    cancellation.abort(error);
    if (error instanceof BrowserWorkError) evidence = error.evidence;
  } finally {
    if (timer) clearInterval(timer);
    try {
      await cancelPage();
    } catch (error) {
      cleanupErrors.push(`Page cancellation: ${String(error)}`);
    }
    try {
      await closeBrowser();
    } catch (error) {
      cleanupErrors.push(`Browser teardown: ${String(error)}`);
    }
    try {
      await vite?.stop();
    } catch (error) {
      cleanupErrors.push(`Vite teardown: ${String(error)}`);
    }
    await Promise.allSettled([...pending]);
    stopChildObservation?.();
    if (signal.aborted) failure ??= String(signal.reason);
    save('helpers.json', helpers);
    save('host.json', host);
    save('counts.json', counts);
    save('result.json', {
      diagnosticOnly: true,
      protocol,
      status: failure || cleanupErrors.length ? 'FAILED' : 'OBSERVED',
      failure,
      cleanupErrors,
      evidence,
      errors,
      pageErrors: pageErrors(),
      terminalAt: new Date().toISOString(),
      runnerPid: process.pid,
      qualification:
        'Browser-scoped traced observations only. No exact temporal equivalence, exclusive GPU cost, native service, asset regression or unprofiled budget verdict.',
    });
  }
  if (failure || cleanupErrors.length) throw new Error(failure ?? cleanupErrors.join('; '));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('External browser diagnostic cancellation'));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  void (async () => {
    const admission = browserWorkAdmission(process.argv.slice(2));
    await withNativeWorkClassDeadline((deadlineSignal) => captureBrowserWork(admission, AbortSignal.any([deadlineSignal, controller.signal])));
  })()
    .catch((error) => {
      process.stderr.write(String(error) + '\n');
      process.exitCode = 1;
    })
    .finally(() => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    });
}
