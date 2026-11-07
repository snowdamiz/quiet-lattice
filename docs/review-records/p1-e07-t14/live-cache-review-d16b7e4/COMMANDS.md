# Commands and observed exits

Commands run serially. Environments are completely specified in commands.jsonl. No package manager or native capture is invoked. Failure logs below are unabridged files; the last 20 lines are shown here.

## base-publication-red

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/publication-repro.py",
    "base-red"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2",
    "EFFECTS_REVIEW_SOURCE": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/base-source/packages/tools/src/capture/effects_packet"
  },
  "exit": 1,
  "expectedExit": 1,
  "seconds": 0.081
}
```

stdout SHA256: 3d91d585bc630b7b21fde3779734de6e27c825779a7d95379d589941955028b1; stderr SHA256: 2caae6b3db9bcfacf4746fe61838bc6343197a7eaa130fc05717e04f23f6dc32

```text
Traceback (most recent call last):
  File "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/publication-repro.py", line 41, in <module>
    assert outcome=='completed',outcome
           ^^^^^^^^^^^^^^^^^^^^
AssertionError: observer_failed
```

## head-publication-green

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/publication-repro.py",
    "head-green"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2",
    "EFFECTS_REVIEW_SOURCE": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.093
}
```

stdout SHA256: 229f61974d79a9954a54b657402b0d1d9e4ba92de677b23d4239b3e6360fbb89; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## live-controls

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/live_cache_controls.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.118
}
```

stdout SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr SHA256: fbabd9eb3de06c630da0c91c7dc7818f88227c563fe5f05d331a2e1c14548be8

## focused-prior

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/focused-prior.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.545
}
```

stdout SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr SHA256: 68e7b319cb7ca8bc8e422f2b7e9a5c4f318e16258e18a0b80df64136ab00f08f

## reuse-proof

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/reuse.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.649
}
```

stdout SHA256: 3044c86503981b710333837b8ee6b40f78de2bc2c3a334b939a32c4193761288; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## binding-closure

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/final-bindings.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 2.393
}
```

stdout SHA256: ae740461d324849662e8f6663603dadea9f79559f1116d0feeaa114f0e9f9825; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## python-cli-missing-grant

```json
{
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cli-refusal.sb",
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "-v",
    "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/caller.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 1,
  "expectedExit": 1,
  "seconds": 0.039
}
```

stdout SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr SHA256: d714e33e5895e2beb21a3b1a26cb3ade0c3f026a45ff326da54a2d0eaed06dd5

```text
# destroy posix
# destroy _abc
# clear sys.meta_path
# clear sys.modules
# destroy _frozen_importlib
# destroy codecs
# destroy encodings.aliases
# destroy _codecs
# destroy encodings.utf_8
# destroy os
# destroy _contextvars
# destroy time
# destroy _thread
# destroy sys
# destroy builtins
# destroy select
# destroy itertools
# destroy _collections
# destroy _io
# clear sys.audit hooks
```

## node-cli-missing-auth-and-hash

```json
{
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cli-refusal.sb",
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node",
    "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs",
    "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2",
    "NODE_DEBUG": "esm"
  },
  "exit": 1,
  "expectedExit": 1,
  "seconds": 0.032
}
```

stdout SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr SHA256: c555d56ccee52169e59bd491907e3277b3d70ed3bcbd7829248e46c32b1155c1

```text
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:module',
  module: ModuleWrap { synthetic: true, url: 'node:module' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:module' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
ESM 74751: async addJobsToDependencyGraph() file:///Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs ModuleJob {
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:url',
  module: ModuleWrap { synthetic: true, url: 'node:url' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:url' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
Error: Disabled/mismatched readiness
```

## node-cli-missing-grant

```json
{
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cli-refusal.sb",
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node",
    "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs",
    "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2",
    "NODE_DEBUG": "esm",
    "EFFECTS_READY_SHA256": "8cc52e23293773f38253414e74ba136719d017154cee7d7742c66a1f7851782d"
  },
  "exit": 1,
  "expectedExit": 1,
  "seconds": 0.031
}
```

stdout SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr SHA256: 4c3f9ebbc3d2edf490f9498ef6776e2a98b892941f84479c5dcbfb214d2fb2be

```text
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:module',
  module: ModuleWrap { synthetic: true, url: 'node:module' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:module' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
ESM 74752: async addJobsToDependencyGraph() file:///Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs ModuleJob {
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:url',
  module: ModuleWrap { synthetic: true, url: 'node:url' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:url' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
Error: ENOENT: no such file or directory, open '/private/tmp/egg-a2002dbc58854694880dd505416ac34d.json'
```

