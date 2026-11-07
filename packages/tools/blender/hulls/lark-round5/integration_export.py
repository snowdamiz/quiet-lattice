"""Stock hull export of the REVISE-fixed canonical blend → packages/client/public/models/hulls/lark.glb."""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[5]
HOST = Path('/Users/andreyyurlov/Documents/dev/space')
CANON_BLEND = ROOT / 'assets/blend/hulls/lark.blend'
CANON_GLB = ROOT / 'packages/client/public/models/hulls/lark.glb'
OUT = Path(__file__).resolve().parent / 'export-evidence'
OUT.mkdir(exist_ok=True)

sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import export, meshopt, glb, ktx as texture_codec  # noqa: E402
sys.path.insert(0, str(Path(__file__).parent))
from runtime_limits import configure  # noqa: E402
configure(texture_codec)

relative = Path('packages/tools/src/art/meshopt.ts')
assert (ROOT / relative).read_bytes() == (HOST / relative).read_bytes()
node = os.environ['LARK_NODE']
assert subprocess.check_output([node, '--version'], text=True).strip() == 'v22.23.3'
tsx = HOST / 'node_modules/tsx/dist/cli.mjs'
ktx = HOST / 'node_modules/.cache/ktx-software-4.4.2/bin/ktx'
assert tsx.is_file() and ktx.is_file()
os.environ['KTX'] = str(ktx)
meshopt._command = lambda: [node, str(tsx), str(HOST / relative)]
stock_finalize = glb.finalize


def serialize_liveries(path, names):
    raw, _ = glb.read(path)
    base_ids = [i for i, m in enumerate(raw['materials']) if m['name'] in ('Lark_Hull', 'Lark_Accent', 'Lark_Trim')]
    assert len(base_ids) == 3
    stock_finalize(path, names)
    doc, binary = glb.read(path)
    data = bytearray(binary)
    extension = 'KHR_materials_variants'
    doc.setdefault('extensionsUsed', []).append(extension)
    doc.setdefault('extensions', {})[extension] = {'variants': [{'name': x} for x in ('Thalune', 'Compact', 'Working')]}
    alternatives = {}
    for variant_id, scheme in ((1, 'compact'), (2, 'working')):
        image = bpy.data.images['lark_livery_' + scheme]
        png = bytes(image.packed_file.data)
        assert png.startswith(b'\x89PNG')
        while len(data) % 4:
            data.append(0)
        offset = len(data)
        data.extend(png)
        bv = len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(png)})
        img = len(doc['images'])
        doc['images'].append({'name': image.name, 'mimeType': 'image/png', 'bufferView': bv})
        tex = len(doc['textures'])
        doc['textures'].append({'source': img, 'sampler': 0})
        for index in base_ids:
            material = copy.deepcopy(doc['materials'][index])
            material['name'] += '_' + scheme
            material['pbrMetallicRoughness']['baseColorTexture']['index'] = tex
            alternatives[index, variant_id] = len(doc['materials'])
            doc['materials'].append(material)
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            index = primitive.get('material')
            if index in base_ids:
                primitive.setdefault('extensions', {})[extension] = {
                    'mappings': [{'material': index, 'variants': [0]}]
                    + [{'material': alternatives[index, v], 'variants': [v]} for v in (1, 2)]
                }
    doc['buffers'][0]['byteLength'] = len(data)
    glb.write(path, doc, data)


glb.finalize = serialize_liveries

src_root = Path(os.environ['TMPDIR']) / 'revise-src'
if src_root.exists():
    shutil.rmtree(src_root)
(src_root / 'hulls').mkdir(parents=True)
shutil.copy2(CANON_BLEND, src_root / 'hulls' / 'lark.blend')
report_dir = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-revise-export')
report_dir.mkdir(parents=True, exist_ok=False)
(report_dir / 'compression-toolchain.json').write_text(json.dumps({
    'stock_meshopt_source_sha256': hashlib.sha256((ROOT / relative).read_bytes()).hexdigest(),
    'node': node,
    'tsx': str(tsx),
    'ktx': str(ktx),
    'ktx_sha256': hashlib.sha256(ktx.read_bytes()).hexdigest(),
}, indent=2) + '\n')

# Export into scratch models root, then install over canonical glb.
models_root = Path(os.environ['TMPDIR']) / 'revise-models'
if models_root.exists():
    shutil.rmtree(models_root)
models_root.mkdir(parents=True)
code = export.main('hulls', [
    '--only', 'lark',
    '--src-root', str(src_root),
    '--out-dir', str(models_root),
    '--report-dir', str(report_dir),
])
produced = models_root / 'hulls' / 'lark.glb'
if not produced.is_file():
    alt = models_root / 'lark.glb'
    produced = alt if alt.is_file() else produced
assert produced.is_file(), f'export missing under {models_root}'
assert code == 0, f'export validation failed: {code}'
audit = OUT / 'integration-decoded.json'
subprocess.run([node, str(Path(__file__).parent / 'candidate_glb_review.mjs'), str(produced), str(audit)], check=True)
decoded = json.loads(audit.read_text())
assert decoded['density']['min_median'] >= 512
assert decoded['uvAudit']['missingTexcoord0'] == 0
assert decoded['uvAudit']['extraTexcoord'] == 0
# Atomic replace only after stock validation and independent decoded density.

tmp = CANON_GLB.with_suffix('.glb.revise-tmp')
shutil.copy2(produced, tmp)
tmp.replace(CANON_GLB)
receipt = {
    'blend_sha256': hashlib.sha256(CANON_BLEND.read_bytes()).hexdigest(),
    'glb_sha256': hashlib.sha256(CANON_GLB.read_bytes()).hexdigest(),
    'glb_bytes': CANON_GLB.stat().st_size,
    'export_exit': code,
}
(OUT / (os.environ['LARK_ATTEMPT_ID'] + '-revise-export-install.json')).write_text(json.dumps(receipt, indent=2) + '\n')
print('REVISE_EXPORT', receipt, flush=True)
raise SystemExit(code)
