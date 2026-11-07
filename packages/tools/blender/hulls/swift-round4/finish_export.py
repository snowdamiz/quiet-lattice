"""Finish a pinned serialized source in separate compression/validation processes.

Uses the stock KTX, meshopt and validation functions without source generation.
Each invocation belongs to a fresh lane.py attempt. A failed attempt stays intact.
"""
import hashlib, json, os, shutil, struct, sys, subprocess
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
os.environ['KTX'] = str(Path(__file__).with_name('ktx_cpu.py'))
sys.stdout.reconfigure(line_buffering=True)
from artlib import glb, ktx, meshopt, rules as R

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
mode, upstream_name = args
job = Path(os.environ['SWIFT_JOB'])
upstream = ROOT / 'assets/renders/hulls/swift-round4-current' / upstream_name
source = ROOT / 'assets/blend/hulls/swift.blend'
rules = R.load()

def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def write(name, data):
    with (job / name).open('x') as f:
        json.dump(data, f, indent=2)

before = sha(source)
receipt = json.loads((upstream / 'receipt.json').read_text())
assert receipt['childGroupEmpty']
assert receipt['inputs']['assets/blend/hulls/swift.blend']['sha256'] == before
if mode in ['compress', 'compress-cache']:
    # Job 47 died only after stock serialization/finalization, at KTX startup.
    # This is its current-source pipeline intermediate, never a rejected import.
    assert json.loads((upstream / 'validation/hulls__swift.blend.json').read_text())['status'] == 'PASS'
    if upstream_name == '47-normal-finished-stock-export':
        assert receipt['reason'] == 'RSS limit'
        assert json.loads((upstream / 'input-source.json').read_text())['sha256'] == before
        log = (upstream / 'process.log').read_text()
        assert 'Finished glTF 2.0 export' in log and 'encoding KTX2 (1 at a time)' in log
        raw = upstream / 'scratch/art-export-h4q1wkl6/swift.glb'
        assert sha(raw) == '5b7756c5af42f4daebd3c0fd2ec85fb66f94307079b7254d6b8142fd6418a073'
    else:
        assert receipt['exit'] == 0
        pin = json.loads((upstream / 'serialization.json').read_text())
        raw = upstream / 'serialized.glb'
        assert pin['sourceSha256'] == before and pin['sha256'] == sha(raw)
    with raw.open('rb') as f:
        magic, version, length = struct.unpack('<4sII', f.read(12))
    assert magic == b'glTF' and version == 2 and length == raw.stat().st_size
    js, data = glb.read(raw)
    assert len(js['images']) == 59 and len(js['meshes']) == 109
    assert all(v.get('byteOffset', 0) + v['byteLength'] <= len(data) for v in js['bufferViews'])
    del js, data
    write('input-stage.json', {'sourceSha256': before, 'rawPath': str(raw.relative_to(ROOT)), 'rawSha256': sha(raw), 'bytes': length, 'upstreamExit': receipt['exit'], 'upstreamReason': receipt['reason']})
    encoded = job / 'encoded-stage.glb'
    if mode == 'compress-cache':
        sys.path.insert(0,str(Path(__file__).parent))
        import texture_cache
        texture_summary = texture_cache.compress(raw, encoded, ROOT / 'assets/renders/hulls/swift-round4-current', job)
    else:
        texture_summary = ktx.compress(raw, encoded, ktx.settings(rules, 'hulls'))
    write('encoded-stage.json', {'sourceSha256': before, 'sha256': sha(encoded), 'bytes': encoded.stat().st_size, 'status': 'INTERMEDIATE_NOT_VALIDATED', 'summary': texture_summary})
    candidate = job / 'swift.glb'
    # Actual-source comparison proves that 14/16-bit position and UV grids
    # collapse Swift's narrow authored faces. Keep these attributes exact and
    # quantize only normals; shared family rules and helpers stay unchanged.
    command = meshopt._command()[:2] + [str(Path(__file__).with_name('compress_precision.mjs')), str(encoded), str(candidate)]
    result = subprocess.run(command, text=True, capture_output=True, cwd=ROOT)
    print(result.stdout, flush=True)
    print(result.stderr, file=sys.stderr, flush=True)
    result.check_returncode()
    geometry_summary = json.loads(result.stdout.strip().splitlines()[-1])
    write('compression.json', {'status': 'COMPRESSED_NOT_VALIDATED', 'sourceSha256': before, 'glbSha256': sha(candidate), 'bytes': candidate.stat().st_size, 'textures': texture_summary, 'geometry': geometry_summary})
elif mode == 'validate':
    from artlib import core
    assert receipt['exit'] == 0
    compression = json.loads((upstream / 'compression.json').read_text())
    candidate = upstream / 'swift.glb'
    assert compression['sourceSha256'] == before and compression['glbSha256'] == sha(candidate)
    write('input-stage.json', {'sourceSha256': before, 'candidatePath': str(candidate.relative_to(ROOT)), 'glbSha256': sha(candidate), 'compressionJob': upstream_name})
    reports = job / 'validation'
    source_report = core.validate_path(rules, source, family='hulls')
    core.write_and_print(source_report, core.report_path('hulls', source, reports), quiet=True)
    assert source_report.status == 'PASS', 'stock source validation failed'
    # Identical checks and family settings to stock export.export_one.
    core.load(candidate)
    out = job / 'models/hulls/swift.glb'
    report = core.run_checks(rules, out, 'hulls', 'export', source=source, glb=candidate, compressed=True, geometry=True)
    core.write_and_print(report, core.report_path('hulls', out, reports), quiet=True)
    code = 0 if report.status == 'PASS' else 1
    write('source-pin.json', {'sha256': before, 'bytes': source.stat().st_size, 'stockExit': code, 'splitPipeline': True, 'compressionJob': upstream_name, 'glbSha256': sha(candidate)})
    if code == 0:
        out.parent.mkdir(parents=True)
        shutil.copyfile(candidate, out)
        assert sha(out) == compression['glbSha256']
    assert sha(source) == before, 'validation modified source'
    sys.exit(code)
else:
    raise ValueError(mode)
assert sha(source) == before, 'compression modified source'
