# Exact CPU commands and observed exits

All commands ran in /Users/andreyyurlov/.t3/worktrees/space/t3-06487465. Small serial controls or at most two CPU workers; no native capture/codec/application service launched. Fixtures create their own scratch repos and inert receipts, never prospective real paths.

**red-publication-main: exit 0 (0.257s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/red/publication-main.py red
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/red-publication-main.log

**green-publication-main: exit 0 (0.361s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/green/publication-main.py green
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/green-publication-main.log

**live-cache-controls: exit 0 (0.135s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/live_cache_controls.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/live-cache-controls.log

**prior-python-controls: exit 0 (18.661s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/controls.py CallerControls CacheSnapshotControls BoundaryControls
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/prior-python-controls.log

**prepare-evidence: exit 0 (0.147s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/prepare-evidence.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/prepare-evidence.log

**final-green-publication: exit 0 (0.404s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/final-green/publication-main.py green
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/final-green-publication.log

**final-green-adverse: exit 0 (0.257s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/final-green/adverse-main.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/final-green-adverse.log

**prior-node-controls: exit 0 (0.424s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --test --test-concurrency=1 packages/tools/src/capture/fauna_packet/controls.mjs
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/prior-node-controls.log

**six-process-sequence: exit 0 (1.821s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/final-green/sequence-independent.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/six-process-sequence.log

**actual-default-consumer: exit 0 (0.248s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node packages/tools/src/capture/fauna_packet/capture_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/actual-default-consumer.log

**removal-gate-node26: exit 0 (0.084s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node packages/tools/src/gates/removed.ts
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/removal-gate-node26.log

**focused-lint: exit 0 (0.488s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/eslint/bin/eslint.js packages/tools/src/capture/fauna_packet/entry.mjs packages/tools/src/capture/fauna_packet/controls.mjs packages/tools/src/capture/fauna_packet/capture_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/focused-lint.log

**freeze-fresh: exit 0 (3.689s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/freeze-fresh.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/freeze-fresh.log

**ready-check: exit 0 (1.613s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/check-ready.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/ready-check.log

**final-authority-refusals: exit 0 (0.947s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/controls.py CallerControls.test_actual_enabled_cli_missing_authority_has_no_subprocess_helper_import_or_allocation CallerControls.test_exact_owned_apple_encoder_freeze_closure
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/final-authority-refusals.log

**focused-format: exit 1 (0.200s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --check packages/tools/src/capture/fauna_packet/README.md packages/tools/src/capture/fauna_packet/readiness.json packages/tools/src/capture/fauna_packet/entry.mjs packages/tools/src/capture/fauna_packet/controls.mjs packages/tools/src/capture/fauna_packet/capture_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/focused-format.log

Failure tail (retained):
```
Checking formatting...
[warn] packages/tools/src/capture/fauna_packet/readiness.json
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```

**format-ready: exit 0 (0.081s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --write packages/tools/src/capture/fauna_packet/readiness.json
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/format-ready.log

**preservation-precommit: exit 1 (0.572s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/verify.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/preservation-precommit.log

Failure tail (retained):
```
Traceback (most recent call last):
  File "/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/verify.py", line 42, in <module>
    if '/assets/renders/ui/' in path:assert not list(Path(path).iterdir()),path
                                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465/assets/renders/ui/fauna-packet-fauna-hit-turn-day-16x9-e194193234574f3ba4fdc997c9c4edd5
```

**metal-observer-red: exit 0 (0.178s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/metal-observer.py red
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/metal-observer-red.log

**metal-binding-controls: exit 0 (0.133s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/metal_controls.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/metal-binding-controls.log

**freeze-final-metal: exit 0 (3.525s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/freeze-final-metal.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/freeze-final-metal.log

**format-final-ready: exit 0 (0.136s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --write packages/tools/src/capture/fauna_packet/readiness.json
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/format-final-ready.log

**metal-observer-green: exit 0 (0.196s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/metal-observer.py green
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/metal-observer-green.log

**preservation-final-precommit: exit 0 (0.583s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/verify.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/preservation-final-precommit.log

**final-format: exit 0 (0.136s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node_modules/prettier/bin/prettier.cjs --check packages/tools/src/capture/fauna_packet/README.md packages/tools/src/capture/fauna_packet/readiness.json packages/tools/src/capture/fauna_packet/entry.mjs packages/tools/src/capture/fauna_packet/controls.mjs packages/tools/src/capture/fauna_packet/capture_controls.mjs
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/final-format.log

**ready-final-check: exit 0 (3.295s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/check-final-ready.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/ready-final-check.log

**final-cli-refusals: exit 0 (1.102s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B packages/tools/src/capture/fauna_packet/controls.py CallerControls.test_actual_enabled_cli_missing_authority_has_no_subprocess_helper_import_or_allocation
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/final-cli-refusals.log

**commit-source: exit 0 (0.242s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 git commit -m 'P1.E08.T09: sample live cache publication and bind owned Metal compiler'
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/commit-source.log

**preservation-committed: exit 0 (0.541s)**
```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env TMPDIR=/private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/tmp PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/verify.py
```
Full log: /private/tmp/p1-e08-t09-live-cache-fix-pvt58_0f/logs/preservation-committed.log

`red-publication-main` exit0 means the actual saved caller failed with the expected ENOENT. It is RED, not successful capture. `final-green-adverse` exit0 asserts actual caller return1 with every sink failed and primary/raw facts retained. `metal-observer-red` exit0 asserts the missing-binding refusal. `preservation-precommit` exit1 was an evidence-check assumption: spent output has an empty `_frames/` directory, not an empty root. No old file was removed. Initial format exit1 was fixed by formatting current readiness; all raw logs remain.

The existing freeze function was used with the prior pinned PATH, PYTHONOPTIMIZE=0, and NODE_OPTIONS/FAUNA_CAPTURE_GRANT removed. It executes only its short CPU self-process identity probe, static hashes, read-only codesign and cache-owner checks. Exact arguments are in freeze-final-metal.py, readiness.json and ready-check-final-result.json. No dependency installation or native entry dispatch occurred.

Additional preparation commands: `python3.14 -I -B prepare-evidence.py`, `python3.14 -I -B prepare-metal-freeze.py` (both exit0); source staging used exactly the seven changed paths in FINAL.json. `git diff --cached --check`, no-bytecode Python compilation in verify.py, and final clean Git status all passed. Initial read-only codesign display and parent-route stat probe exited0; the final exact signed observation is retained in readiness.json.