## node-cli-bad-readiness-binding

```json
{
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cli-refusal.sb",
    "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node",
    "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs",
    "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2",
    "NODE_DEBUG": "esm",
    "EFFECTS_READY_SHA256": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "exit": 1,
  "expectedExit": 1,
  "seconds": 0.031
}
```

stdout SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr SHA256: 4d38fd7e3e856c03343d145d6d001ea817b6ff389338e7238894ecf89d6fae00

```text
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:module',
  module: ModuleWrap { synthetic: true, url: 'node:module' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:module' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
ESM 74753: async addJobsToDependencyGraph() file:///Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs ModuleJob {
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:url',
  module: ModuleWrap { synthetic: true, url: 'node:url' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:url' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
Error: Disabled/mismatched readiness
```

## cli-refusal-checks

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/activation-checks.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.161
}
```

stdout SHA256: 8a00b938438b995aaa89893563d18225f593ffb38944d11762b7e5f290401359; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## independent-controls

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/independent-controls.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.133
}
```

stdout SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr SHA256: 2ef3511ce0918688f6fc4055ff2be319ca4df64d602ac0c06c00782ac57afe09

## mtl-signature-verify

```json
{
  "argv": [
    "/usr/bin/codesign",
    "--verify",
    "--strict",
    "-R",
    "=identifier \"com.apple.MTLCompilerService\" and anchor apple",
    "/System/Library/Frameworks/Metal.framework/Versions/A/XPCServices/MTLCompilerService.xpc/Contents/MacOS/MTLCompilerService"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.023
}
```

stdout SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## mtl-signature-metadata

```json
{
  "argv": [
    "/usr/bin/codesign",
    "-d",
    "--verbose=4",
    "-r-",
    "/System/Library/Frameworks/Metal.framework/Versions/A/XPCServices/MTLCompilerService.xpc/Contents/MacOS/MTLCompilerService"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.012
}
```

stdout SHA256: e98d2ace93cc9a0330e06baa75fe834fb8edffd1b4bba9c29f9cb62074d88733; stderr SHA256: f188a6979473ab68cd7384edef69fb6d257110af2fadef7c7c6ba40c2566e48a

## vm-binding-gap

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/vm-gap.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.191
}
```

stdout SHA256: db07d97124ec17e4317122da576ce76ebecaec6cfda49058a60ac8b62ff8ba84; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## final-source-closure

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/final-check.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 2.584
}
```

stdout SHA256: e95fcba446e4882543bcfe5ff72a50c33a488e422988bded1c8269af60c92ce2; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## final-reuse-proof

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/reuse.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.601
}
```

stdout SHA256: 3044c86503981b710333837b8ee6b40f78de2bc2c3a334b939a32c4193761288; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## diff-check

```json
{
  "argv": [
    "/usr/bin/git",
    "diff",
    "--check",
    "b151c82427a541754cec0d5143c7942271eed2b8",
    "d16b7e41b1c662cc4005a9322f60a8d3522dd219"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.021
}
```

stdout SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## final-preservation

```json
{
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/preserve.py",
    "after"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
    "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONOPTIMIZE": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "TMPDIR": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "TEMP": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/tmp",
    "XDG_CACHE_HOME": "/private/tmp/p1-e07-t14-live-independent-d7dggrsp/cache",
    "TSX_DISABLE_CACHE": "1",
    "UV_THREADPOOL_SIZE": "2",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2"
  },
  "exit": 0,
  "expectedExit": 0,
  "seconds": 0.496
}
```

stdout SHA256: 405ddb2ef6efdb00cd9884f648af9c6a9158fd32e6c64d3f0ac4b602d1bf907b; stderr SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## Retained review harness failures

Initial preservation inventory exited 1: KeyError: files at preserve.py:14. The three historical manifests have differing list/object schemas. Fixed only this new review inventory parser; no source or historical evidence changed. Original script retained as preserve-first.py.
First bespoke suite process exceeded the 50-second subprocess timeout and was killed/reaped by subprocess.run. Partial stdout/stderr was not retained by the first runner. The fixture counted unrelated scandir calls and did not restore its cache entry, allowing an inert helper wait to continue. Source was unchanged. Corrected only the scratch publisher to restore immediately after actual ENOENT and capped its real helper wait at 0.5 seconds; first script and surviving scratch are retained. This failed attempt is not counted as a passing control.

The initial timeout had no saved partial stdout/stderr; it is not represented as a passing case. Its wrapper returned exit 1 with subprocess.TimeoutExpired after 50 seconds. The revised runner streams to retained files and records timeout/kill outcomes. No additional execution of the failed harness was made.
