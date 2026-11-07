import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserWorkAdmission, captureBrowserWork } from './browser-work-probe.ts';
import { withNativeWorkClassDeadline } from './native-work-class-budget.ts';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('External cloud march diagnostic cancellation'));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  void (async () => {
    const admission = browserWorkAdmission(process.argv.slice(2));
    await withNativeWorkClassDeadline((deadlineSignal) =>
      captureBrowserWork(admission, AbortSignal.any([deadlineSignal, controller.signal]), 'cloud-march-reuse'),
    );
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
