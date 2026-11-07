# Focused commands and observed exits

All commands ran in `/Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8`. Python uses `-B` and `PYTHONDONTWRITEBYTECODE=1`; fixture TMPDIR is this packet’s `tmp/`. Exact argv, environment, times and exits are in commands.jsonl.

Initial protection (before run-one.py existed): `PYTHONDONTWRITEBYTECODE=1 python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/preserve.py before` — exit 0; result in preservation-before.json.

## sampler-windows

```sh
python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/sampler-windows.py
```

Exit 0; 0.084317 seconds. Full stdout/stderr: `sampler-windows.stdout`, `sampler-windows.stderr`.

## strict-windows

```sh
python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/strict-windows.py
```

Exit 0; 0.08792 seconds. Full stdout/stderr: `strict-windows.stdout`, `strict-windows.stderr`.

## controller-before-stat

```sh
env T13_DELETE_WINDOW=before-stat python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-review.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-before-stat
```

Exit 0; 0.142067 seconds. Full stdout/stderr: `controller-before-stat.stdout`, `controller-before-stat.stderr`.

## controller-after-open-positive

```sh
env T13_DELETE_WINDOW=after-open T13_REVIEW_CASE=positive /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-review.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-after-open-positive
```

Exit 0; 0.14514 seconds. Full stdout/stderr: `controller-after-open-positive.stdout`, `controller-after-open-positive.stderr`.

## controller-close-profile-positive

```sh
env T13_DELETE_WINDOW=close-profile T13_REVIEW_CASE=positive /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-review.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-close-profile-positive
```

Exit 0; 0.207208 seconds. Full stdout/stderr: `controller-close-profile-positive.stdout`, `controller-close-profile-positive.stderr`.

## controller-after-open-late-fifo

```sh
env T13_DELETE_WINDOW=after-open T13_REVIEW_CASE=late-fifo /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-review.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-after-open-late-fifo
```

Exit 0; 0.1346 seconds. Full stdout/stderr: `controller-after-open-late-fifo.stdout`, `controller-after-open-late-fifo.stderr`.

## controller-after-open-late-unreadable

```sh
env T13_DELETE_WINDOW=after-open T13_REVIEW_CASE=late-unreadable /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-review.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-after-open-late-unreadable
```

Exit 0; 0.192313 seconds. Full stdout/stderr: `controller-after-open-late-unreadable.stdout`, `controller-after-open-late-unreadable.stderr`.

## controller-after-open-terminal-eio

```sh
env T13_DELETE_WINDOW=after-open T13_REVIEW_CASE=terminal-eio /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-review.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-after-open-terminal-eio
```

Exit 0; 0.148742 seconds. Full stdout/stderr: `controller-after-open-terminal-eio.stdout`, `controller-after-open-terminal-eio.stderr`.

## controller-after-open-namespace-unsafe

```sh
env T13_DELETE_WINDOW=after-open T13_REVIEW_CASE=namespace-unsafe /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-review.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-after-open-namespace-unsafe
```

Exit 0; 0.136451 seconds. Full stdout/stderr: `controller-after-open-namespace-unsafe.stdout`, `controller-after-open-namespace-unsafe.stderr`.

## controller-after-open-live-eio

```sh
env T13_DELETE_WINDOW=after-open T13_REVIEW_CASE=live-eio /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-review.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-after-open-live-eio
```

Exit 0; 0.128994 seconds. Full stdout/stderr: `controller-after-open-live-eio.stdout`, `controller-after-open-live-eio.stderr`.

## effects-audit

```sh
python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/effects-audit.py
```

Exit 0; 0.145813 seconds. Full stdout/stderr: `effects-audit.stdout`, `effects-audit.stderr`.

## existing-focused-controls

```sh
python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/existing-controls.py
```

Exit 0; 0.14445 seconds. Full stdout/stderr: `existing-focused-controls.stdout`, `existing-focused-controls.stderr`.

## controller-profile-clock-ended

```sh
env T13_DELETE_WINDOW=close-profile T13_PROFILE_CLOCK_CASE=ended python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-profile-clock.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-profile-clock-ended
```

Exit 0; 0.191515 seconds. Full stdout/stderr: `controller-profile-clock-ended.stdout`, `controller-profile-clock-ended.stderr`.

## controller-profile-clock-live

```sh
env T13_DELETE_WINDOW=close-profile T13_PROFILE_CLOCK_CASE=still-live python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-profile-clock.py /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/controller-profile-clock-live
```

Exit 0; 0.196708 seconds. Full stdout/stderr: `controller-profile-clock-live.stdout`, `controller-profile-clock-live.stderr`.

## evidence-verification

```sh
python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/verify-evidence.py
```

Exit 0; 0.140274 seconds. Full stdout/stderr: `evidence-verification.stdout`, `evidence-verification.stderr`.

## preservation-after

```sh
python3 -B /private/tmp/p1-e14-t13-profile-review-YxPuZ68D/preserve.py after
```

Exit 0; 1.199458 seconds. Full stdout/stderr: `preservation-after.stdout`, `preservation-after.stderr`.

