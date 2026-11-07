"""Repair only the far LOD: restore canonical R3 topology and transfer high-detail normals."""
import bpy
import bmesh
import hashlib
import json
import os
from pathlib import Path
import re
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
import numpy as np

out=Path(os.environ['MULE_ATTEMPT'])
source=Path('assets/blend/hulls/mule.blend').resolve()
baseline=Path('/Users/andreyyurlov/Documents/dev/space/.git/lfs/objects/3c/34/3c3437f2fbc6b6523113c5e45d9bb8f5b06cce33b3bcb3c57d4a391fdc035dd4')
assert hashlib.file_digest(baseline.open('rb'),'sha256').hexdigest()==baseline.name
bpy.ops.wm.open_mainfile(filepath=str(source))
bpy.context.preferences.filepaths.save_version=0
original={kind:{x.as_pointer() for x in getattr(bpy.data,kind)} for kind in ['materials','images','node_groups']}
names=['Body_l3','Body_dmg_l3','Body_husk_l3']
with bpy.data.libraries.load(str(baseline),link=False) as (src,dst):
    assert all(n in src.objects for n in names)
    dst.objects=names
report={}
def role(m):return str(m.get('engine_name') or re.sub(r'\.\d{3}$','',m.name))
def geometry(o):
    me=o.data
    return hashlib.sha256(np.array(o.matrix_world,dtype=np.float32).tobytes()+np.array([v.co[:] for v in me.vertices],dtype=np.float32).tobytes()+np.array([l.vertex_index for l in me.loops],dtype=np.int32).tobytes()+np.array([(p.loop_start,p.loop_total,p.material_index) for p in me.polygons],dtype=np.int32).tobytes()+np.array([d.uv[:] for d in me.uv_layers.active.data],dtype=np.float32).tobytes()).hexdigest()
for variant,suffix in [('mule',''),('mule_damaged','_dmg'),('mule_husked','_husk')]:
    low=bpy.data.objects['Body'+suffix+'_l3'];high=bpy.data.objects['Body'+suffix]
    original_geometry=geometry(low)
    doomed=[]
    for face in low.data.polygons:
        co=[low.data.vertices[i].co for i in face.vertices]
        edge=max((co[(i+1)%len(co)]-co[i]).length for i in range(len(co)))
        if face.area<1e-9 or (2*face.area/max(edge,1e-20))<1e-5:doomed.append(face.index)
    removed_area=sum(low.data.polygons[i].area for i in doomed)
    bm=bmesh.new();bm.from_mesh(low.data);bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm,geom=[bm.faces[i] for i in doomed],context='FACES_ONLY')
    bm.to_mesh(low.data);bm.free();low.data.update()
    before=geometry(low);me=high.data;me.calc_loop_triangles();cn=me.corner_normals
    assert np.allclose(np.array(low.matrix_world),np.array(high.matrix_world))
    assert len(low.material_slots)<=len(high.material_slots)  # husk LOD3 omits unused dead-nav slots
    for i,slot in enumerate(low.material_slots):
        assert role(slot.material)==role(high.material_slots[i].material)
        slot.link='DATA';low.data.materials[i]=high.material_slots[i].material
    atlases={}
    for mi in {p.material_index for p in me.polygons}:
        triangles=[t for t in me.loop_triangles if t.material_index==mi and t.area>1e-10]
        points=[];polys=[];normals=[]
        for t in triangles:
            polys.append(tuple(range(len(points),len(points)+3)))
            points.extend(me.vertices[i].co.copy() for i in t.vertices)
            normals.append([cn[i].vector.copy() for i in t.loops])
        atlases[mi]=(BVHTree.FromPolygons(points,polys,all_triangles=True),points,polys,normals)
    normals=[None]*len(low.data.loops);maximum=0
    for p in low.data.polygons:
        tree,points,polys,ns=atlases[p.material_index]
        for li in p.loop_indices:
            co=low.data.vertices[low.data.loops[li].vertex_index].co
            nearest=tree.find_nearest(co);assert nearest[0] is not None
            candidates=tree.find_nearest_range(co,nearest[3]+.002)
            q,n,index,dist=min(candidates,key=lambda x:x[3]+.02*(1-max(-1,min(1,p.normal.dot(x[1])))))
            a,b,c=[points[j] for j in polys[index]]
            normals[li]=barycentric_transform(q,a,b,c,*ns[index]).normalized()[:]
            maximum=max(maximum,dist)
    for edge in low.data.edges:edge.use_edge_sharp=True
    for face in low.data.polygons:face.use_smooth=True
    low.data.normals_split_custom_set(normals)
    assert geometry(low)==before,'far topology or UV altered'
    col=bpy.data.collections[variant+'_LOD3']
    for name in ['R4_Panels'+suffix+'_l3','R4_Structure'+suffix+'_l3']:
        bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)
    col.objects.link(low);low['r4_far_source']='Canonical R3 far topology and UV, high-detail world-space normal transfer'
    low.data.calc_loop_triangles()
    bad=sum(n.vector.length<=.99 for n in low.data.corner_normals)
    print('FAR_NORMALS',variant,bad,flush=True)
    assert bad==0,(variant,bad)
    report[variant]={'original_r3_geometry_uv_sha256':original_geometry,'repaired_geometry_uv_sha256':before,'removed_degenerate_or_sub_10micrometre_altitude_faces':len(doomed),'removed_area_m2':removed_area,'body_triangles':len(low.data.loop_triangles),'maximum_nearest_surface_distance_m':maximum,'method':low['r4_far_source']}
for kind in ['materials','images','node_groups']:
    for item in list(getattr(bpy.data,kind)):
        if item.as_pointer() not in original[kind] and item.users==0:getattr(bpy.data,kind).remove(item)
for variant in ['mule','mule_damaged','mule_husked']:
    counts=[]
    for lod in range(4):
        n=0
        for o in bpy.data.collections[variant+'_LOD'+str(lod)].objects:
            if o.type=='MESH':o.data.calc_loop_triangles();n+=len(o.data.loop_triangles)
        counts.append(n)
    assert counts[3]<counts[0]*.05
    report[variant]['lod_triangles']=counts
bpy.ops.wm.save_as_mainfile(filepath=str(out/'scratch/candidate.blend'),compress=True)
(out/'far-repair.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2),flush=True)
