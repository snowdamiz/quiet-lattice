// Internal asset-free proof payload. Only the grant-consuming Python runner admits this file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const admissionPath = process.env.STATION_BROWSER_PROOF_ADMISSION;
if (!admissionPath || !process.env.STATION_BROWSER_PROOF_GRANT) throw Error('No proof admission/grant');
const admission = JSON.parse(fs.readFileSync(admissionPath, 'utf8'));
const ownSha = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
if (admission.authorization_id !== process.env.STATION_BROWSER_PROOF_GRANT || admission.payload_sha256 !== ownSha)
  throw Error('Proof admission binding mismatch');
// The consumed grant has a second, durable payload-start claim. A direct payload retry also refuses.
fs.writeFileSync(path.join(path.dirname(admissionPath), 'payload_started'), String(process.pid), { flag: 'wx' });
const out = path.resolve(admission.probe_output);
fs.mkdirSync(out); // Exact single output; no overwrite/retry.
const req = createRequire(path.join(process.cwd(), 'packages/tools/package.json'));
const { chromium } = req('@playwright/test');
const { glArgs } = await import(path.join(process.cwd(), 'packages/tools/src/capture/capture.ts'));
const { args, gl } = glArgs();
if (gl !== 'metal') throw Error('Expected unchanged installed Metal path');
const browser = await chromium.launch({ args });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('about:blank');
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    document.body.append(canvas);
    const g = canvas.getContext('webgl2');
    if (!g) throw Error('No WebGL2');
    g.clearColor(0, 0, 0, 1);
    g.clear(g.COLOR_BUFFER_BIT);
    g.finish();
    const ext = g.getExtension('WEBGL_debug_renderer_info');
    return { renderer: g.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : g.RENDERER),
      viewport: [1920, 1080], canvas: [1, 1], url: location.href,
      assetLoaded: false, screenshot: false, measurement: false };
  });
  const encoded = JSON.stringify(result);
  fs.writeFileSync(path.join(out, 'ready_for_kernel_receipts.json'), encoded + '\n');
  console.log('STATION_BROWSER_PROOF_BACKEND ' + encoded);
  const end = Date.now() + 5000;
  while (!fs.existsSync(path.join(out, 'kernel_receipts_ready'))) {
    if (Date.now() > end) throw Error('Kernel receipt barrier expired');
    await sleep(25);
  }
} finally {
  await browser.close();
}
