# Independent verification commands

Each argv ran from the exact candidate worktree. Clear environments are shown in full. The recorder is run.py; subprocess OS exits below are authoritative, not the recorder wrapper exit. Runs were serial; at most two active light CPU participants. No production native constructor or runtime was invoked.

## protection-before

OS exit 1; expected 0; elapsed 0.234059s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protect.py",
  "before"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "PYTHONPATH": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protection-before.stdout; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protection-before.stderr; SHA256 84d49fc4572538a6a854e0fd52c52769348f31292d5cbcd3cae4857101f1708f

Last 20 stderr lines (full raw log retained):
```
Traceback (most recent call last):
  File "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protect.py", line 29, in <module>
    r=contract.snapshot(P/'readiness.json')['value'];assert sha(P/'readiness.json')==hand['readiness']['sha256'];out['source']=bindings.verify(r);assert out['source']==expected
                                                                                                                               ~~~~~~~~~~~~~~~^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/bindings.py", line 57, in verify
    require(all(not os.environ.get(k) for k in ('NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'ESBUILD_BINARY_PATH', 'PLAYWRIGHT_BROWSERS_PATH')), 'Runtime override environment refused')
    ~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/contract.py", line 29, in require
    raise Refused(message)
contract.Refused: Runtime override environment refused
```

## protection-before-corrected

OS exit 0; expected 0; elapsed 2.420769s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protect.py",
  "before"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protection-before-corrected.stdout; SHA256 dfc5ce5c1db8eb685ebbe4bb1a035641df387e40bb0556e4c86340fa93079b85
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protection-before-corrected.stderr; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## root-replacement

OS exit 0; expected 0; elapsed 0.090475s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement.stdout; SHA256 845a7f47c09482b6cf6685a0f3e5200b629a286db25a27ac0f8bb91f2171f446
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement.stderr; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## root-replacement-enoent

OS exit 1; expected 0; elapsed 0.088722s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement-enoent.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement-enoent.stdout; SHA256 13ce369db80b34de456722776909b5961f3e48f1e0ba82fd384fa5bb5d11dafd
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement-enoent.stderr; SHA256 22791f8ead0a48fe1bbbbd2717d91aee42889aca2378289cc47d0300a7afcd90

Last 20 stderr lines (full raw log retained):
```
Traceback (most recent call last):
  File "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement-enoent.py", line 34, in <module>
    assert error is not None,'REVIEW FINDING: replaced required private TMP root accepted after ENOENT retry'
           ^^^^^^^^^^^^^^^^^
AssertionError: REVIEW FINDING: replaced required private TMP root accepted after ENOENT retry
```

## independent-controls

OS exit 1; expected 0; elapsed 0.463209s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/independent-controls.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/independent-controls.stdout; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/independent-controls.stderr; SHA256 aa291dc1c0fc1301ba2ba4b6799227a93762108a7bcb03d5cfcc84d60e2f386d

Last 20 stderr lines (full raw log retained):
```
ERROR: test_deadline_within_retry_yield_is_hard (__main__.Checks.test_deadline_within_retry_yield_is_hard)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/independent-controls.py", line 95, in test_deadline_within_retry_yield_is_hard
    with patch.object(os,'stat',stat),patch.object(live_cache.time,'sleep',lambda _:signal.raise_signal(signal.SIGALRM)),native_ports.phase(5),self.assertRaises(native_ports.PhaseExpired):self.p.budgets(self.j)
                                                                                                                         ~~~~~~~~~~~~~~~~~~^^^
  File "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/lib/python3.14/contextlib.py", line 148, in __exit__
    next(self.gen)
    ~~~~^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/native_ports.py", line 34, in phase
    require(not expired and time.monotonic() - start < seconds, 'Phase deadline was swallowed')
    ~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/contract.py", line 29, in require
    raise Refused(message)
contract.Refused: Phase deadline was swallowed

----------------------------------------------------------------------
Ran 10 tests in 0.381s

FAILED (errors=1)
```

