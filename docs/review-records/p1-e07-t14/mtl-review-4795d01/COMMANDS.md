COMMANDS — independent SOURCE/CPU review

All child verification commands ran serially in the candidate cwd with the explicit cleared environment shown below. No worker pool, package launcher, native process or service was used. `codesign` only verified the two exact protected executable routes. Each outer check has a 50-second test-runner limit; each real codesign command has a 5-second limit.

The first three observer attempts failed inside the review fixture before the boundary. Their logs and original script are preserved; none counts as baseline RED or a passing control. The v2 script changes only the assertion on retained kernel keys.

preservation-before

```json
{
  "name": "preservation-before",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/preserve.py",
    "before"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.8715,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/preservation-before.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/preservation-before.stderr",
  "stdoutSha256": "4f4807cf4859bc7465eb70e9eaf79616572ca7a4e1bebcb9a58f81c533c1b15c",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```

source-review

```json
{
  "name": "source-review",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/source_review.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.9227,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/source-review.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/source-review.stderr",
  "stdoutSha256": "c4bf40e19d772200ba8ae38bb803a483f7e01563aa4da39ab85c1a986b926c2b",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```

exact-base-observer-red

```json
{
  "name": "exact-base-observer-red",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review.py",
    "base"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 1,
  "expectedExit": 1,
  "timeout": false,
  "durationSeconds": 0.0733,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/exact-base-observer-red.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/exact-base-observer-red.stderr",
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "dc89569ab579f7c7fe715488d17c21af403531df6060642e10fcf927fa4cbe51",
  "stderrTail20": [
    "Traceback (most recent call last):",
    "  File \"/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review.py\", line 17, in <module>",
    "    assert member['kernel']=={'pid':55005,'birth':[1794046928,112755],'uid':501}",
    "           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
    "AssertionError"
  ]
}
```

exact-head-observer-green

```json
{
  "name": "exact-head-observer-green",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review.py",
    "head"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 1,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.0723,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/exact-head-observer-green.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/exact-head-observer-green.stderr",
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "dc89569ab579f7c7fe715488d17c21af403531df6060642e10fcf927fa4cbe51",
  "stderrTail20": [
    "Traceback (most recent call last):",
    "  File \"/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review.py\", line 17, in <module>",
    "    assert member['kernel']=={'pid':55005,'birth':[1794046928,112755],'uid':501}",
    "           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
    "AssertionError"
  ]
}
```

independent-observer-controls

```json
{
  "name": "independent-observer-controls",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review.py",
    "adversaries"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 1,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.0827,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/independent-observer-controls.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/independent-observer-controls.stderr",
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "dc89569ab579f7c7fe715488d17c21af403531df6060642e10fcf927fa4cbe51",
  "stderrTail20": [
    "Traceback (most recent call last):",
    "  File \"/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review.py\", line 17, in <module>",
    "    assert member['kernel']=={'pid':55005,'birth':[1794046928,112755],'uid':501}",
    "           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
    "AssertionError"
  ]
}
```

exact-base-observer-red-v2

```json
{
  "name": "exact-base-observer-red-v2",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review_v2.py",
    "base"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 1,
  "expectedExit": 1,
  "timeout": false,
  "durationSeconds": 0.2009,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/exact-base-observer-red-v2.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/exact-base-observer-red-v2.stderr",
  "stdoutSha256": "6164dd073208fcfe3777514b69d9926ed1a59be90d9f124deb4f1fcad34eb1dc",
  "stderrSha256": "3dcd10c45a120ab65fb8c662e3c7525e5b9a8f5fea0bd36b00626b509c577a7f",
  "stderrTail20": [
    "Traceback (most recent call last):",
    "  File \"/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review_v2.py\", line 84, in <module>",
    "    assert results[0]['admitted'],'Exact owned MTL member refused at actual NativePorts/StageReceipts boundary'",
    "           ~~~~~~~~~~^^^^^^^^^^^^",
    "AssertionError: Exact owned MTL member refused at actual NativePorts/StageReceipts boundary"
  ]
}
```

exact-head-observer-green-v2

```json
{
  "name": "exact-head-observer-green-v2",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review_v2.py",
    "head"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.2005,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/exact-head-observer-green-v2.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/exact-head-observer-green-v2.stderr",
  "stdoutSha256": "f200912439d4895cd689607102b55b3b5c9cbb4f834acbff4076a45ae5ed5db3",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```

independent-observer-controls-v2

```json
{
  "name": "independent-observer-controls-v2",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/observer_review_v2.py",
    "adversaries"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.1881,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/independent-observer-controls-v2.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/independent-observer-controls-v2.stderr",
  "stdoutSha256": "09dae6ca48e167aae972d297fd15bc07aae62042b998c11d6adeef8f02b929c2",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```

independent-codesign-verify

