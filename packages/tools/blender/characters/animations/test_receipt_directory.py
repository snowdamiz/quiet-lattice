"""Exercise receipt ownership through sequential CPU-only Blender CLI runs.

python3 packages/tools/blender/characters/animations/test_receipt_directory.py \
    --output <new-evidence-directory> [--negative-only]
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[5]
EXPORTER = Path(__file__).with_name('export_saved.py')
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
THREAD_LIMITS = {name: '2' for name in (
    'OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
    'NUMEXPR_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS',
)}


def snapshot(directory):
    result = {}
    for path in [directory, *sorted(directory.rglob('*'))]:
        stat = path.lstat()
        result[str(path.relative_to(directory))] = {
            'mode': stat.st_mode, 'inode': stat.st_ino, 'mtimeNs': stat.st_mtime_ns,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None,
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--negative-only', action='store_true',
                        help='Reproduce existing-directory failures without running the fresh-path case')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    results = []

    def run(label, destination, *, selftest=False, reject=False):
        before = snapshot(destination) if reject else None
        command = [BLENDER, '-b', '-t', '2', '--factory-startup', '--disable-autoexec',
                   '--python-exit-code', '1', '-P', str(EXPORTER), '--', '--validate-only']
        if selftest:
            command.append('--selftest')
        command.extend(['--report-dir', str(destination.resolve())])
        environment = {**os.environ, **THREAD_LIMITS, 'PYTHONDONTWRITEBYTECODE': '1'}
        process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, start_new_session=True)
        timed_out = False
        try:
            output, _ = process.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            output, _ = process.communicate()
        (args.output / (label + '.log')).write_text(output + f'\nEND_OF_CAPTURE exit={process.returncode}\n')
        checks = {'completedWithinTimeout': not timed_out}
        after = snapshot(destination)
        if reject:
            checks.update({
                'nonzeroExit': process.returncode != 0,
                'directoryAndFilesUnchanged': before == after,
                'rejectedBeforeSourceLoad': 'Read blend:' not in output,
                'noValidationOrExportSuccess': 'ANIMATION_SOURCE_VALIDATION_PASS' not in output
                    and 'EXPORTED_SAVED_ACTION' not in output,
            })
        else:
            source = json.loads((destination / 'source-validation.json').read_text()) if process.returncode == 0 else {}
            component = json.loads((destination / 'component-validation.json').read_text()) if process.returncode == 0 else {}
            checks.update({
                'zeroExit': process.returncode == 0,
                'onlyTwoReceipts': {p.name for p in destination.iterdir()} == {
                    'source-validation.json', 'component-validation.json'},
                'validationAndTenExportControlsPass': source.get('status') == 'PASS'
                    and source.get('savedActions') == 42 and len(source.get('negativeControls', [])) == 10
                    and source.get('exportBoundaryRejectsInvalidComponentsBeforeWriting') is True,
                'pairedReceiptsAgree': source == component,
                'sourceUnchangedNoRenderOrBake': source.get('sourceUnchanged') is True
                    and source.get('rendered') is False and source.get('baked') is False,
            })
        result = {'case': label, 'command': command, 'threadLimits': THREAD_LIMITS,
                  'exporterExitCode': process.returncode, 'checks': checks, 'before': before, 'after': after,
                  'passed': all(checks.values())}
        results.append(result)
        print(label, 'PASS' if result['passed'] else 'FAIL', json.dumps(checks), flush=True)

    for label, files, selftest in [
        ('existing-empty', {}, False),
        ('existing-nonempty', {'unrelated.txt': 'preserve this evidence directory\n'}, False),
        ('existing-prior-receipts', {
            'source-validation.json': '{"status":"PRIOR_SOURCE_EVIDENCE"}\n',
            'component-validation.json': '{"status":"PRIOR_COMPONENT_EVIDENCE"}\n',
        }, True),
    ]:
        destination = args.output / label
        destination.mkdir()
        for name, content in files.items():
            (destination / name).write_text(content)
        run(label, destination, selftest=selftest, reject=True)
    if not args.negative_only:
        destination = args.output / 'fresh-receipts'
        run('fresh-validate-selftest', destination, selftest=True)
        run('reuse-fresh-receipts', destination, selftest=True, reject=True)
    passed = all(result['passed'] for result in results)
    (args.output / 'results.json').write_text(json.dumps({
        'status': 'PASS' if passed else 'FAIL',
        'exporterSha256': hashlib.sha256(EXPORTER.read_bytes()).hexdigest(),
        'cases': results,
    }, indent=2) + '\n')
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
