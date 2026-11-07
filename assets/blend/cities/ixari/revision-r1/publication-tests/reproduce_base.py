"""Exclusive real-script base reproduction; no edits to review scratch or assets."""
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[6]
TASK = ROOT / 'assets/blend/cities/ixari'
OUT = Path(__file__).resolve().parent
BASE = '2d23ecb3cbf2b78a54b949a5e3bb9c70ebb4ff00'
SCRIPT = 'packages/tools/blender/cities/ixari/build_report.py'
ENV = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', OMP_NUM_THREADS='2',
           OPENBLAS_NUM_THREADS='2', MKL_NUM_THREADS='2', NUMEXPR_NUM_THREADS='2',
           VECLIB_MAXIMUM_THREADS='2')


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def link(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.symlink_to(source)


def cap():
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024**2, 8 * 1024**2))


def main():
    actual = (ROOT / SCRIPT).read_bytes()
    base = subprocess.run(['git', 'show', BASE + ':' + SCRIPT], cwd=ROOT,
                          capture_output=True, check=True, timeout=30).stdout
    assert actual == base, 'reproduction requires exact base script'
    session = Path(tempfile.mkdtemp(prefix='base-', dir=OUT))
    watched = [TASK / p for p in ('manifest.json', 'APPENDIX-C2.json', 'SHA256SUMS')]
    before = {str(p): sha(p) for p in watched}
    results = []
    for case in ('early', 'late'):
        root = session / case
        script = root / SCRIPT
        script.parent.mkdir(parents=True)
        script.write_bytes(base)
        task = root / 'assets/blend/cities/ixari'
        task.mkdir(parents=True)
        subprocess.run(['git', 'init', '-q', root], check=True, timeout=30, env=ENV)
        provenance = json.loads((TASK / 'provenance-start.json').read_text())
        for name in provenance['protected']:
            link(ROOT / name, root / name)
        link(TASK / 'provenance-start.json', task / 'provenance-start.json')
        manifest = task / 'manifest.json'
        manifest.write_text('{"qualification":{"source":"PASS"},"sentinel":"EARLY"}\n')
        if case == 'early':
            ip = sorted((TASK / 'inventory').glob('*.json'))[0]
            inv = json.loads(ip.read_text())
            inv[0]['sourceSha256'] = '0' * 64
            (task / 'inventory').mkdir()
            (task / 'inventory' / ip.name).write_text(json.dumps(inv))
            link(ROOT / inv[0]['source'], root / inv[0]['source'])
        else:
            link(TASK / 'inventory', task / 'inventory')
            for p in (ROOT / 'assets/blend/cities').glob('ixari_*.blend'):
                link(p, root / p.relative_to(ROOT))
            for p in (ROOT / 'packages/client/public/models/cities').glob('ixari_*.glb'):
                link(p, root / p.relative_to(ROOT))
            link(ROOT / 'assets/renders/cities/ixari', root / 'assets/renders/cities/ixari')
            for name in ('stock-validate-final', 'consumer-final-r2', 'audit-source-final',
                         'audit-export-final', 'mesh-validity-final', 'format-final',
                         'python-syntax-final', 'resource-controls.json', 'local-lfs-final.json'):
                link(TASK / 'receipts' / name, task / 'receipts' / name)
            link(TASK / 'attempts.jsonl', task / 'attempts.jsonl')
            eslint = json.loads((TASK / 'receipts/eslint-final/process.json').read_text())
            eslint['exitCode'] = 1
            dest = task / 'receipts/eslint-final/process.json'
            dest.parent.mkdir()
            dest.write_text(json.dumps(eslint))
        command = ['python3', str(script)]
        logfile = session / (case + '.log')
        with logfile.open('xb') as log:
            proc = subprocess.run(command, cwd=root, env=ENV, stdout=log, stderr=subprocess.STDOUT,
                                  timeout=120, preexec_fn=cap)
        tail = logfile.read_text().splitlines()[-20:]
        (session / (case + '-last20.txt')).write_text('\n'.join(tail) + '\n')
        published = json.loads(manifest.read_text())
        assert proc.returncode == 1 and 'AssertionError' in '\n'.join(tail)
        assert not (task / 'APPENDIX-C2.json').exists()
        if case == 'early':
            assert published['sentinel'] == 'EARLY' and published['qualification']['source'] == 'PASS'
            assert 'sourceSha256' in '\n'.join(tail)
        else:
            assert published['qualification']['actualCpuConsumers'] == '68 tests PASS'
            assert 'summaries.values()' in '\n'.join(tail)
        results.append(dict(case=case, command=command, cwd=str(root), exitCode=proc.returncode,
                            scriptSha256=sha(script), fullLog=str(logfile), last20Lines=tail,
                            manifest=published, wroteAppendix=False))
    assert before == {str(p): sha(p) for p in watched}
    result = dict(baseHEAD=BASE, baseTree='30ac4e907dbaebb537b9b87fa83aa40424c370e8',
                  scriptSha256=hashlib.sha256(base).hexdigest(), results=results,
                  originalReportsUnchanged=True, timeoutSeconds=120, outputLimitBytes=8 * 1024**2)
    (session / 'reproduction.json').write_text(json.dumps(result, indent=2) + '\n')
    marker = OUT / 'BASE_REPRO_DONE.json'
    with marker.open('x') as f:
        json.dump(dict(status='REPRODUCED', evidence=str(session / 'reproduction.json'),
                       baseHEAD=BASE, scriptSha256=result['scriptSha256']), f, indent=2)
        f.write('\n')
    print(marker)


if __name__ == '__main__':
    main()
