# Exact source/CPU commands

All commands run serially in the isolated task checkout. Node is direct 26.12.1; Python uses -B. run.py records the exact argv/environment, observed OS exit and full log SHA256. Its source also fixes OMP/OPENBLAS/VECLIB threads to one. Tests create only fresh CPU scratch fixtures.

```json
{
  "name": "baseline",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r3-fix-bpmhg9qg/baseline.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 8.569546874961816,
  "logSha256": "40e6284baaa5aef7a43fbf53c6870e038ee0e7304b457c2e9a72adfa71f4babb",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "red-native-chain",
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/vm-r3-fix-bpmhg9qg/readonly.sb",
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r3-fix-bpmhg9qg/red/native-chain-process.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.6536669579800218,
  "logSha256": "5e1b6961e87e0b48bcd14e59a27619796e1f99be42186ff6c9e676e0389f6be5",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "receipt-stock-first",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r3-fix-bpmhg9qg/python-controls.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 4.966603500011843,
  "logSha256": "6c82e3925512a29ee3d356bbc790e9b9d0474c19c4305708911456f8e536109c",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "protocol-first",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "packages/tools/src/capture/viewmodel_packet",
    "-p",
    "test_protocol.py",
    "-v"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 4.4312254170072265,
  "logSha256": "2e5202eb2fdb23ce80350ffea25b77921bc6f96e037ec8189ba37a33fad2d60b",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "activation-node",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "--import",
    "/private/tmp/vm-r3-fix-bpmhg9qg/fs-guard.mjs",
    "--test",
    "--test-concurrency=1",
    "packages/tools/src/capture/viewmodel_packet/entry.test.mjs",
    "packages/tools/src/capture/viewmodel_packet/publication.test.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.47434120904654264,
  "logSha256": "40bc564dcbdcd4e9b41d923e964fab509889afdcaf78960f8a73fc98d3d8f416",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "activation-python",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r3-fix-bpmhg9qg/python-controls.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 4.604874457989354,
  "logSha256": "fe21ca438be31d61a2bde1fd70a1c602c6ef435060e428e53026aeb80c8f8163",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "apple-encoder-signature",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r3-fix-bpmhg9qg/encoder-proof.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.07390799996210262,
  "logSha256": "47d20354096c382356b4ac4cb56ffb8408da0f04bfac4b9bd5327d43a41afc1b",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "encoder-controls",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "packages/tools/src/capture/viewmodel_packet",
    "-p",
    "test_encoder.py",
    "-v"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.1847353329649195,
  "logSha256": "fb326ff65c1d4ce735962687c6b257dc31de75c22c57fc9c6b58141986be0975",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "protocol-final",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "packages/tools/src/capture/viewmodel_packet",
    "-p",
    "test_protocol.py",
    "-v"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 5.134112250001635,
  "logSha256": "d784562f81b484435fa012373b8cd0334126e40c65b85a31d7b1dca3ad4db9ff",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "r2-regression",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "packages/tools/src/capture/viewmodel_packet",
    "-p",
    "test_r2.py",
    "-v"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.5320983330020681,
  "logSha256": "f4b0a4adbda84ac4d0abd66a3a6ee733ba102df8d8b0f8e67b02e1b209d25fb0",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "node-full",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "--import",
    "/private/tmp/vm-r3-fix-bpmhg9qg/fs-guard.mjs",
    "--test",
    "--test-concurrency=1",
    "packages/tools/src/capture/viewmodel_packet/entry.test.mjs",
    "packages/tools/src/capture/viewmodel_packet/fixture.test.mjs",
    "packages/tools/src/capture/viewmodel_packet/production.test.mjs",
    "packages/tools/src/capture/viewmodel_packet/publication.test.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.533997166028712,
  "logSha256": "4c707248a5b2d8ed8a542a8eb390f899443685f673fb7d271632b87b8d3a34a6",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "combined",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "--import",
    "/private/tmp/vm-r3-fix-bpmhg9qg/fs-guard.mjs",
    "--test",
    "--test-concurrency=1",
    "/private/tmp/vm-r3-fix-bpmhg9qg/combined-graph-probe.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.13657629099907354,
  "logSha256": "4295ae55cf993a3bc7f15820b9515248c7cfeb158d40d6b4c0aa986e97de17d1",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "VM_ENTRY_EVIDENCE": "/private/tmp/vm-r3-fix-bpmhg9qg/combined-results.json"
  }
}
```

