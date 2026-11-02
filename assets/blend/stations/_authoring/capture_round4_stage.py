"""Single-use sequential station plan with a separately granted remaining-eight caller.

No stage ID entry remains. An attempt consumes its grant atomically before any stage,
cannot resume or skip, and permanently holds on the first unsuccessful result or crash.
No capture runs without its exact newly issued parent grant and reviewed readiness.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from round4_job_boundary import DeadlineExpired as CaptureWindowExpired, deadline as capture_deadline, write

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / 'assets/renders/stations/round4'
READY = BASE / 'remaining8_readiness_after_boundary.json'
GRANT_FILE = BASE / 'gpu_grant_remaining8_after_boundary.json'
BOUNDARY_PROOF = BASE / 'actual_capture_boundary_qualification.json'
CAPTURE_SECONDS = 600
CLEANUP_SECONDS = 60


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run_plan(ready, consumption_root, authorization_id, run_stage):
    """The only sequencing entry. Injected runner is used for CPU failure/concurrency controls."""
    assert len(ready['stages']) == 8
    ids = [s['id'] for s in ready['stages']]
    assert len(set(ids)) == 8 and 'standard-waystation-ws_fabricator' not in ids
    consumption_root = Path(consumption_root)
    consumption_root.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(authorization_id.encode()).hexdigest()
    attempt = consumption_root / key
    # Atomic mkdir: no concurrent caller, retry, stage skip or resume under this grant.
    attempt.mkdir(exist_ok=False)
    state = {'status': 'ACTIVE_OR_INTERRUPTED_HOLD', 'authorization_id': authorization_id,
             'ordered_plan': ready['stages'], 'completed': [], 'failure': None}
    write(attempt / 'attempt.json', state)
    try:
        for index, stage in enumerate(ready['stages']):
            assert len(state['completed']) == index, 'Prior stage has not succeeded'
            state['current'] = stage['id']
            write(attempt / 'attempt.json', state)
            result = run_stage(stage, attempt / stage['id'])
            write(attempt / (stage['id'] + '.result.json'), result)
            if result.get('accepted') is not True:
                raise RuntimeError(f"Stage {stage['id']} did not pass; this attempt is permanently held")
            state['completed'].append(stage['id'])
            write(attempt / 'attempt.json', state)
        state['status'] = 'ALL_EIGHT_SUCCEEDED'
    except BaseException as error:
        state['status'] = 'PERMANENT_HOLD'
        state['failure'] = f'{type(error).__name__}: {error}'
        write(attempt / 'attempt.json', state)
        raise
    write(attempt / 'attempt.json', state)
    return state


def main():
    assert len(sys.argv) == 1, 'Single sequential entry only; no stage IDs, retries or skips'
    from run_round4_remaining8 import execute
    state = execute()  # Separate reviewed readiness + new parent grant required.
    return 0 if state['status'] == 'ALL_EIGHT_SUCCEEDED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
