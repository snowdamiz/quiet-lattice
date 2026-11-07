import { dispatchBrowserDiagnostic, observerProbePageCall } from '../browser-work-probe.ts';
import { ObserverError, type ObserverOptions, type ObserverPacket } from '../browser-work-trace.ts';
import { observerDigest, observerProtocol, observerScene, parseObserverPins, type ObserverPins } from '../trace-observer-report.ts';
import { bounded } from '../native-trace.ts';
import { EvidenceStore } from './evidence.ts';

export interface NativePorts {
  trace: ObserverOptions['trace'];
  pageCall(input: Parameters<typeof observerProbePageCall>[0]): Promise<unknown>;
  cancel(): Promise<void>;
  observeDevice(): Promise<unknown>;
  host():
    | Promise<{ at: string; monotonicMs: number; logicalCores: number; load: number[]; errors: unknown[]; externalContenders: 'unknown-not-excluded' }>
    | { at: string; monotonicMs: number; logicalCores: number; load: number[]; errors: unknown[]; externalContenders: 'unknown-not-excluded' };
  close(): Promise<void>;
}
export interface AdapterAdmission {
  prefix: string;
  rendererPids: number[];
  pins: ObserverPins;
  maxLoad: number[];
}
/** Actual adapter boundary used by the native worker and CPU controls. It never infers physical settlement. */
export async function runAdapter(admission: AdapterAdmission, ports: NativePorts, store: EvidenceStore, signal: AbortSignal) {
  let traceChunk = 0;
  let hostObservation = 0;
  let cutoff = false;
  let packet: ObserverPacket | null = null;
  let primary: unknown = null;
  const cleanup: string[] = [];
  try {
    const pins = parseObserverPins(admission.pins);
    packet = await dispatchBrowserDiagnostic({
      protocol: observerProtocol,
      prefix: admission.prefix,
      rendererPids: admission.rendererPids,
      pins,
      signal,
      trace: ports.trace,
      probe: {
        call: (action, workClass, id, arm) => ports.pageCall({ action, workClass, id, arm }),
        cancel: () => ports.cancel(),
      },
      observe: async () => {
        const host = await ports.host();
        if (cutoff) throw new Error('Host replied after detached adapter cutoff');
        store.put(`host-${hostObservation++}.json`, host);
        const device = await ports.observeDevice();
        if (cutoff) throw new Error('Device replied after detached adapter cutoff');
        const raw = { ...host, device, pinsSha256: observerDigest({ ...pins, device }), loadCondition: pins.loadCondition, scene: observerScene };
        // Returned raw facts are retained by the dispatcher's owned observation before its cancellation check.
        if (
          host.logicalCores !== pins.loadCondition.logicalCores ||
          host.load.length !== 3 ||
          admission.maxLoad.length !== 3 ||
          Array.from({ length: 3 }, (_, i) => i).some(
            (i) =>
              !Object.hasOwn(host.load, i) ||
              !Object.hasOwn(admission.maxLoad, i) ||
              !Number.isFinite(admission.maxLoad[i]) ||
              admission.maxLoad[i] < 0 ||
              !Number.isFinite(host.load[i]) ||
              host.load[i] < 0 ||
              host.load[i] > admission.maxLoad[i],
          )
        )
          raw.errors = [...raw.errors, 'Controlled load exceeded or missing'];
        return raw;
      },
      sink: {
        retainStep: (index, action, raw) => store.put(`step-${index}-${action}.json`, raw),
        appendTrace: (index, bytes) => store.put(`trace-${index}-${traceChunk++}.json.part`, bytes),
      },
      retainReport: (value) => store.put('packet.json', value),
    });
  } catch (error) {
    primary = error;
    if (error instanceof ObserverError) packet = structuredClone(error.evidence);
  } finally {
    cutoff = true;
    try {
      await bounded(ports.close(), 30000, 'adapter close');
    } catch (error) {
      cleanup.push(String(error));
    }
  }
  const result = {
    packet,
    primary: primary === null ? null : String(primary),
    cleanup,
    physicalSettlement: 'EXTERNAL_CONTROLLER_REQUIRED',
    evidence: store.receipt(),
    accepted: false,
  };
  // This is a second detached fact, never a mutation of a published dispatcher packet.
  try {
    store.put('adapter-terminal.json', result);
  } catch (error) {
    cleanup.push(String(error));
  }
  if (primary !== null || cleanup.length || store.failures.length || packet?.status !== 'observed') throw new AdapterFailure(structuredClone(result), store);
  return packet;
}
export class AdapterFailure extends Error {
  constructor(
    readonly facts: unknown,
    readonly store: EvidenceStore,
  ) {
    super('Native observer adapter failed; physical controller must settle');
  }
}
