Exact review execution commands and observed results. All cwd values refer to the pinned checkout. No pnpm, installation, browser, GPU, image decoding, service, database, hydration, source/ref change or original-evidence cleanup. Python bytecode is disabled. Only the authority-refusal pair ran concurrently; maximum two CPU jobs. All other CPU jobs ran serially.

preservation-before: exit 0; 1.831870 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-position-review-0k14whev/audit.py before
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/preservation-before.log

saved-native-red: exit 0; 0.079126 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-position-review-0k14whev/saved-red.py
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/saved-native-red.log

independent-real-source: exit 0; 0.647188 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node /private/tmp/fauna-c2-position-review-0k14whev/independent-real.mjs
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/independent-real-source.log

position-oracles: exit 0; 0.079389 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/position_controls.py /private/tmp/fauna-c2-position-review-0k14whev/tmp/fauna-position-cpu-2CDbj5/results.json
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/position-oracles.log

recorder-boundary: exit 0; 0.043632 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node /private/tmp/fauna-c2-position-review-0k14whev/recorder.mjs
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/recorder-boundary.log

real-mutation-refusals: exit 0; 2.490343 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-position-review-0k14whev/real-mutations.py
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/real-mutation-refusals.log

node-authority-refusals: exit 0; 0.236328 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --test --test-concurrency=1 '--test-name-pattern=actual enabled Node entry refuses missing consumption' packages/tools/src/capture/fauna_packet/controls.mjs
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/node-authority-refusals.log

python-authority-refusals: exit 0; 0.997277 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/controls.py CallerControls.test_actual_enabled_cli_missing_authority_has_no_subprocess_helper_import_or_allocation
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/python-authority-refusals.log

gates-and-reuse: exit 0; 3.370698 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-position-review-0k14whev/gates-reuse.py
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/gates-and-reuse.log

saved-red-native-python: exit 0; 0.088344 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10 -I -B /private/tmp/fauna-c2-position-review-0k14whev/saved-red-native-python.py
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/saved-red-native-python.log

native-python-position-oracles: exit 0; 0.079899 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10 -I -B packages/tools/src/capture/fauna_packet/position_controls.py /private/tmp/fauna-c2-position-review-0k14whev/tmp/fauna-position-cpu-2CDbj5/results.json
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/native-python-position-oracles.log

preservation-after: exit 0; 1.663156 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-position-review-0k14whev/audit.py after
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/preservation-after.log

preservation-final: exit 0; 1.462903 seconds.
Cwd: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
Environment overrides: {"GIT_OPTIONAL_LOCKS": "0", "NODE_OPTIONS": "", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONOPTIMIZE": "0", "TMPDIR": "/private/tmp/fauna-c2-position-review-0k14whev/tmp"}
Removed variables: ["FAUNA_CAPTURE_GRANT"]
```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-position-review-0k14whev/audit.py after
```
Log: /private/tmp/fauna-c2-position-review-0k14whev/logs/preservation-final.log

The runner itself is run with the installed pinned Python 3.14 -I -B. gates-reuse.py overrides PATH to the exact readiness path for actual verify_bindings; the full override is retained in gates-reuse.json. Child commands for the five real mutation cases and their exits appear in real-mutations.json. Scripts, their final source hashes, raw logs and JSON results are in manifest.json.

Initial exploratory source reads (before the exclusive log directory existed) used git status/rev-parse/diff/show, rg, cat, sed, ls and read-only Python JSON summaries. Two rg discovery calls returned exit 2 because optional .agents/AGENTS.md/CLAUDE.md and docs/PROCESS.md/docs/PLAN.md do not exist. The actual repository rules were subsequently read in docs/IMPLEMENTATION_PLAN.md 0.3, 0.9.5, C.2 and C.4. These were discovery misses, not verification failures. Full initial tool output remains in this review transcript.

The expected historical failure is captured in saved-red.json and saved-red-python3.10.json: exact old flyer_oracle raises ValueError("Authoritative local position changed") for actual 21x9-kill.png. The harness exits zero because that refusal is the asserted result. No native process was rerun. Current oracle refuses both actual old kill receipts with "Missing actual flyer draw-boundary evidence".

No reviewer test command failed. audit-initial.py preserves the version used for initial/first post-run fingerprints. The final audit adds a direct comparison of the raw inspector stderr JSON with the committed FAILED record, and reruns the protection check without changing protected files.
