# Independent review commands and exits

All executions use the reviewed worktree as cwd and scratch TMPDIR inside this report. Exact environment overrides are retained in commands.jsonl. The direct initial setup attempt preceded the runner and is recorded separately below.

## prepare: exit 0 (1.469s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/prepare.py
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/prepare.log

## publication-red: exit 0 (0.298s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/base/publication-main.py red
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/publication-red.log

## publication-green: exit 0 (0.357s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/current/publication-main.py green
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/publication-green.log

## caller-adverse: exit 0 (0.258s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/current/adverse-main.py
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/caller-adverse.log

## metal-red: exit 0 (0.194s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/base/metal-observer.py red
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/metal-red.log

## metal-green: exit 0 (0.191s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/current/metal-observer.py green
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/metal-green.log

## independent-live: exit 1 (0.088s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/independent-live.py
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/independent-live.log

Last 20 lines:
```
            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-06487465/packages/tools/src/capture/fauna_packet/file_io.py", line 22, in require
    raise Refused(message)
fauna_file_io.Refused: Live cache enumeration remained uncertain beyond cache deadline

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/private/tmp/fauna-c2-actualnative-review-aR0aDegE/independent-live.py", line 108, in <module>
    case('late-uncertainty-precludes-resample',late)
    ~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/private/tmp/fauna-c2-actualnative-review-aR0aDegE/independent-live.py", line 12, in case
    v=fn(d,root,p,state,r,sample);assert signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0)
  File "/private/tmp/fauna-c2-actualnative-review-aR0aDegE/independent-live.py", line 106, in late
    with patch.object(c.file_io,'live_tree_usage',side_effect=AssertionError('Late sample dispatched')):e=refusal(sample,(c.Refused,),'remained uncertain')
                                                                                                          ~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/private/tmp/fauna-c2-actualnative-review-aR0aDegE/independent-live.py", line 18, in refusal
    assert hasattr(e,'cacheObservation');assert not e.cacheObservation['complete'];return e
                                                    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^
KeyError: 'complete'
```

## independent-live-v2: exit 0 (0.080s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/independent-live.py
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/independent-live-v2.log

## live-controls: exit 0 (0.194s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /Users/andreyyurlov/.t3/worktrees/space/t3-06487465/packages/tools/src/capture/fauna_packet/live_cache_controls.py
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/live-controls.log

## metal-controls: exit 0 (0.140s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /Users/andreyyurlov/.t3/worktrees/space/t3-06487465/packages/tools/src/capture/fauna_packet/metal_controls.py
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/metal-controls.log

## six-process-chain: exit 0 (2.071s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/current/sequence-independent.py
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/six-process-chain.log

## focused-contracts: exit 0 (2.348s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /Users/andreyyurlov/.t3/worktrees/space/t3-06487465/packages/tools/src/capture/fauna_packet/controls.py CallerControls.test_actual_enabled_cli_missing_authority_has_no_subprocess_helper_import_or_allocation BoundaryControls.test_actual_bootstrap_and_observer_producers_survive_helper_and_all_sink_failures BoundaryControls.test_authenticated_secondary_failure_cannot_authorize_a_successor BoundaryControls.test_failed_publication_never_authorizes_successor_at_actual_writer_and_gate BoundaryControls.test_successor_requires_parent_completion_and_exact_transaction_references
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/focused-contracts.log

## binding-and-cache: exit 0 (0.144s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/binding-check.py
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/binding-and-cache.log

## actual-browser-route: exit 0 (0.240s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --import /private/tmp/fauna-c2-actualnative-review-aR0aDegE/guard.mjs /private/tmp/fauna-c2-actualnative-review-aR0aDegE/route.mjs
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/actual-browser-route.log

## final-enabled-check: exit 0 (3.124s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /Users/andreyyurlov/.t3/worktrees/space/t3-06487465/packages/tools/src/capture/fauna_packet/caller.py --check
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/final-enabled-check.log

## final-audit: exit 0 (1.282s)

```sh
cd /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
env -u FAUNA_CAPTURE_GRANT TMPDIR=/private/tmp/fauna-c2-actualnative-review-aR0aDegE/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=0 NODE_OPTIONS= PATH=/Users/andreyyurlov/.local/share/vite-plus/bin:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/26454_1794032560708/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/andreyyurlov/.codex/tmp/arg0-macos/codex-arg0mmbALP:/Users/andreyyurlov/.codex/packages/standalone/releases/0.166.0-aarch64-apple-darwin/codex-path:/Users/andreyyurlov/.local/bin:/Users/andreyyurlov/.bun/bin:/Users/andreyyurlov/.local/state/fnm_multishells/75053_1794032395752/bin:/opt/homebrew/sbin:/Users/andreyyurlov/.local/state/fnm_multishells/93884_1793920893185/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.docker/bin:/Users/andreyyurlov/.local/share/vite-plus/fallback-bin GIT_OPTIONAL_LOCKS=0 /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/finish-audit.py
```

Log: /private/tmp/fauna-c2-actualnative-review-aR0aDegE/logs/final-audit.log

## Direct initial setup failure (reviewer assumption)

Command: `/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B /private/tmp/fauna-c2-actualnative-review-aR0aDegE/prepare.py`
Exit: 1. Tool-captured failure tail:
```
Traceback (most recent call last):
  File "/private/tmp/fauna-c2-actualnative-review-aR0aDegE/prepare.py", line 25, in <module>
    assert old[k]==ready[k],k
AssertionError: initialCacheBytes
```

The source baseline decreased by 786 bytes after the real publication. The reviewer removed the incorrect equality assumption, then independently verified current metadata equals the new readiness baseline. No source changed.

The first independent-live run failed in reviewer assertion code because its synthetic state lacked lastSample; independent-live-initial.py preserves that script. v2 creates a real prior sample before aging uncertainty. All 13 current cases then pass.

The publication-red wrapper exits 0 because it asserts that actual base main returns 1. Its structured result and raw log retain the FileNotFoundError; current main returns 0. Other actual failed-caller tests similarly assert the expected nonacceptance.

No inherited real FAUNA_CAPTURE_GRANT was supplied. Synthetic grants/receipts are confined to inert scratch repositories.
