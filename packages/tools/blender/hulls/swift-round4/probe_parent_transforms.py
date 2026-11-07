"""Inspect authored LOD parent transforms, without modifying the source."""
import bpy, hashlib, json, os
from pathlib import Path
source = Path('assets/blend/hulls/swift.blend').resolve()
bpy.ops.wm.open_mainfile(filepath=str(source))
bpy.context.view_layer.update()
rows = []
def matrix(m): return [float(v) for row in m for v in row]
for variant in ['swift', 'swift_damaged', 'swift_husked']:
    base = bpy.data.collections[variant + '_LOD0']
    for level in [1, 2, 3]:
        coll = bpy.data.collections[variant + f'_LOD{level}']
        for a in base.objects:
            b = next((o for o in coll.objects if o.name == a.name + f'_R4L{level}'), None)
            if b is None: continue
            error = max(abs(x-y) for x,y in zip(matrix(a.matrix_world),matrix(b.matrix_world)))
            if error > 1e-6:
                rows.append({'variant':variant,'lod':level,'base':a.name,'copy':b.name,'worldError':error,'baseWorld':matrix(a.matrix_world),'copyWorld':matrix(b.matrix_world),'baseParentInverse':matrix(a.matrix_parent_inverse),'copyParentInverse':matrix(b.matrix_parent_inverse),'baseBasis':matrix(a.matrix_basis),'copyBasis':matrix(b.matrix_basis),'parents':[a.parent.name if a.parent else None,b.parent.name if b.parent else None]})
result={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'differences':rows}
Path(os.environ['SWIFT_JOB'],'parent-transforms.json').write_text(json.dumps(result,indent=2))
print(json.dumps([{'base':x['base'],'lod':x['lod'],'error':x['worldError'],'parents':x['parents']} for x in rows]))
