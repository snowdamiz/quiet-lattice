# Exact commands and observed exits

## effects-audit

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/effects-audit.py
```

Exit 0; 0.103099 seconds.

## sampler-windows

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/sampler-windows.py
```

Exit 0; 0.100121 seconds.

## controller-before-stat

```sh
/usr/bin/env T13_DELETE_WINDOW=before-stat /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-before-stat
```

Exit 1; 0.028719 seconds.

## controller2-before-stat

```sh
/usr/bin/env T13_DELETE_WINDOW=before-stat /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller2-before-stat
```

Exit 0; 0.150564 seconds.

## controller2-after-stat

```sh
/usr/bin/env T13_DELETE_WINDOW=after-stat /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller2-after-stat
```

Exit 0; 0.139322 seconds.

## controller2-after-open

```sh
/usr/bin/env T13_DELETE_WINDOW=after-open /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller2-after-open
```

Exit 0; 0.149143 seconds.

## controller2-before-scandir

```sh
/usr/bin/env T13_DELETE_WINDOW=before-scandir /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller2-before-scandir
```

Exit 0; 0.134988 seconds.

## controller2-during-scandir

```sh
/usr/bin/env T13_DELETE_WINDOW=during-scandir /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller2-during-scandir
```

Exit 0; 0.137902 seconds.

## controller2-after-scandir

```sh
/usr/bin/env T13_DELETE_WINDOW=after-scandir /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller2-after-scandir
```

Exit 0; 0.142575 seconds.

## controller2-before-final-fstat

```sh
/usr/bin/env T13_DELETE_WINDOW=before-final-fstat /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller2-before-final-fstat
```

Exit 0; 0.141629 seconds.

## controller2-rename-held

```sh
/usr/bin/env T13_DELETE_WINDOW=rename-held /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller2-rename-held
```

Exit 0; 0.136161 seconds.

## controller2-close-profile

```sh
/usr/bin/env T13_DELETE_WINDOW=close-profile /opt/homebrew/opt/python@3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller-replay.py /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/controller2-close-profile
```

Exit 0; 0.170916 seconds.

## strict-windows

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/strict-windows.py
```

Exit 0; 0.064268 seconds.

## existing-live-controls

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B packages/tools/src/capture/trace_observer_packet/live_controls.py
```

Exit 0; 0.103345 seconds.

## existing-boundary-controls

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B packages/tools/src/capture/trace_observer_packet/boundary_controls.py
```

Exit 0; 0.131457 seconds.

## preservation

```sh
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -B /private/tmp/p1-e14-t13-profile-delete-hzkiq0sv/verify-preservation.py
```

Exit 0; 0.204579 seconds.

