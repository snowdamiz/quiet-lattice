# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: harness-hang.spec.ts >> a page that never answers
- Location: src/smoke/harness-hang.spec.ts:12:1

# Error details

```
Test timeout of 6000ms exceeded.
```

```
Error: page.evaluate: Target page, context or browser has been closed
Browser logs:

<launching> /Users/andreyyurlov/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,AvoidCorsURLLoaderRestartOnRedirect,Translate,AutoDeElevate,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --use-angle=metal --enable-gpu --ignore-gpu-blocklist --user-data-dir=/var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/playwright_chromiumdev_profile-LvmQT2 --remote-debugging-pipe --no-startup-window
<launched> pid=8244
[pid=8244][err] [1101/173639.119068:ERROR:ui/display/mac/cv_display_link_mac.mm:188] CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
[pid=8244][err] [1101/173639.122042:ERROR:ui/display/mac/cv_display_link_mac.mm:188] CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
[pid=8244][err] [1101/173639.317895:ERROR:ui/display/mac/cv_display_link_mac.mm:188] CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
[pid=8244][err] [1101/173639.318075:ERROR:ui/display/mac/cv_display_link_mac.mm:188] CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
[pid=8244] <process did exit: exitCode=null, signal=SIGKILL>
[pid=8244] starting temporary directories cleanup
```

```
Error: The smoke hang guard killed an unresponsive browser
```

# Test source

```ts
  1  | // `test` for every smoke spec: Playwright's, plus a guard against a page that stops answering. When a renderer is
  2  | // stuck (a stalled GPU, a spinning script) Playwright fails the test on its timeout but then waits on the browser to
  3  | // close the page, which a stuck renderer never does: one run sat 16 minutes in that wait, 90 times its test timeout.
  4  | // The guard gives the contexts `closeGraceMs` to close once the test is over, then kills the browser's process tree, so
  5  | // the test ends at its own timeout plus that grace and the failed test's worker starts over with a fresh browser.
  6  | import { execFileSync } from 'node:child_process';
  7  | import { expect, test as base, type Browser } from '@playwright/test';
  8  | 
  9  | export { expect };
  10 | 
  11 | async function browserPid(browser: Browser): Promise<number | null> {
  12 |   if (browser.browserType().name() !== 'chromium') return null;
  13 |   const cdp = await browser.newBrowserCDPSession();
  14 |   try {
  15 |     const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  16 |     const pid = processInfo.find((p) => p.type === 'browser')?.id;
  17 |     if (pid === undefined) throw new Error('The smoke hang guard could not find Chromium’s process');
  18 |     return pid;
  19 |   } finally {
  20 |     await cdp.detach();
  21 |   }
  22 | }
  23 | 
  24 | function processTree(root: number): number[] {
  25 |   const rows = execFileSync('ps', ['-Ao', 'pid=,ppid='], { encoding: 'utf8', timeout: 1000 })
  26 |     .split('\n')
  27 |     .map((l) => l.trim().split(/\s+/).map(Number))
  28 |     .filter((r) => r.length === 2 && r.every(Number.isInteger));
  29 |   const tree = [root];
  30 |   for (let i = 0; i < tree.length; i++) for (const [pid, ppid] of rows) if (ppid === tree[i]) tree.push(pid);
  31 |   return tree;
  32 | }
  33 | 
  34 | export function killProcessTree(pid: number): void {
  35 |   if (process.platform === 'win32') {
  36 |     execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 5000 });
  37 |     return;
  38 |   }
  39 |   const tree = processTree(pid).reverse();
  40 |   for (const p of tree) {
  41 |     try {
  42 |       process.kill(p, 'SIGKILL');
  43 |     } catch {
  44 |       // gone already
  45 |     }
  46 |   }
  47 | }
  48 | 
  49 | export const test = base.extend<{ closeGraceMs: number; hangGuard: void }>({
  50 |   closeGraceMs: [15_000, { option: true }],
  51 |   hangGuard: [
  52 |     // Teardown runs before the built-in context fixture. The running guard also covers afterEach hooks that call a stuck page.
  53 |     async ({ browser, context: _context, closeGraceMs }, use, info) => {
  54 |       const pid = await browserPid(browser);
  55 |       if (pid === null) return use();
  56 |       let timer: ReturnType<typeof setTimeout> | undefined;
  57 |       let killed = false;
  58 |       const arm = () => {
  59 |         timer ??= setTimeout(() => {
  60 |           killed = true;
  61 |           console.warn(`hang guard: the page did not close in time; killing the browser (pid ${pid})`);
  62 |           killProcessTree(pid);
  63 |         }, closeGraceMs);
  64 |       };
  65 |       const started = Date.now();
  66 |       const watch = setInterval(() => {
  67 |         // Read timeout each time: individual specs can change it with test.setTimeout or test.slow.
  68 |         if (info.status !== 'passed' || (info.timeout > 0 && Date.now() - started >= info.timeout)) arm();
  69 |       }, 100);
  70 |       const clear = () => {
  71 |         clearInterval(watch);
  72 |         clearTimeout(timer);
  73 |       };
  74 |       browser.once('disconnected', clear);
  75 |       try {
  76 |         await use();
  77 |         arm();
  78 |         // Include manually created contexts from multi-client specs; none may outlive the test and its guard.
  79 |         await Promise.all(browser.contexts().map((context) => context.close()));
> 80 |         if (killed) throw new Error('The smoke hang guard killed an unresponsive browser');
     |                           ^ Error: The smoke hang guard killed an unresponsive browser
  81 |       } finally {
  82 |         clear();
  83 |         browser.off('disconnected', clear);
  84 |       }
  85 |     },
  86 |     { auto: true },
  87 |   ],
  88 | });
  89 | 
```