## focused

OS exit 0; expected 0; elapsed 0.505428s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/focused.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/focused.stdout; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/focused.stderr; SHA256 18b55e71c3ab7ee68b59a19baaa5f4497efd0947ce596d6379753f25c413aa81

## base-head-replay

OS exit 0; expected 0; elapsed 0.664154s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/base-head-replay.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/base-head-replay.stdout; SHA256 85838c8895374874710573720feabc5fbe97822b4f1cc21c3e7b79387e58c7de
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/base-head-replay.stderr; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## cpu-success

OS exit 0; expected 0; elapsed 0.247222s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-caller.py",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-parent/config.json"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-success.stdout; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-success.stderr; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## cpu-successor

OS exit 1; expected 1; elapsed 0.086809s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-caller.py",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-parent/successor-config.json"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-successor.stdout; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-successor.stderr; SHA256 a7e1953c7788e63f231017ad6c39f29c23f040b8dba81c203b48dfb650956928

Last 20 stderr lines (full raw log retained):
```
Refused: Strict clean source HEAD required; no predecessor-artifact exemption
```

## parent-controls

OS exit 0; expected 0; elapsed 0.502207s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/parent-controls.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/parent-controls.stdout; SHA256 a462e57e1891a39539f1bd91f88d6a9bc4116d43d50c29b133b31c11aff4ad1d
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/parent-controls.stderr; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## fresh-python-cli-missing-grant

OS exit 1; expected 1; elapsed 0.044370s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/usr/bin/sandbox-exec",
  "-f",
  "/private/tmp/p1-e07-t14-live-writers-_fp4q0c1/cli-refusal.sb",
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "-v",
  "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/caller.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/fresh-python-cli-missing-grant.stdout; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/fresh-python-cli-missing-grant.stderr; SHA256 8cfea9c02c8749127d1ce4c65b6e77211cf949c4235860ab0ad6bf66b3223ba8

