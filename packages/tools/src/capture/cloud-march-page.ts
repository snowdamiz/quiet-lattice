import type { CloudMarchMode } from './browser-work-trace.ts';

/** Self-contained page function; no imported runtime closure or fabricated work. */
export async function cloudMarchPageCall(input: { action: 'prepare' | 'run'; mode: CloudMarchMode; id: string }) {
  const markers: { name: string; monotonicMs: number }[] = [];
  let value: unknown,
    failure: string | null = null;
  const start = performance.mark(`${input.id}-start`);
  markers.push({ name: start.name, monotonicMs: start.startTime });
  try {
    const method: unknown = Reflect.get(window.review, 'cloudMarchProbe');
    if (typeof method !== 'function') throw new Error('Cloud march diagnostic exposure unavailable');
    value = await method.call(window.review, input.action, input.mode);
  } catch (error) {
    failure = String(error);
    value = Reflect.get(window.review, 'lastCloudMarchProbe');
  } finally {
    const end = performance.mark(`${input.id}-end`);
    markers.push({ name: end.name, monotonicMs: end.startTime });
  }
  return { value, failure, markers };
}
export async function cancelCloudMarchPage() {
  const method: unknown = Reflect.get(window.review, 'cloudMarchProbe');
  if (typeof method !== 'function') throw new Error('Cloud march diagnostic cancellation exposure unavailable');
  return method.call(window.review, 'cancel');
}
