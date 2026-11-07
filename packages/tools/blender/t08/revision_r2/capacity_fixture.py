"""Inert CPU fixtures only: disclose actual disk facts; do not alter production limits."""

import json
import os
from pathlib import Path

_capacity_root = Path(os.environ["T08_FIXTURE_ROOT"])
_real_statvfs = os.statvfs
_capacity_calls = 0


def fixture_capacity(path):
    global _capacity_calls
    observed = _real_statvfs(path)
    if Path(path).resolve() != _capacity_root.resolve():
        return observed
    values = list(observed)
    values[4] = max(observed.f_bavail, (32 * 1024**3) // observed.f_frsize)
    _capacity_calls += 1
    with (_capacity_root / f"capacity-{os.getpid()}-{_capacity_calls}.json").open(
        "x"
    ) as stream:
        json.dump(
            {
                "actualFreeBytes": observed.f_bavail * observed.f_frsize,
                "fixtureFreeBytes": values[4] * observed.f_frsize,
                "scope": "inert CPU dependency fixture only; no heavy-work admission claim",
            },
            stream,
        )
    return os.statvfs_result(values)


os.statvfs = fixture_capacity
