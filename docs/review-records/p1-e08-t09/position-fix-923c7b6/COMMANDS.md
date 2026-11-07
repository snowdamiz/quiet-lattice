# Exact CPU commands and observed exits

Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465. All tests used at most two CPU workers. No codec, browser, GPU job, DB, server, install or real grant dispatch.

**saved-packet-red-v2: exit0 (0.047s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-position-fix-yuinlepd/red/saved-packet.py
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/saved-packet-red-v2.log

**real-import-probe: exit1 (0.136s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node /private/tmp/p1-e08-t09-position-fix-yuinlepd/probe-import.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/real-import-probe.log

Failure tail (retained):
```
  constructor(
    readonly R: number,
             ^^^^^^^^^
    readonly cell: number,

SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
    at parseTypeScript (node:internal/modules/typescript:57:40)
    at processTypeScriptCode (node:internal/modules/typescript:129:37)
    at Object.stripTypeScriptModuleTypes (node:internal/modules/typescript:172:22)
    at stripTypeScriptModuleTypes (node:internal/modules/esm/translators:35:49)
    at ModuleLoader.<anonymous> (node:internal/modules/esm/translators:688:29)
    at #translate (node:internal/modules/esm/loader:441:20)
    at afterLoad (node:internal/modules/esm/loader:509:29)
    at ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:514:12)
    at #getOrCreateModuleJobAfterResolve (node:internal/modules/esm/loader:567:36)
    at afterResolve (node:internal/modules/esm/loader:614:52) {
  code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX'
}

Node.js v26.12.1
```

**real-import-probe-transform: exit9 (0.024s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --experimental-transform-types /private/tmp/p1-e08-t09-position-fix-yuinlepd/probe-import.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/real-import-probe-transform.log

Failure tail (retained):
```
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node: bad option: --experimental-transform-types
```

**real-import-probe-hook: exit1 (0.042s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node /private/tmp/p1-e08-t09-position-fix-yuinlepd/probe-import-transform.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/real-import-probe-hook.log

Failure tail (retained):
```
node:internal/modules/typescript:101
  validateOneOf(mode, 'options.mode', ['strip']);
  ^

TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.mode' must be one of: 'strip'. Received 'transform'
    at stripTypeScriptTypes (node:internal/modules/typescript:101:3)
    at load (file:///private/tmp/p1-e08-t09-position-fix-yuinlepd/probe-import-transform.mjs:9:341)
    at nextStep (node:internal/modules/customization_hooks:189:26)
    at loadWithHooks (node:internal/modules/customization_hooks:374:18)
    at #loadSync (node:internal/modules/esm/loader:832:16)
    at ModuleLoader.load (node:internal/modules/esm/loader:790:26)
    at ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:501:31)
    at #getOrCreateModuleJobAfterResolve (node:internal/modules/esm/loader:567:36)
    at afterResolve (node:internal/modules/esm/loader:614:52)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:620:12) {
  code: 'ERR_INVALID_ARG_VALUE'
}

Node.js v26.12.1
```

**real-import-probe-typescript: exit0 (0.531s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node /private/tmp/p1-e08-t09-position-fix-yuinlepd/probe-import-typescript.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/real-import-probe-typescript.log

**real-position-source: exit1 (0.479s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node packages/tools/src/capture/fauna_packet/position_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/real-position-source.log

Failure tail (retained):
```
file:///Users/andreyyurlov/.t3/worktrees/space/t3-06487465/packages/tools/src/capture/fauna_packet/position_controls.mjs:55
  const camera = new THREE.PerspectiveCamera(70, width / 1080, 0.1, 1e5);
                 ^

TypeError: THREE.PerspectiveCamera is not a constructor
    at file:///Users/andreyyurlov/.t3/worktrees/space/t3-06487465/packages/tools/src/capture/fauna_packet/position_controls.mjs:55:18
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)

Node.js v26.12.1
```

**real-position-source-v2: exit0 (0.534s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node packages/tools/src/capture/fauna_packet/position_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/real-position-source-v2.log

**real-position-source-final: exit0 (0.546s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node packages/tools/src/capture/fauna_packet/position_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/real-position-source-final.log

**independent-position-oracles: exit0 (0.080s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/position_controls.py /private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp/fauna-position-cpu-oeiwOs/results.json
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/independent-position-oracles.log

**format-source: exit0 (0.143s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --write packages/tools/src/capture/fauna_packet/entry.mjs packages/tools/src/capture/fauna_packet/position_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/format-source.log

**focused-lint: exit1 (0.461s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/eslint/bin/eslint.js packages/tools/src/capture/fauna_packet/entry.mjs packages/tools/src/capture/fauna_packet/position_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/focused-lint.log

Failure tail (retained):
```

/Users/andreyyurlov/.t3/worktrees/space/t3-06487465/packages/tools/src/capture/fauna_packet/position_controls.mjs
   14:32  error  'URL' is not defined      no-undef
   31:25  error  'URL' is not defined      no-undef
   39:42  error  'URL' is not defined      no-undef
  168:1   error  'console' is not defined  no-undef

✖ 4 problems (4 errors, 0 warnings)

```

**prior-python-controls: exit0 (14.011s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/controls.py CallerControls CacheSnapshotControls BoundaryControls InspectorControls.test_broad_actual_frames_and_feed_are_required InspectorControls.test_actual_frame_and_feed_receipts_are_required InspectorControls.test_actual_displayed_instance_not_source_position
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/prior-python-controls.log

**real-position-final-formatted: exit0 (0.640s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node packages/tools/src/capture/fauna_packet/position_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/real-position-final-formatted.log

**actual-default-consumer: exit0 (0.246s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node packages/tools/src/capture/fauna_packet/capture_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/actual-default-consumer.log

**prior-node-controls: exit0 (0.465s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --test --test-concurrency=1 packages/tools/src/capture/fauna_packet/controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/prior-node-controls.log

**packet-contract: exit0 (0.084s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-position-fix-yuinlepd/packet-contract.py
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/packet-contract.log

**final-position-oracles: exit0 (0.088s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/position_controls.py /private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp/fauna-position-cpu-OwEJio/results.json
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/final-position-oracles.log

**final-lint: exit0 (0.195s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/eslint/bin/eslint.js packages/tools/src/capture/fauna_packet/entry.mjs packages/tools/src/capture/fauna_packet/position_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/final-lint.log

**freeze-fresh: exit0 (3.329s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-position-fix-yuinlepd/freeze-fresh.py
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/freeze-fresh.log

**format-readiness: exit0 (0.081s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --write packages/tools/src/capture/fauna_packet/readiness.json
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/format-readiness.log

**readiness-check: exit0 (1.623s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-position-fix-yuinlepd/check-ready.py
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/readiness-check.log

**removal-gate: exit0 (0.087s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node packages/tools/src/gates/removed.ts
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/removal-gate.log

**final-authority-refusals: exit0 (0.879s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/controls.py CallerControls.test_actual_enabled_cli_missing_authority_has_no_subprocess_helper_import_or_allocation
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/final-authority-refusals.log

**final-format: exit0 (0.134s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --check packages/tools/src/capture/fauna_packet/README.md packages/tools/src/capture/fauna_packet/readiness.json packages/tools/src/capture/fauna_packet/entry.mjs packages/tools/src/capture/fauna_packet/position_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/final-format.log

**final-bound-position-oracles: exit0 (0.080s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/position_controls.py /private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp/fauna-position-cpu-OwEJio/results.json
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/final-bound-position-oracles.log

**freeze-final: exit0 (3.218s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-position-fix-yuinlepd/freeze-final.py
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/freeze-final.log

**format-final-readiness: exit0 (0.131s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --write packages/tools/src/capture/fauna_packet/readiness.json
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/format-final-readiness.log

**preservation-precommit: exit0 (0.918s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-position-fix-yuinlepd/verify.py
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/preservation-precommit.log

**final-readiness-check: exit0 (2.886s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-position-fix-yuinlepd/check-final-ready.py
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/final-readiness-check.log

**commit-source: exit0 (0.141s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 git commit -m 'P1.E08.T09: audit flyer positions at the draw boundary'
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/commit-source.log

**first-unit-gate: exit0 (0.145s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-position-fix-yuinlepd/first-unit-gate.py
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/first-unit-gate.log

**preservation-committed: exit0 (0.660s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-position-fix-yuinlepd/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-position-fix-yuinlepd/verify.py
```
Full log: /private/tmp/p1-e08-t09-position-fix-yuinlepd/logs/preservation-committed.log

The first manual saved-packet probe incorrectly expected both kill stills to fail. It exited1 on the 16:9 case, which has a4.22e-10m delta and passes the old1e-9 threshold. Its original script and initial empty stdout file remain; stderr was visible in tool output, not redirected. The revised probe separately expects the 16:9 pass and21:9 refusal. A first logger invocation refused to overwrite that existing stdout pathname (FileExistsError, exit1) and used a fresh label. No old evidence was overwritten.

Node26 strip-only imports rejected an actual TypeScript parameter property; the transform flag and transform mode were unavailable. The final CPU test uses the installed TypeScript transpileModule in process and loads actual sources. A preliminary test imported the CJS three namespace as ESM (constructor error); the final test resolves the installed public ESM export. The first focused lint exposed missing URL/console imports; those were fixed. These were control-development failures, not additional native attempts. All raw logs remain.

Freeze uses the original pinned PATH, PYTHONOPTIMIZE=0 and removes NODE_OPTIONS/FAUNA_CAPTURE_GRANT. Its existing CPU self-identity probe and read-only codesign/hash/cache-owner probes run unchanged; no capture executable is launched. Exact actual launcher/app-bundle identities, commands and hashes are in readiness.json. check-final-ready.py and ready-check-final-result.json record the full --check invocation/env.

Source staging used exactly the seven paths in FINAL.json. No-bytecode compilation and git diff --check are in verify.py. The commit command and exit are listed above. The post-commit first-unit gate is an expected refusal from real Git status with82 retained failed outputs; it does not create or read a new grant.
