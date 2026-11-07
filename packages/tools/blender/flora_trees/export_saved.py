"""Prepare a validated private export. Only the supervisor may publish it.

No author module or validator override. The saved source is immutable; all
producer outputs, including stock intermediates, stay in the owned attempt.
"""
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from artlib import core, rules
from artlib.export import main as stock_export
from run import read_bound, write_json


def main(kind, run):
    run = run.resolve(strict=True)
    private = run/'producer'
    # Created by run.py before process launch, including TMPDIR for stock/codec
    # temporary files. No producer path is a canonical public output name.
    if Path(os.environ['TMPDIR']).resolve(strict=True) != private/'tmp':
        raise ValueError('export requires its supervisor-owned temporary directory')
    src = ROOT/'assets/blend/flora'/f'tree_{kind}_t04.blend'
    before, _ = read_bound(src)
    output_root = private/'stock'
    rc = stock_export('flora', ['--only', src.stem, '--out-dir', str(output_root),
                               '--report-dir', str(private/'stock-reports')])
    if rc:
        return rc
    raw = output_root/'flora'/f'{src.stem}.glb'
    candidate = private/f'{src.stem}.glb'
    cmd = [os.environ.get('ART_NODE', 'node'), str(ROOT/'node_modules/tsx/dist/cli.mjs'),
           str(HERE/'promote_masks.mjs'), str(raw), str(candidate), str(private/'precision.json')]
    subprocess.run(cmd, check=True)
    validated, _ = read_bound(candidate)
    check = core.validate_path(rules.load(), candidate, family='flora', source=src)
    report = private/'final-stock-validation.json'
    core.write_and_print(check, report)
    if read_bound(src)[0] != before:
        raise RuntimeError('source changed during export')
    if check.status != 'PASS':
        return 1
    if read_bound(candidate)[0] != validated:
        raise RuntimeError('export changed during validation')
    write_json(private/'ready.json', {
        'schema': 1, 'attempt': str(run), 'kind': kind, 'source': before,
        'output': validated, 'validation': read_bound(report)[0],
        'stock': read_bound(raw)[0], 'precision': read_bound(private/'precision.json')[0],
    })
    # Retain the raw/intermediate bytes and report for complete failure history.
    print('T04_PREPARED', candidate, validated['sha256'])
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[-2], Path(sys.argv[-1])))
