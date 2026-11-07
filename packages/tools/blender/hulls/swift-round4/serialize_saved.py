"""Stock source validation/bake/serialization; compression runs after Blender exits.

Consumes the saved authoritative source and explicit LODs. Never imports authoring
code or generates the hull. Run finish_export.py compress with this attempt name.
"""
import hashlib, json, os, sys
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import bake, core, export, glb, rules as R

sys.stdout.reconfigure(line_buffering=True)
job = Path(os.environ['SWIFT_JOB'])
source = ROOT / 'assets/blend/hulls/swift.blend'
before = hashlib.sha256(source.read_bytes()).hexdigest()
rules = R.load()
report = core.validate_path(rules, source, family='hulls')
core.write_and_print(report, core.report_path('hulls', source, job / 'validation'), quiet=True)
assert report.status == 'PASS'
assert all(set(v.lods) == {0, 1, 2, 3} for a in report.model.assets for v in a.variants.values()), 'source must author all four LODs'
stock_bake = bake.bake_material
def bake_and_release(*args, **kwargs):
    result = stock_bake(*args, **kwargs)
    for image in bpy.data.images:
        if image.packed_file and image.has_data:
            image.buffers_free()
    return result
bake.bake_material = bake_and_release
try:
    export._bake(rules, 'hulls', report.model, None)
finally:
    bake.bake_material = stock_bake
export._make_lods(rules, report.model)
export._stamp_skins(rules, report.model)
names = export._material_names(rules, report.model)
roots = export._build_nodes(rules, report.model)
out = job / 'serialized.glb'
export._write(roots, out)
glb.finalize(out, names)
assert hashlib.sha256(source.read_bytes()).hexdigest() == before
with out.open('rb') as f:
    digest = hashlib.file_digest(f, 'sha256').hexdigest()
with (job / 'serialization.json').open('x') as f:
    json.dump({'status': 'SERIALIZED_NOT_VALIDATED', 'sourceSha256': before, 'sha256': digest, 'bytes': out.stat().st_size}, f, indent=2)
print('Serialized saved source; stop Blender before compression:', digest)