```json
{
  "name": "green-native-chain",
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/vm-r3-fix-bpmhg9qg/readonly.sb",
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r3-fix-bpmhg9qg/green/native-chain-process.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.5999253339832649,
  "logSha256": "ae09c43d29f1dcdd87680eb524a458ee49003244bcd99787378936926c2b529a",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "format-source",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "node_modules/.pnpm/prettier@3.9.10/node_modules/prettier/bin/prettier.cjs",
    "--write",
    "packages/tools/src/capture/viewmodel_packet/README.md"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.0774370830040425,
  "logSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "lint-source",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "--import",
    "/private/tmp/vm-r3-fix-bpmhg9qg/fs-guard.mjs",
    "node_modules/.pnpm/eslint@10.13.0/node_modules/eslint/bin/eslint.js",
    "packages/tools/src/capture/viewmodel_packet/entry.mjs",
    "packages/tools/src/capture/viewmodel_packet/entry.test.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.35830266698030755,
  "logSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "format-check",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "--import",
    "/private/tmp/vm-r3-fix-bpmhg9qg/fs-guard.mjs",
    "node_modules/.pnpm/prettier@3.9.10/node_modules/prettier/bin/prettier.cjs",
    "--check",
    "packages/tools/src/capture/viewmodel_packet/entry.mjs",
    "packages/tools/src/capture/viewmodel_packet/entry.test.mjs",
    "packages/tools/src/capture/viewmodel_packet/README.md",
    "packages/tools/src/capture/viewmodel_packet/inventory.json"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.13766345800831914,
  "logSha256": "17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "freeze-enabled",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r3-fix-bpmhg9qg/freeze.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 12.369170666963328,
  "logSha256": "10c5c926654b46b4f984b5221518b59dcad7283389e1203da99ff58ee4153df6",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "protocol-frozen",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "packages/tools/src/capture/viewmodel_packet",
    "-p",
    "test_protocol.py",
    "-v"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 4.862711124995258,
  "logSha256": "72acf479fc09700482fb52888d9a32bbd626d7d1aa604ceafc66685773e5979b",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "diff-check",
  "argv": [
    "git",
    "diff",
    "--check"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.025485249992925674,
  "logSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

```json
{
  "name": "enabled-cli",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r3-fix-bpmhg9qg/enabled-cli.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.627972292015329,
  "logSha256": "436fe2f887e4bc9437674ea83298901793cc52c5c74fa77d49204f2d00d90a72",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r3-fix-bpmhg9qg/tmp"
  }
}
```

Decoder command/CLI records and all raw failures: decoder/commands.json, decoder/REPORT.txt and per-case invocation/result files in the evidence archive. Reused commands below have exact unchanged input/log hash proof in freeze.json; these are historical executions.

```json
{
  "name": "shared-lifecycle",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "/private/tmp/vm-r2-fix-pern8y1v/tools.config.mjs",
    "--configLoader",
    "native",
    "--maxWorkers",
    "1",
    "--no-fileParallelism",
    "--no-cache",
    "--no-fsModuleCache",
    "--fsModuleCachePath",
    "/private/tmp/vm-r2-fix-pern8y1v/shared-module-cache",
    "src/capture/capture.lifecycle.test.ts"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.7533312920131721,
  "logSha256": "5fc52e155e558adc2149b65472be86e5e53c5828c3fd41f3933d8509340a9495",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r2-fix-pern8y1v/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r2-fix-pern8y1v/tmp",
    "NODE_OPTIONS": "--import=/private/tmp/vm-r2-fix-pern8y1v/fs-guard.mjs"
  }
}
```

```json
{
  "name": "client-runtime",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "/private/tmp/vm-r2-fix-pern8y1v/client.config.mjs",
    "--configLoader",
    "native",
    "--maxWorkers",
    "1",
    "--no-fileParallelism",
    "--no-cache",
    "--no-fsModuleCache",
    "--fsModuleCachePath",
    "/private/tmp/vm-r2-fix-pern8y1v/client-module-cache",
    "src/entities",
    "src/exosuit.test.js",
    "src/Game.test.js"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 12.540616041980684,
  "logSha256": "23cb62847d0c013a486781f9bb88b5c3d3811808582c9fa3798fa74b94917031",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r2-fix-pern8y1v/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r2-fix-pern8y1v/tmp",
    "NODE_OPTIONS": "--import=/private/tmp/vm-r2-fix-pern8y1v/fs-guard.mjs"
  }
}
```

```json
{
  "name": "typecheck",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r2-fix-pern8y1v/typechecks.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 10.0186992919771,
  "logSha256": "f696d7af280bcbd35defaa68f4556cd9a378ae536476a727dec7bdfec4985575",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r2-fix-pern8y1v/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r2-fix-pern8y1v/tmp",
    "NODE_OPTIONS": "--import=/private/tmp/vm-r2-fix-pern8y1v/fs-guard.mjs"
  }
}
```
