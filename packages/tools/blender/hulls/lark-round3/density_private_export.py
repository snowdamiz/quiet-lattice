"""Stock hull export of the private candidate only; canonical blend/glb untouched."""
import hashlib, json, os, shutil, subprocess, sys, copy
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[5]
HOST = Path('/Users/andreyyurlov/Documents/dev/space')
CANON_BLEND = ROOT / 'assets/blend/hulls/lark.blend'
CANON_GLB = ROOT / 'packages/client/public/models/hulls/lark.glb'
EXPECTED_BLEND = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
EXPECTED_GLB = '7f11e2bd2818045c1a861d4e959f2a985828bdcc9b60d44ed2fda8ff41300bad'
PRIVATE = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107/private-candidate'
PRIVATE_BLEND = PRIVATE / 'lark.blend'
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
assert hashlib.sha256(CANON_BLEND.read_bytes()).hexdigest() == EXPECTED_BLEND
assert hashlib.sha256(CANON_GLB.read_bytes()).hexdigest() == EXPECTED_GLB
assert PRIVATE_BLEND.is_file()

sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import export, meshopt, glb, ktx as texture_codec
sys.path.insert(0, str(Path(__file__).parent))
from runtime_limits import configure
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
    # UDIM export splits each role into per-tile materials (Lark_Hull, Lark_Hull.001, …).
    def role_ids(prefix):
        return [i for i, m in enumerate(raw['materials']) if m['name'] == prefix or m['name'].startswith(prefix + '.')]
    base_ids = role_ids('Lark_Hull') + role_ids('Lark_Accent') + role_ids('Lark_Trim')
    assert base_ids, 'No Lark Hull/Accent/Trim materials after UDIM split'
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
    base_set = set(base_ids)
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            index = primitive.get('material')
            if index in base_set:
                primitive.setdefault('extensions', {})[extension] = {
                    'mappings': [{'material': index, 'variants': [0]}]
                    + [{'material': alternatives[index, v], 'variants': [v]} for v in (1, 2)]
                }
    doc['buffers'][0]['byteLength'] = len(data)
    glb.write(path, doc, data)


glb.finalize = serialize_liveries

# Isolated src-root so stock export never opens the canonical blend path.
src_root = Path(os.environ['TMPDIR']) / 'private-src'
if src_root.exists():
    shutil.rmtree(src_root)
(src_root / 'hulls').mkdir(parents=True)
shutil.copy2(PRIVATE_BLEND, src_root / 'hulls' / 'lark.blend')
report_dir = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-private-export')
report_dir.mkdir(parents=True, exist_ok=False)
(report_dir / 'compression-toolchain.json').write_text(json.dumps({
    'stock_meshopt_source_sha256': hashlib.sha256((ROOT / relative).read_bytes()).hexdigest(),
    'node': node,
    'tsx': str(tsx),
    'ktx': str(ktx),
    'ktx_sha256': hashlib.sha256(ktx.read_bytes()).hexdigest(),
    'src': str((src_root / 'hulls' / 'lark.blend').relative_to(ROOT)) if False else str(src_root / 'hulls' / 'lark.blend'),
    'out_dir': str(PRIVATE),
    'dependency_policy': 'Read-only existing installation; no fetch or installation',
}, indent=2) + '\n')

code = export.main('hulls', [
    '--only', 'lark',
    '--src-root', str(src_root),
    '--out-dir', str(PRIVATE),
    '--report-dir', str(report_dir),
])
assert hashlib.sha256(CANON_BLEND.read_bytes()).hexdigest() == EXPECTED_BLEND
assert hashlib.sha256(CANON_GLB.read_bytes()).hexdigest() == EXPECTED_GLB
glb_path = PRIVATE / 'hulls' / 'lark.glb'
# Stock formatter may write hulls/lark.glb under out-dir.
if not glb_path.is_file():
    alt = PRIVATE / 'lark.glb'
    glb_path = alt if alt.is_file() else glb_path
receipt = {
    'exit_code': code,
    'private_glb': str(glb_path.relative_to(ROOT)) if glb_path.is_file() else None,
    'private_glb_sha256': hashlib.sha256(glb_path.read_bytes()).hexdigest() if glb_path.is_file() else None,
    'private_glb_bytes': glb_path.stat().st_size if glb_path.is_file() else None,
    'canonical_blend_sha256': EXPECTED_BLEND,
    'canonical_glb_sha256': EXPECTED_GLB,
    'report_dir': str(report_dir.relative_to(ROOT)),
    'canonical_paths_written': [],
}
with (OUT / (os.environ['LARK_ATTEMPT_ID'] + '-private-export.json')).open('x') as f:
    json.dump(receipt, f, indent=2)
print('PRIVATE_EXPORT', receipt, flush=True)
raise SystemExit(code)
