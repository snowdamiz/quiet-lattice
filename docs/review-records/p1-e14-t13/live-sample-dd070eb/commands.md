# Exact CPU commands and exits

## initial-audit

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/audit.py
```

Exit 0; 4.020164 seconds.

## red-live-ledger

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/live-replay.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/red-live-ledger
```

Exit 1; 0.056992 seconds.

## green-live-ledger

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/live-replay.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/green-live-ledger
```

Exit 0; 0.056951 seconds.

## live-controls

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B packages/tools/src/capture/trace_observer_packet/live_controls.py
```

Exit 0; 0.100972 seconds.

## red-live-controller

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/controller-base-replay.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/red-live-controller live-writer-private
```

Exit 1; 0.114199 seconds.

## green-live-controller

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B packages/tools/src/capture/trace_observer_packet/controller_controls.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/green-live-controller live-writer-private live-writer-output live-writer-frozen
```

Exit 0; 0.239519 seconds.

## live-controls-final

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B packages/tools/src/capture/trace_observer_packet/live_controls.py
```

Exit 0; 0.181406 seconds.

## prior-boundaries

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B packages/tools/src/capture/trace_observer_packet/boundary_controls.py
```

Exit 0; 0.218183 seconds.

## prior-admission

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B packages/tools/src/capture/trace_observer_packet/controls.py
```

Exit 0; 1.0002 seconds.

## all-controller-cases

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B packages/tools/src/capture/trace_observer_packet/controller_controls.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/all-controller-cases
```

Exit 0; 3.575746 seconds.

## python-syntax

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B -c 'import ast,pathlib; [ast.parse(pathlib.Path(p).read_bytes(),filename=p) for p in ["packages/tools/src/capture/trace_observer_packet/metadata.py","packages/tools/src/capture/trace_observer_packet/launch.py","packages/tools/src/capture/trace_observer_packet/controller_controls.py","packages/tools/src/capture/trace_observer_packet/live_controls.py"]]'
```

Exit 0; 0.030076 seconds.

## scoped-format

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node node_modules/prettier/bin/prettier.cjs --check packages/tools/src/capture/trace_observer_packet/local-binding.json
```

Exit 0; 0.101241 seconds.

## diff-check

```sh
git diff --check
```

Exit 0; 0.024625 seconds.

## final-freeze

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/final-freeze.py
```

Exit 0; 16.108218 seconds.

## final-verify

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/verify-final.py
```

Exit 0; 8.882682 seconds.

## preservation-and-protected

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/preserve-final.py
```

Exit 0; 8.820947 seconds.

## closure-comparison

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/closure-compare.py
```

Exit 0; 0.102199 seconds.

## committed-diff-check

```sh
git diff 7c134b6aa29f2abedba347d91aed28323fd93006 HEAD --check
```

Exit 0; 0.011387 seconds.

## bind-metal

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/bind-metal.py
```

Exit 0; 0.077285 seconds.

## red-metal-controller

```sh
/usr/bin/env T13_BINDING=/private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/baseline-binding.json /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/assessment_controller.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/red-missing
```

Exit 1; 0.119883 seconds.

## red-metal-actual-member

```sh
/usr/bin/env T13_BINDING=/private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/baseline-binding.json /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/assessment_controller.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/red-actual-member
```

Exit 1; 0.110969 seconds.

## metal-bound

```sh
/usr/bin/env T13_BINDING=/private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/proposed-binding.json T13_MODE=bound /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/assessment_controller.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/ownership-bound
```

Exit 0; 0.135216 seconds.

## metal-missing

```sh
/usr/bin/env T13_BINDING=/private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/baseline-binding.json T13_MODE=missing /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/assessment_controller.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/ownership-missing
```

Exit 0; 0.119293 seconds.

## metal-wrong-uid

```sh
/usr/bin/env T13_BINDING=/private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/proposed-binding.json T13_MODE=wrong-uid /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/assessment_controller.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/ownership-wrong-uid
```

Exit 0; 0.113014 seconds.

## metal-wrong-birth

```sh
/usr/bin/env T13_BINDING=/private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/proposed-binding.json T13_MODE=wrong-birth /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/assessment_controller.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/ownership-wrong-birth
```

Exit 0; 0.116755 seconds.

## metal-wrong-coalition

```sh
/usr/bin/env T13_BINDING=/private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/proposed-binding.json T13_MODE=wrong-coalition /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/assessment_controller.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/ownership-wrong-coalition
```

Exit 0; 0.112702 seconds.

## metal-other-executable

```sh
/usr/bin/env T13_BINDING=/private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/proposed-binding.json T13_MODE=other-executable /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/assessment_controller.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/ownership-other-executable
```

Exit 0; 0.112702 seconds.

## metal-external-absent

```sh
/usr/bin/env T13_BINDING=/private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/proposed-binding.json T13_MODE=external-absent /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/assessment_controller.py /private/tmp/p1-e14-t13-live-sample-rktfx3l5/metal-prerequisite/ownership-external-absent
```

Exit 0; 0.146243 seconds.

## metal-format

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node node_modules/prettier/bin/prettier.cjs --check packages/tools/src/capture/trace_observer_packet/local-binding.json
```

Exit 0; 0.092416 seconds.

## metal-diff-check

```sh
git diff --check
```

Exit 0; 0.02285 seconds.

## combined-freeze

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/final-freeze.py
```

Exit 0; 16.784496 seconds.

## combined-verification

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/verify-final.py
```

Exit 0; 13.356919 seconds.

## combined-closure

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/closure-compare.py
```

Exit 0; 0.100351 seconds.

## combined-preservation

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/preserve-final.py
```

Exit 0; 8.227246 seconds.

## checkpoint-preservation

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/check-checkpoint.py
```

Exit 0; 4.060078 seconds.

## final-committed-diff

```sh
git diff 7c134b6aa29f2abedba347d91aed28323fd93006 HEAD --check
```

Exit 0; 0.009077 seconds.

## disabled-python

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/frozen-dd070eb02/source/packages/tools/src/capture/trace_observer_packet/launch.py --readiness /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/frozen-dd070eb02/readiness.json --readiness-sha256 ef0311ecabde0d5ec187fdb2f938933bcb80b44ad199abe055d73516c48bd359 --grant /private/tmp/t13-observer-grant-161689e0.json --grant-sha256 0000000000000000000000000000000000000000000000000000000000000000
```

Exit 2; 0.080445 seconds.

## disabled-worker

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node --import /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/frozen-dd070eb02/source/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/loader.mjs /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/frozen-dd070eb02/source/packages/tools/src/capture/trace_observer_packet/worker.ts --owned /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/frozen-dd070eb02/readiness.json ef0311ecabde0d5ec187fdb2f938933bcb80b44ad199abe055d73516c48bd359
```

Exit 1; 0.267514 seconds.

## launch-syntax

```sh
/bin/sh -n /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/NEXT_LAUNCH.sh
```

Exit 0; 0.00418 seconds.