```json
{
  "name": "independent-codesign-verify",
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
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "TSX_DISABLE_CACHE": "1",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "npm_config_offline": "true",
    "npm_config_ignore_scripts": "true",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.0215,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/independent-codesign-verify.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/independent-codesign-verify.stderr",
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```

independent-codesign-metadata

```json
{
  "name": "independent-codesign-metadata",
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
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "TSX_DISABLE_CACHE": "1",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "npm_config_offline": "true",
    "npm_config_ignore_scripts": "true",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.012,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/independent-codesign-metadata.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/independent-codesign-metadata.stderr",
  "stdoutSha256": "e98d2ace93cc9a0330e06baa75fe834fb8edffd1b4bba9c29f9cb62074d88733",
  "stderrSha256": "f188a6979473ab68cd7384edef69fb6d257110af2fadef7c7c6ba40c2566e48a",
  "stderrTail20": []
}
```

signature-review

```json
{
  "name": "signature-review",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/signature_review.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.1412,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/signature-review.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/signature-review.stderr",
  "stdoutSha256": "b058d779fafa0c9d09e00c8a55423c08f7b1e2a9fd987caae25d787fd2440df5",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```

mtl-controls

```json
{
  "name": "mtl-controls",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/mtl_controls.py",
    "-v"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.1967,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/mtl-controls.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/mtl-controls.stderr",
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "47d4430731a8577594c5970c2b0633c53dab11c360306c2ab8c45061db5fc0f6",
  "stderrTail20": []
}
```

python-cli-ungranted

```json
{
  "name": "python-cli-ungranted",
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cli-refusal.sb",
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
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "TSX_DISABLE_CACHE": "1",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "npm_config_offline": "true",
    "npm_config_ignore_scripts": "true",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 1,
  "expectedExit": 1,
  "timeout": false,
  "durationSeconds": 0.0416,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/python-cli-ungranted.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/python-cli-ungranted.stderr",
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "4e901fa921ff51097c612924b9133e1d77018a6e944bb3ae0f98d46bfc8ca000",
  "stderrTail20": [
    "# destroy posix",
    "# destroy _abc",
    "# clear sys.meta_path",
    "# clear sys.modules",
    "# destroy _frozen_importlib",
    "# destroy codecs",
    "# destroy encodings.aliases",
    "# destroy _codecs",
    "# destroy encodings.utf_8",
    "# destroy os",
    "# destroy _contextvars",
    "# destroy time",
    "# destroy _thread",
    "# destroy sys",
    "# destroy builtins",
    "# destroy select",
    "# destroy itertools",
    "# destroy _collections",
    "# destroy _io",
    "# clear sys.audit hooks"
  ]
}
```

node-cli-no-hash

```json
{
  "name": "node-cli-no-hash",
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cli-refusal.sb",
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
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "TSX_DISABLE_CACHE": "1",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "npm_config_offline": "true",
    "npm_config_ignore_scripts": "true",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0",
    "NODE_DEBUG": "esm"
  },
  "exit": 1,
  "expectedExit": 1,
  "timeout": false,
  "durationSeconds": 0.043,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/node-cli-no-hash.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/node-cli-no-hash.stderr",
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "0ac8fd8d92077f897a94d71710ca770d42c7494410ccd48cb258a1528a1054b6",
  "stderrTail20": [
    "  importAttributes: [Object: null prototype] {},",
    "  isMain: false,",
    "  inspectBrk: false,",
    "  url: 'node:module',",
    "  module: ModuleWrap { synthetic: true, url: 'node:module' },",
    "  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:module' } },",
    "  linked: Promise { [Array(0): null prototype] [] },",
    "  instantiated: undefined",
    "}",
    "ESM 93026: async addJobsToDependencyGraph() file:///Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs ModuleJob {",
    "  importAttributes: [Object: null prototype] {},",
    "  isMain: false,",
    "  inspectBrk: false,",
    "  url: 'node:url',",
    "  module: ModuleWrap { synthetic: true, url: 'node:url' },",
    "  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:url' } },",
    "  linked: Promise { [Array(0): null prototype] [] },",
    "  instantiated: undefined",
    "}",
    "Error: Disabled/mismatched readiness"
  ]
}
```

node-cli-ungranted

