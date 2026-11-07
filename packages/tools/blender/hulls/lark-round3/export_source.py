"""Run the unchanged hull exporter with verified already-installed compression tools."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import copy
import subprocess
import bpy

ROOT = Path(__file__).resolve().parents[5]
HOST = Path('/Users/andreyyurlov/Documents/dev/space')
sys.path.insert(0, str(ROOT/'packages/tools/blender'))
from artlib import export, meshopt, glb, ktx as texture_codec
sys.path.insert(0,str(Path(__file__).parent))
from runtime_limits import configure
configure(texture_codec)

relative = Path('packages/tools/src/art/meshopt.ts')
assert (ROOT/relative).read_bytes() == (HOST/relative).read_bytes(), 'Installed compressor source differs from this checkout'
node = os.environ['LARK_NODE']
assert subprocess.check_output([node,'--version'],text=True).strip()=='v22.23.3'
tsx = HOST/'node_modules/tsx/dist/cli.mjs'
ktx = HOST/'node_modules/.cache/ktx-software-4.4.2/bin/ktx'
assert node and tsx.is_file() and ktx.is_file()
os.environ['KTX'] = str(ktx)
# Resolve the identical stock compressor beside its existing dependencies, without modifying shared tools or fetching.
meshopt._command = lambda: [node, str(tsx), str(HOST/relative)]
stock_finalize = glb.finalize


def serialize_liveries(path, names):
    raw, _ = glb.read(path)
    base_ids = [i for i, m in enumerate(raw['materials']) if m['name'] in ('Lark_Hull','Lark_Accent','Lark_Trim')]
    assert len(base_ids) == 3
    stock_finalize(path, names)
    doc, binary = glb.read(path)
    data = bytearray(binary)
    extension = 'KHR_materials_variants'
    doc.setdefault('extensionsUsed', []).append(extension)
    doc.setdefault('extensions', {})[extension] = {'variants': [{'name': x} for x in ('Thalune','Compact','Working')]}
    alternatives = {}
    for variant_id, scheme in ((1,'compact'),(2,'working')):
        image = bpy.data.images['lark_livery_'+scheme]
        png = bytes(image.packed_file.data)
        assert png.startswith(b'\x89PNG'), 'Livery image must already be authored and packed in source'
        while len(data) % 4:
            data.append(0)
        offset = len(data)
        data.extend(png)
        bv = len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(png)})
        img = len(doc['images'])
        doc['images'].append({'name':image.name,'mimeType':'image/png','bufferView':bv})
        tex = len(doc['textures'])
        doc['textures'].append({'source':img,'sampler':0})
        for index in base_ids:
            material = copy.deepcopy(doc['materials'][index])
            material['name'] += '_'+scheme
            material['pbrMetallicRoughness']['baseColorTexture']['index'] = tex
            alternatives[index,variant_id] = len(doc['materials'])
            doc['materials'].append(material)
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            index = primitive.get('material')
            if index in base_ids:
                primitive.setdefault('extensions', {})[extension] = {'mappings': [{'material':index,'variants':[0]}] + [{'material':alternatives[index,v],'variants':[v]} for v in (1,2)]}
    doc['buffers'][0]['byteLength'] = len(data)
    glb.write(path,doc,data)


glb.finalize = serialize_liveries
out = ROOT/'assets/renders/hulls/lark-round3-current/export-attempts'/os.environ['LARK_ATTEMPT_ID']
out.mkdir(parents=True,exist_ok=False)
(out/'compression-toolchain.json').write_text(json.dumps({'stock_meshopt_source_sha256': hashlib.sha256((ROOT/relative).read_bytes()).hexdigest(), 'node': node, 'tsx': str(tsx), 'ktx': str(ktx), 'ktx_sha256': hashlib.sha256(ktx.read_bytes()).hexdigest(), 'dependency_policy': 'Read-only existing installation; no fetch or installation'}, indent=2)+'\n')
raise SystemExit(export.main('hulls', ['--only','lark','--report-dir',str(out)]))
