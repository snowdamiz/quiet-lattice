"""Save exact mask carriers beside COLOR_0, working only on saved editable sources.

Blender 5.2 forces RGBA COLOR_0 to normalized ushort. Its ordinary custom FLOAT_VECTOR
and FLOAT attribute export preserves bits. The export stage promotes those carriers to
FLOAT COLOR_0, then removes them and re-runs unchanged stock validation.
"""
import sys
from pathlib import Path
import bpy
import bmesh
import numpy as np

ROOT=Path(__file__).resolve().parents[4]
kind=sys.argv[-1]
path=ROOT/'assets/blend/flora'/f'tree_{kind}_t04.blend'
bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False)
for o in bpy.data.objects:
    if o.type!='MESH' or o.name.startswith('REF_'): continue
    me=o.data
    bm=bmesh.new(); bm.from_mesh(me)
    loose=[v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm,geom=loose,context='VERTS')
        bm.to_mesh(me); me.update()
    bm.free()
    color=me.color_attributes.active_color
    if color is None: continue
    assert color.data_type=='FLOAT_COLOR' and color.domain=='POINT'
    values=np.empty(len(color.data)*4,np.float32); color.data.foreach_get('color',values)
    values=values.reshape(-1,4)
    for name,typ,prop,arr in [('_T04_MASK_RGB','FLOAT_VECTOR','vector',values[:,:3]),('_T04_MASK_AO','FLOAT','value',values[:,3])]:
        a=me.attributes.get(name) or me.attributes.new(name=name,type=typ,domain='POINT')
        a.data.foreach_set(prop,np.ascontiguousarray(arr).ravel())
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
print('Saved exact FLOAT mask carriers',kind)
