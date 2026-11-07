"""Swift-only geometry precision, reusing the exact completed KTX stage.

No material rebake, source mutation or rejected-GLB import. The fresh candidate
still requires stock validation and the unchanged actual-surface identity gate.
"""
import hashlib, json, os, sys, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import meshopt, rules as R
job = Path(os.environ['SWIFT_JOB'])
upstream = ROOT / 'assets/renders/hulls/swift-round4-current/48-split-compression'
def sha(p):
    with p.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()
pin = json.loads((upstream / 'encoded-stage.json').read_text())
stage = upstream / 'encoded-stage.glb'
source = ROOT / 'assets/blend/hulls/swift.blend'
assert pin['sha256'] == sha(stage) and pin['sourceSha256'] == sha(source)
mode = sys.argv[1]
assert mode in ['16', 'surface']
settings = meshopt.settings(R.load(), 'hulls')
settings.update(positionBits=16, texcoordBits=16)
if mode == 'surface':
    settings = {'compress': True, 'normalBits': 16, 'positions': 'float32', 'UVs': 'float32', 'required': ['KHR_mesh_quantization', 'EXT_meshopt_compression']}
with (job / 'input-stage.json').open('x') as f:
    json.dump({'sourceSha256': pin['sourceSha256'], 'encodedSha256': pin['sha256'], 'settings': settings}, f, indent=2)
candidate = job / 'swift.glb'
if mode == 'surface':
    command = meshopt._command()[:2] + [str(Path(__file__).with_name('compress_precision.mjs')), str(stage), str(candidate)]
    result = subprocess.run(command, text=True, capture_output=True, cwd=ROOT)
    print(result.stdout, flush=True)
    print(result.stderr, file=sys.stderr, flush=True)
    result.check_returncode()
    summary = json.loads(result.stdout.strip().splitlines()[-1])
else:
    summary = meshopt.compress(stage, candidate, settings)
assert pin['sourceSha256'] == sha(source)
with (job / 'compression.json').open('x') as f:
    json.dump({'status': 'COMPRESSED_NOT_VALIDATED', 'sourceSha256': pin['sourceSha256'], 'glbSha256': sha(candidate), 'bytes': candidate.stat().st_size, 'textures': pin['summary'], 'geometry': summary, 'settings': settings}, f, indent=2)
