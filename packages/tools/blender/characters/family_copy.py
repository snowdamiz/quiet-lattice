"""Save a filtered review copy without altering the authored character source.

Blender -b <species.blend> --python-exit-code 1 -P this.py --
    <species> <heads|suits> <species_heads.blend|species_suits.blend>
"""
import hashlib
import json
from pathlib import Path
import sys

import bpy

people, kind, destination = sys.argv[sys.argv.index('--') + 1:]
assert people in ('thalune', 'ixari', 'ulgani') and kind in ('heads', 'suits')
source, destination = Path(bpy.data.filepath).resolve(), Path(destination).resolve()
assert source.name == f'{people}.blend' and destination.stem == f'{people}_{kind}'
assert source != destination
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
asset = bpy.data.collections[people]
prefix = kind[:-1]
expected = {f'{people}_{prefix}{number}' for number in range(1, 7 if kind == 'heads' else 5)}
for variant in list(asset.children):
    if variant.name in expected:
        continue
    for obj in list(variant.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for level in list(variant.children):
        bpy.data.collections.remove(level)
    bpy.data.collections.remove(variant)
assert {variant.name for variant in asset.children} == expected
for variant in asset.children:
    assert {level.name for level in variant.children} == {f'{variant.name}_LOD{lod}' for lod in range(4)}
destination.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(destination), compress=True)
assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
destination.with_suffix('.json').write_text(json.dumps({
    'source': str(source), 'source_sha256': source_hash,
    'copy': str(destination), 'copy_sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
    'variants': sorted(expected), 'note': 'Review-only collection filtering; original authored source unchanged.',
}, indent=2) + '\n')
