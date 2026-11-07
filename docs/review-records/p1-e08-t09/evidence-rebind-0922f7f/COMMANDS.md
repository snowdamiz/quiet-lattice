# Exact commands and outcomes
All work ran serially on the bound macOS checkout. No capture, codec, browser, service, grant, fetch, install or cleanup was run. The original source CPU proof is reused by SHA256, not rerun.

## pre-stage: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
python3 -B /private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/prepare-evidence.py
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.139669s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/pre-stage.log`.

## stage-lfs: exit 1

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
python3 -B /private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/stage-evidence.py
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.087296s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/stage-lfs.log`.

Last 20 lines:
```
Traceback (most recent call last):
  File "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/stage-evidence.py", line 7, in <module>
    assert not (p.exists() and os.access(p,os.X_OK)),f'Unexpected active hook: {p}'
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Unexpected active hook: /Users/andreyyurlov/Documents/dev/space/.git/hooks/post-commit
```

## stage-lfs-verified-hook: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
python3 -B /private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/stage-evidence.py
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.800362s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/stage-lfs-verified-hook.log`.

## evidence-commit: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
git commit -m 'P1.E08.T09: retain failed attempt3 packet and provenance'
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.135798s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/evidence-commit.log`.

## rebind: exit 1

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/rebind.py
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.047923s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/rebind.log`.

Last 20 lines:
```
Traceback (most recent call last):
  File "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/rebind.py", line 4, in <module>
    old=json.loads((B/'readiness-before.json').read_text());assert sys.executable==old['python']
                                                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError
```

## rebind-canonical-launcher: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/rebind.py
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 3.515277s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/rebind-canonical-launcher.log`.

## readiness-format: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --write packages/tools/src/capture/fauna_packet/readiness.json
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.135172s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/readiness-format.log`.

## provenance: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
python3 -B /private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/provenance.py
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.291557s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/provenance.log`.

## fresh-readiness-check: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/check-final-ready.py
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 1.782112s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/fresh-readiness-check.log`.

## python-authority-only: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/controls.py CallerControls.test_actual_enabled_cli_missing_authority_has_no_subprocess_helper_import_or_allocation
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.908121s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/python-authority-only.log`.

## node-authority-only: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --test --test-concurrency=1 '--test-name-pattern=actual enabled Node entry refuses missing consumption' packages/tools/src/capture/fauna_packet/controls.mjs
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.247971s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/node-authority-only.log`.

## rebind-commit: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
python3 -B /private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/commit-rebind.py
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.260054s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/rebind-commit.log`.

## final-preservation-admission: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/verify-final.py
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 3.616882s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/final-preservation-admission.log`.

## final-format: exit 0

CWD: `/Users/andreyyurlov/.t3/worktrees/space/t3-06487465`

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --check packages/tools/src/capture/fauna_packet/readiness.json
```

Environment overrides: `{"PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": "/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/tmp"}`

Elapsed: 0.080342s. Log: `/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/logs/final-format.log`.