```json
{
  "name": "node-cli-ungranted",
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cli-refusal.sb",
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
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "TSX_DISABLE_CACHE": "1",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "npm_config_offline": "true",
    "npm_config_ignore_scripts": "true",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0",
    "NODE_DEBUG": "esm",
    "EFFECTS_READY_SHA256": "6b9994549579d394b6bfa60642ab435e80308bdc74e93bd06bb52935713122b4"
  },
  "exit": 1,
  "expectedExit": 1,
  "timeout": false,
  "durationSeconds": 0.0703,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/node-cli-ungranted.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/node-cli-ungranted.stderr",
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "fcdca75c56ec5247c89037ea504328f1e1c30e9bb455361692884a416d6d0763",
  "stderrTail20": [
    "  importAttributes: [Object: null prototype] {},",
    "  isMain: false,",
    "  inspectBrk: false,",
    "  url: 'node:module',",
    "  module: ModuleWrap { synthetic: true, url: 'node:module' },",
    "  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:module' } },",
    "  linked: Promise { [Array(0): null prototype] [] },",
    "  instantiated: undefined",
    "}",
    "ESM 93033: async addJobsToDependencyGraph() file:///Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs ModuleJob {",
    "  importAttributes: [Object: null prototype] {},",
    "  isMain: false,",
    "  inspectBrk: false,",
    "  url: 'node:url',",
    "  module: ModuleWrap { synthetic: true, url: 'node:url' },",
    "  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:url' } },",
    "  linked: Promise { [Array(0): null prototype] [] },",
    "  instantiated: undefined",
    "}",
    "Error: ENOENT: no such file or directory, open '/private/tmp/egg-164a9dca1cd5400c8f734587e449adeb.json'"
  ]
}
```

node-cli-wrong-hash

```json
{
  "name": "node-cli-wrong-hash",
  "argv": [
    "/usr/bin/sandbox-exec",
    "-f",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cli-refusal.sb",
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
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "TSX_DISABLE_CACHE": "1",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "npm_config_offline": "true",
    "npm_config_ignore_scripts": "true",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0",
    "NODE_DEBUG": "esm",
    "EFFECTS_READY_SHA256": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "exit": 1,
  "expectedExit": 1,
  "timeout": false,
  "durationSeconds": 0.0466,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/node-cli-wrong-hash.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/node-cli-wrong-hash.stderr",
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "9b4e748601f58f8e54408147cd30f105d14a596ec18cb35e752d53e1c712eafc",
  "stderrTail20": [
    "  importAttributes: [Object: null prototype] {},",
    "  isMain: false,",
    "  inspectBrk: false,",
    "  url: 'node:module',",
    "  module: ModuleWrap { synthetic: true, url: 'node:module' },",
    "  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:module' } },",
    "  linked: Promise { [Array(0): null prototype] [] },",
    "  instantiated: undefined",
    "}",
    "ESM 93037: async addJobsToDependencyGraph() file:///Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs ModuleJob {",
    "  importAttributes: [Object: null prototype] {},",
    "  isMain: false,",
    "  inspectBrk: false,",
    "  url: 'node:url',",
    "  module: ModuleWrap { synthetic: true, url: 'node:url' },",
    "  modulePromise: Promise { ModuleWrap { synthetic: true, url: 'node:url' } },",
    "  linked: Promise { [Array(0): null prototype] [] },",
    "  instantiated: undefined",
    "}",
    "Error: Disabled/mismatched readiness"
  ]
}
```

cli-refusals

```json
{
  "name": "cli-refusals",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cli_refusals.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.243,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cli-refusals.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cli-refusals.stderr",
  "stdoutSha256": "0e6f09d08e0da56d0c28bada494344c415263c71a9244ee05a7a286a2a9f3fe7",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```

reuse-evidence

```json
{
  "name": "reuse-evidence",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/reuse.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.2024,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/reuse-evidence.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/reuse-evidence.stderr",
  "stdoutSha256": "c65dfdaf40aa336bda27eff83c7cf15c9e1acfe5b1ec841ccf893fcd70401500",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```

final-verification

```json
{
  "name": "final-verification",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/final_verification.py"
  ],
  "cwd": "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects",
  "environment": {
    "HOME": "/Users/andreyyurlov",
    "USER": "andreyyurlov",
    "LOGNAME": "andreyyurlov",
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
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 2.5812,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/final-verification.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/final-verification.stderr",
  "stdoutSha256": "42e1cbb28df99c5148799bf338fa7079eeb23b85ba7978a631bf8aa1e28eaed2",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```

preservation-after

```json
{
  "name": "preservation-after",
  "argv": [
    "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    "-B",
    "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/preserve.py",
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
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "TSX_DISABLE_CACHE": "1",
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "npm_config_offline": "true",
    "npm_config_ignore_scripts": "true",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
    "TMPDIR": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "TEMP": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/cpu-tmp",
    "GIT_OPTIONAL_LOCKS": "0"
  },
  "exit": 0,
  "expectedExit": 0,
  "timeout": false,
  "durationSeconds": 0.5314,
  "stdout": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/preservation-after.stdout",
  "stderr": "/private/tmp/p1-e07-t14-mtl-independent-Zl4iKI7x/preservation-after.stderr",
  "stdoutSha256": "b7e94dc9b95093bc48a129a5343132ba5d95831851a71f6de343ae924ec5c38a",
  "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrTail20": []
}
```
