"""Read-only comparison with the independently reviewed R3 protected manifest."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
BASE = '05909e4f74d1c6acf64a5be110f3e44af18b7bc5'
R3 = Path('/tmp/p1-e05-t03-r3.drfidkvh')
HELPERS = ('round4_job_boundary.py', 'round4_capture_children.py', 'run_round4_browser_proof.py', 'run_round4_remaining8.py')


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def main():
    previous = json.loads((R3 / 'protected-hashes.json').read_text())
    result = {'status': 'PASS', 'base': BASE, 'sourceManifestSha256': sha(R3 / 'protected-hashes.json'), 'groups': {}, 'helpers': {}, 'reports': {}}
    for group in ('accepted_bodies', 'viewmodels', 'cpu_previews', 'accepted_review_packets', 'retained_R1_files_and_runtime'):
        rows = {}
        for name, expected in previous[group].items():
            path = ROOT / name
            observed = sha(path)
            assert observed == expected.get('working_file_sha256', expected['sha256']), name
            rows[name] = {'bytes': path.stat().st_size, 'sha256': observed}
        result['groups'][group] = rows
    for name in HELPERS:
        relative = 'assets/blend/stations/_authoring/' + name
        original = subprocess.check_output(['git', 'show', 'ca7d91e378e9d2f3f0ce8f0651475dcb843875d9:' + relative], cwd=ROOT)
        current = sha(ROOT / relative)
        assert current == hashlib.sha256(original).hexdigest()
        result['helpers'][relative] = current
    for path in [R3 / 'REPORT.md', Path('/tmp/p1-e05-t03-r2.f3fApA/REPORT.md'), Path('/tmp/p1-e05-t03-r1.AxTqL9/REPORT.md'),
                 *[Path(p) / 'REPORT.md' for p in ('/private/tmp/p1-e08-t09-r3-independent-l9fn2t5y', '/private/tmp/p1-e08-t09-r4-independent-pshs9o5k', '/private/tmp/p1-e08-t09-r5-independent-xDKoJp')]]:
        result['reports'][str(path)] = sha(path)
    excludes = [':(exclude)' + str(HERE.relative_to(ROOT))] + [':(exclude)assets/blend/stations/_authoring/' + n for n in HELPERS]
    subprocess.run(['git', 'diff', '--exit-code', BASE, '--', '.', *excludes], cwd=ROOT, check=True, stdout=subprocess.PIPE)
    result['protectedDiffEmpty'] = True
    print(json.dumps(result, indent=2))


if __name__ == '__main__': main()
