# Exact CPU command records

All checks ran serially. Exact environment/cwd/argv, OS exit, seconds and stdout/stderr hashes are retained in commands.json. No real grant or native launch.

- `base-observer-red`: OS exit 1 (expected 1), 0.048s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/observer-repro.py", "base-red"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/base-observer-red.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/base-observer-red.stderr`.
- `actual-mtl-signature`: OS exit 0 (expected 0), 0.055s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "-c", "import sys,json;from pathlib import Path;sys.path.insert(0,\"packages/tools/src/capture/effects_packet\");import apple_mtl;r=apple_mtl.binding();Path(\"/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/actual-mtl-binding.json\").write_text(json.dumps(r,indent=2)+\"\\n\");print(json.dumps({\"executable\":r[\"executable\"],\"rootComponents\":len(r[\"route\"]),\"signatureExits\":[x[\"exit\"] for x in r[\"observations\"]]}))"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/actual-mtl-signature.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/actual-mtl-signature.stderr`.
- `mtl-controls`: OS exit 0 (expected 0), 0.162s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "packages/tools/src/capture/effects_packet/mtl_controls.py", "-v"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/mtl-controls.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/mtl-controls.stderr`.
- `freeze-enabled`: OS exit 0 (expected 0), 2.63s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/freeze-enabled.py"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/freeze-enabled.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/freeze-enabled.stderr`.
- `source-protection`: OS exit 0 (expected 0), 0.109s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/source-checks.py"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/source-protection.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/source-protection.stderr`.
- `actual-rebound-observer-green`: OS exit 0 (expected 0), 0.04s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/observer-repro.py", "green"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/actual-rebound-observer-green.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/actual-rebound-observer-green.stderr`.
- `mtl-controls-rebound`: OS exit 0 (expected 0), 0.141s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "packages/tools/src/capture/effects_packet/mtl_controls.py", "-v"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/mtl-controls-rebound.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/mtl-controls-rebound.stderr`.
- `final-bindings`: OS exit 0 (expected 0), 1.365s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/final-bindings.py"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/final-bindings.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/final-bindings.stderr`.
- `python-cli-missing-grant`: OS exit 1 (expected 1), 0.042s.
  - argv: `["/usr/bin/sandbox-exec", "-f", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/cli-refusal.sb", "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "-v", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/caller.py"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/python-cli-missing-grant.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/python-cli-missing-grant.stderr`.
- `node-cli-missing-auth-and-hash`: OS exit 1 (expected 1), 0.035s.
  - argv: `["/usr/bin/sandbox-exec", "-f", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/cli-refusal.sb", "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/node-cli-missing-auth-and-hash.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/node-cli-missing-auth-and-hash.stderr`.
- `node-cli-missing-grant`: OS exit 1 (expected 1), 0.035s.
  - argv: `["/usr/bin/sandbox-exec", "-f", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/cli-refusal.sb", "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/node-cli-missing-grant.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/node-cli-missing-grant.stderr`.
- `node-cli-bad-readiness-binding`: OS exit 1 (expected 1), 0.033s.
  - argv: `["/usr/bin/sandbox-exec", "-f", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/cli-refusal.sb", "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/node-cli-bad-readiness-binding.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/node-cli-bad-readiness-binding.stderr`.
- `final-source-protection`: OS exit 0 (expected 0), 0.11s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/source-checks.py"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/final-source-protection.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/final-source-protection.stderr`.
- `final-exact-member-green`: OS exit 0 (expected 0), 0.038s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/observer-repro.py", "final-green"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/final-exact-member-green.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/final-exact-member-green.stderr`.
- `all-observer-cases`: OS exit 0 (expected 0), 0.105s.
  - argv: `["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/all-observer-cases.py"]`
  - stdout: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/all-observer-cases.stdout`; stderr: `/private/tmp/p1-e07-t14-mtl-binding-q2qutcjb/all-observer-cases.stderr`.

Direct scoped Git command, observed OS exit0:
```sh
git diff -- packages/tools/src/capture/effects_packet/freeze.py
git diff --check
git add packages/tools/src/capture/effects_packet/apple_mtl.py packages/tools/src/capture/effects_packet/mtl_controls.py packages/tools/src/capture/effects_packet/freeze.py packages/tools/src/capture/effects_packet/README.md packages/tools/src/capture/effects_packet/readiness.json
git diff --cached --check
git diff --cached --stat
git commit -m "fix(effects): bind exact protected Apple Metal compiler"
git rev-parse HEAD HEAD^{tree}
git status --porcelain --untracked-files=all
```
