"""Save explicit lighter nest-shelter LODs after its export exceeded 5% at LOD3.

The unmodified family decimator's collapsed caps gained triangles on glTF import.
Triangulate the saved reductions and leave more margin at LOD3. LOD0 and its
painted atlas are preserved. The exporter reads these, it never rebuilds them.
"""
from pathlib import Path
import sys
import bpy
import bmesh

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from artlib import lods, scene as S

ROOT=Path(__file__).resolve().parents[4]
name='den_nest_1'
file=ROOT/'assets/blend/sites'/(name+'.blend')
bpy.ops.wm.open_mainfile(filepath=str(file))
asset=bpy.data.collections[name]
original=bpy.data.objects[name+'_Sculpt']
t0=S.tri_count(original)
for n,ratio in [(1,.30),(2,.10),(3,.018)]:
    old=bpy.data.collections.get(f'{name}_LOD{n}')
    if old:
        for o in list(old.objects): bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.collections.remove(old)
    coll=bpy.data.collections.new(f'{name}_LOD{n}'); asset.children.link(coll)
    copy=original.copy(); copy.data=original.data.copy(); copy.name=f'{name}_SculptLOD{n}'
    coll.objects.link(copy)
    if n==3:
        # Tiny closed leaf shells resist collapse and triangulate into fans.
        # Keep the seven basket courses, three stems and three canopy blades:
        # those define the distant silhouette; omit bedding and crevice fronds.
        keep={g.index for g in copy.vertex_groups if g.name.startswith(('DishWeave','ShelterStem')) or g.name in ('ShelterBlade0_2','ShelterBlade1_2','ShelterBlade2_2')}
        drop={v.index for v in copy.data.vertices if not any(g.group in keep for g in v.groups)}
        bm=bmesh.new(); bm.from_mesh(copy.data); bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[bm.verts[i] for i in drop],context='VERTS')
        bm.to_mesh(copy.data); bm.free(); S.clear_cache()
    lods._decimate([copy],int(t0*ratio))
    tri=copy.modifiers.new('ExplicitTriangles','TRIANGULATE')
    with bpy.context.temp_override(object=copy,active_object=copy): bpy.ops.object.modifier_apply(modifier=tri.name)
    # Triangulated decimation can retain duplicate cap faces. Clean the saved
    # mesh here so it agrees with the valid geometry consumed by glTF export.
    copy.data.validate(verbose=True,clean_customdata=False)
    S.clear_cache()
    copy.hide_set(True)
bpy.context.scene['den_lod_revision']='explicit triangulated .30/.10/.018 reductions after compressed LOD3 exceeded 5%'
bpy.ops.wm.save_as_mainfile(filepath=str(file),compress=True)