Last 20 stderr lines (full raw log retained):
```
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

## fresh-node-cli-missing-auth-and-hash

OS exit 1; expected 1; elapsed 0.037443s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/usr/bin/sandbox-exec",
  "-f",
  "/private/tmp/p1-e07-t14-live-writers-_fp4q0c1/cli-refusal.sb",
  "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node",
  "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs",
  "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "NODE_DEBUG": "esm",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/fresh-node-cli-missing-auth-and-hash.stdout; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/fresh-node-cli-missing-auth-and-hash.stderr; SHA256 33237e54c48f8aebd2d7040a83df315c46a7c9bdb71d0f73800a1e701ccc311c

Last 20 stderr lines (full raw log retained):
```
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:module',
  module: ModuleWrap { synthetic: true, url: 'node:module' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:module' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
ESM 77550: async addJobsToDependencyGraph() file:///Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs ModuleJob {
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

## fresh-node-cli-missing-grant

OS exit 1; expected 1; elapsed 0.036081s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/usr/bin/sandbox-exec",
  "-f",
  "/private/tmp/p1-e07-t14-live-writers-_fp4q0c1/cli-refusal.sb",
  "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node",
  "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs",
  "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "NODE_DEBUG": "esm",
  "EFFECTS_READY_SHA256": "6c8308cdc601652b22b4256a9e94c703d58c05dfd4782d0c662aec2d04e908a0",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/fresh-node-cli-missing-grant.stdout; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/fresh-node-cli-missing-grant.stderr; SHA256 c39379929aa21dbf296b3b711d21a1506ecea780747f5d092f8d4d5b5e954145

Last 20 stderr lines (full raw log retained):
```
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:module',
  module: ModuleWrap { synthetic: true, url: 'node:module' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:module' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
ESM 77552: async addJobsToDependencyGraph() file:///Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs ModuleJob {
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:url',
  module: ModuleWrap { synthetic: true, url: 'node:url' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:url' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
Error: ENOENT: no such file or directory, open '/private/tmp/egg-f06f6009cba44ce7a4ff9c027e8bc68e.json'
```

## fresh-node-cli-bad-readiness-binding

OS exit 1; expected 1; elapsed 0.038090s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/usr/bin/sandbox-exec",
  "-f",
  "/private/tmp/p1-e07-t14-live-writers-_fp4q0c1/cli-refusal.sb",
  "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node",
  "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs",
  "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "NODE_DEBUG": "esm",
  "EFFECTS_READY_SHA256": "0000000000000000000000000000000000000000000000000000000000000000",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/fresh-node-cli-bad-readiness-binding.stdout; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/fresh-node-cli-bad-readiness-binding.stderr; SHA256 3dea7f26f68d5cde06e9acb40c9a52acbc3d5e707e941f362f435da04dcd4ee8

Last 20 stderr lines (full raw log retained):
```
  importAttributes: [Object: null prototype] {},
  isMain: false,
  inspectBrk: false,
  url: 'node:module',
  module: ModuleWrap { synthetic: true, url: 'node:module' },
  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:module' } },
  linked: Promise { [Array(0): null prototype] [] },
  instantiated: undefined
}
ESM 77553: async addJobsToDependencyGraph() file:///Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs ModuleJob {
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

## cli-refusals

OS exit 0; expected 0; elapsed 0.187146s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cli-refusals.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cli-refusals.stdout; SHA256 5ec29d8a68d3ffbfb26490d4e3b2cc8a24670414d43b8dcb36a2a38d1dfa99a1
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cli-refusals.stderr; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## root-replacement-wait

OS exit 1; expected 0; elapsed 0.119848s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement-wait.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement-wait.stdout; SHA256 b5ff4fbd6843003c5fbb1253dc247846b4a430cb965e2afd890c5b800bf6c93e
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement-wait.stderr; SHA256 9c04cbd3ecf926d6d040325b29d9bfc5c39ccd1c1df8086bc7bb7f5c6875081a

Last 20 stderr lines (full raw log retained):
```
Traceback (most recent call last):
  File "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/root-replacement-wait.py", line 38, in <module>
    assert error is not None,'REVIEW FINDING: replaced required private TMP root accepted after ENOENT retry'
           ^^^^^^^^^^^^^^^^^
AssertionError: REVIEW FINDING: replaced required private TMP root accepted after ENOENT retry
```

## evidence-audit

OS exit 0; expected 0; elapsed 0.228128s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/evidence-audit.py"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/evidence-audit.stdout; SHA256 484ae776d884b94b458278a737954c26a1f680f886d65fa5214714047e81f0c5
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/evidence-audit.stderr; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## protection-after

OS exit 0; expected 0; elapsed 4.529378s.

cwd: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects

```json
[
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  "-B",
  "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protect.py",
  "after"
]
```

Environment:
```json
{
  "HOME": "/Users/andreyyurlov",
  "USER": "andreyyurlov",
  "LOGNAME": "andreyyurlov",
  "SHELL": "/bin/zsh",
  "PATH": "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
  "PYTHONDONTWRITEBYTECODE": "1",
  "PYTHONOPTIMIZE": "0",
  "OMP_NUM_THREADS": "1",
  "OPENBLAS_NUM_THREADS": "1",
  "TSX_DISABLE_CACHE": "1",
  "NODE_DISABLE_COMPILE_CACHE": "1",
  "npm_config_offline": "true",
  "npm_config_ignore_scripts": "true",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
  "TMPDIR": "/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/cpu-tmp",
  "GIT_OPTIONAL_LOCKS": "0"
}
```

stdout: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protection-after.stdout; SHA256 dfc5ce5c1db8eb685ebbe4bb1a035641df387e40bb0556e4c86340fa93079b85
stderr: /private/tmp/p1-e07-t14-writers-independent-tvcw5utk/protection-after.stderr; SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

