# Exact source/CPU commands

Parent commands run serially alongside at most one serial timeline lane. run.py sets private TMP, no Python bytecode, Node compile cache disabled and OMP/OPENBLAS/VECLIB threads1. Direct pinned Node26.12.1 and Python3.14; decoder uses pinned Python3.10/Pillow. No dependency writes or package manager.

```json
{
  "name": "red-shape",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "/private/tmp/vm-r4-fix-rdtnxbus/red/launcher-shape.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.24065250001149252,
  "logSha256": "fe87f5be23367035ac297a4d9a293ff8ba03e002c85e029d4562b4ab0d137c27",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "module-identity",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "/private/tmp/vm-r4-fix-rdtnxbus/red/launcher-identity-control.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.24838200001977384,
  "logSha256": "bb411fc2a8df557a23e63b89125cf0a348d641b093c6ba6e576c9c8c7681a82e",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "auth-fixture",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "-m",
    "unittest",
    "test_protocol.ProtocolTests.test_actual_entry_reads_python_consumption_schema_without_dispatch",
    "-v"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.7904397089732811,
  "logSha256": "acae4dbfc7dbefeef3627559e0c02aa9f2a55e62e6c012ff141a4d9207f5a557",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "red-authenticated-entry",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r4-fix-rdtnxbus/entry-actual-red.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.3499823750462383,
  "logSha256": "20bedda98f7397a2bafe78bf8cabde1aaf06f2547094af42d7e0ac8a86bae0d1",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "red-real-module-control",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "--import",
    "/private/tmp/vm-r4-fix-rdtnxbus/fs-guard.mjs",
    "--test",
    "--test-concurrency=1",
    "packages/tools/src/capture/viewmodel_packet/production.test.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 1,
  "seconds": 0.19067208300111815,
  "logSha256": "851769d6763c9c2ea7e3dc21c005f129ef402e47934b4b9aa93eea0984d5c527",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "green-real-module-controls",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "--import",
    "/private/tmp/vm-r4-fix-rdtnxbus/fs-guard.mjs",
    "--test",
    "--test-concurrency=1",
    "packages/tools/src/capture/viewmodel_packet/production.test.mjs",
    "packages/tools/src/capture/viewmodel_packet/publication.test.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.4039745000191033,
  "logSha256": "d658e9ebf061535ea6bc91fb8bd7b95a1fd1393276eab9fa6ba3f6cf35839e04",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "VM_ENTRY_EVIDENCE": "/private/tmp/vm-r4-fix-rdtnxbus/production-real-results.json"
  }
}
```

```json
{
  "name": "green-authenticated-entry",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r4-fix-rdtnxbus/entry-green.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.8281098750303499,
  "logSha256": "5601672d16624b0de1936f2c013754c0a333c65c11d2fe10e62c48c27195a98c",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "setstore-observer",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r4-fix-rdtnxbus/setstore-observer.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.14598862500861287,
  "logSha256": "3283d14f71ac559509a91c408c3bc7568fdf94cb7e22d8ce432ecab1e0d4fcc0",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
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
    "packages/tools/src/capture/viewmodel_packet/entry.mjs",
    "packages/tools/src/capture/viewmodel_packet/production.test.mjs",
    "packages/tools/src/capture/viewmodel_packet/publication.test.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.13502116699237376,
  "logSha256": "e36c4fe83eb85b2e10d770da7d04fb1e110bd7badc1be0cbfc10592d28c8816a",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "scoped-lint",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "--import",
    "/private/tmp/vm-r4-fix-rdtnxbus/fs-guard.mjs",
    "node_modules/.pnpm/eslint@10.13.0/node_modules/eslint/bin/eslint.js",
    "packages/tools/src/capture/viewmodel_packet/entry.mjs",
    "packages/tools/src/capture/viewmodel_packet/production.test.mjs",
    "packages/tools/src/capture/viewmodel_packet/publication.test.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.41713616700144485,
  "logSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "scoped-format",
  "argv": [
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node",
    "--import",
    "/private/tmp/vm-r4-fix-rdtnxbus/fs-guard.mjs",
    "node_modules/.pnpm/prettier@3.9.10/node_modules/prettier/bin/prettier.cjs",
    "--check",
    "packages/tools/src/capture/viewmodel_packet/entry.mjs",
    "packages/tools/src/capture/viewmodel_packet/production.test.mjs",
    "packages/tools/src/capture/viewmodel_packet/publication.test.mjs"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.12741316703613847,
  "logSha256": "17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "freeze",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r4-fix-rdtnxbus/freeze.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 13.280554207973182,
  "logSha256": "1fe1de6c0da56592525a521acc5eaabf8b46f727f0124a6a4dca14d5401fd8b3",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "green-authenticated-entry-frozen",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r4-fix-rdtnxbus/entry-green-frozen.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.911028916016221,
  "logSha256": "5601672d16624b0de1936f2c013754c0a333c65c11d2fe10e62c48c27195a98c",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

```json
{
  "name": "enabled-cli",
  "argv": [
    "/opt/homebrew/opt/python@3.14/bin/python3.14",
    "-B",
    "/private/tmp/vm-r4-fix-rdtnxbus/enabled-cli.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8",
  "exit": 0,
  "seconds": 0.6213550000102259,
  "logSha256": "436fe2f887e4bc9437674ea83298901793cc52c5c74fa77d49204f2d00d90a72",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
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
  "seconds": 0.06966741604264826,
  "logSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "env": {
    "PYTHONDONTWRITEBYTECODE": "1",
    "TMPDIR": "/private/tmp/vm-r4-fix-rdtnxbus/tmp",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "VM_REVISION_TMP": "/private/tmp/vm-r4-fix-rdtnxbus/tmp"
  }
}
```

Supplemental exact RED environment/source pins are in red-control-provenance.json; decoder/commands.json includes all476 actual command rows with complete private environment and stdout/stderr hashes. RED wrapper exit0 asserts an adverse inner exit1; see each report.

Historical reused commands with exact unchanged-input/log hash proof:

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
