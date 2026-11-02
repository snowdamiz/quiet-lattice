"""Measure the actual reopened artifact after the authoring report failed; no sculpt replay."""
import json
from pathlib import Path
import sys

import bmesh
import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
OUT = ROOT / 'assets/renders/stations/round5/syrock_20261102_a1'
sys.path.insert(0,str(HERE.parent))
from round4_common import compare, digest, save_report, snapshot

SOURCE=OUT/'staged03/stations/scrapyard.blend'
INITIAL=json.loads((OUT/'initial_saved_source.json').read_text())
NATURAL={'SY_Rock','SY_Regolith','SY_Fracture_R4','SY_Excavated_R4'}
bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False)
bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
before=INITIAL['snapshot'];after=snapshot()
permitted={n for n in set(before['objects'])|set(after['objects']) if n.startswith(('sy_rock_L','COL_Rock_','COL_R4Geo_','COL_R5Cleave_'))}
invariants=compare(before,after,permitted,NATURAL)
uv_records=[]
for lod in range(4):
    obj=bpy.data.objects[f'sy_rock_L{lod}'];mesh=obj.data;uv=mesh.uv_layers.active
    ratios=[];small=[];areas=[]
    mesh.calc_loop_triangles()
    for tri in mesh.loop_triangles:
        if mesh.materials[mesh.polygons[tri.polygon_index].material_index].name not in NATURAL:continue
        p=np.array([obj.matrix_world@mesh.vertices[v].co for v in tri.vertices],dtype=float)
        a,b=p[1]-p[0],p[2]-p[0];cross=np.cross(a,b);area=np.linalg.norm(cross)*.5
        if area<1e-8 or np.linalg.norm(a)<1e-6:small.append({'triangle':tri.polygon_index,'area':float(area)});continue
        x=a/np.linalg.norm(a);y=np.cross(cross/np.linalg.norm(cross),x)
        physical=np.array([[np.dot(a,x),np.dot(b,x)],[np.dot(a,y),np.dot(b,y)]])
        q=np.array([uv.data[i].uv for i in tri.loops],dtype=float)*48.
        projected=np.column_stack([q[1]-q[0],q[2]-q[0]])
        singular=np.linalg.svd(projected@np.linalg.inv(physical),compute_uv=False)
        ratios.append(float(singular.max()/max(singular.min(),1e-12)));areas.append(float(area))
    uv_records.append({'lod':lod,'natural_triangles_measured':len(ratios),'tiny_triangles':small,
        'metric_tile_m':48.,'actual_uv_anisotropy_max':max(ratios),'actual_uv_anisotropy_p95':float(np.percentile(ratios,95)),
        'surface_area_m2':sum(areas)})
colliders=[]
for obj in bpy.data.collections['sy_rock'].objects:
    if not obj.name.startswith('COL_'):continue
    bm=bmesh.new();bm.from_mesh(obj.data)
    raw_bad=sum(not e.is_manifold for e in bm.edges)
    old_count=len(bm.verts);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bad=sum(not e.is_manifold for e in bm.edges);volume=float(bm.calc_volume(signed=True));welded=old_count-len(bm.verts);bm.free()
    colliders.append({'name':obj.name,'raw_topology_nonmanifold_edges':raw_bad,
        'coincident_vertices_welded_for_geometric_analysis':welded,'geometric_boundary_edges':bad,'signed_volume_m3':volume,
        'finite_vertices':all(np.isfinite(v.co).all() for v in obj.data.vertices)})
old_textures=[]
for image in INITIAL['images']:
    if image['external_exists']:
        assert digest(image['path'])==image['external_sha256'],image['path'];old_textures.append(image['path'])
triangles=[sum(len(p.vertices)-2 for p in bpy.data.objects[f'sy_rock_L{k}'].data.polygons) for k in range(4)]
assert 8000<=triangles[0]<=60000 and all(a>b for a,b in zip(triangles,triangles[1:])) and triangles[-1]<triangles[0]*.05
maps=[{'path':str(p),'sha256':digest(p),'bytes':p.stat().st_size} for p in sorted((HERE/'textures').glob('*.png'))]
assert len(maps)==12
for name in NATURAL:
    material=bpy.data.materials[name]
    nodes=[n for n in material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
    assert len(nodes)==3 and all(n.image.packed_file and '_R5_' in n.image.name and tuple(n.image.size)==(2048,2048) for n in nodes)
record={'source':str(SOURCE),'source_sha256':digest(SOURCE),'source_reopened':True,
    'authoring_job_exit':1,'authoring_report_failure':'NumPy float32 JSON serialization after successful save; sculpt was not replayed',
    'failed_source_copy_sha256':digest(OUT/'sculpt_source_at_report_failure.py'),'triangles':triangles,
    'uv_measurements':uv_records,'closed_colliders':colliders,'invariants':invariants,'new_maps':maps,
    'old_external_textures_verified_unchanged':old_textures,'render_performed':False,'threads':2,
    'geometric_routes':'PENDING separate saved-source audit; runtime traversal unverified'}
save_report(OUT/'reopened_final_source_audit.json',record)
print(json.dumps({'source_sha256':record['source_sha256'],'triangles':triangles,'uv':uv_records,
    'colliders':len(colliders),'invariants':invariants,'render_performed':False}))
assert all(c['geometric_boundary_edges']==0 and abs(c['signed_volume_m3'])>1e-6 and c['finite_vertices'] for c in colliders),[c for c in colliders if c['geometric_boundary_edges'] or abs(c['signed_volume_m3'])<=1e-6]
assert all(u['actual_uv_anisotropy_max']<2. for u in uv_records),uv_records
