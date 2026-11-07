"""Read-only source sampling. Run through run_stage.py; no export or render.
Surface proximity and ray samples are diagnostics, not continuous collision proof.
"""
import bpy,json,hashlib,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
D=Path(__file__).resolve().parent
src=D.parents[4]/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src))
def triangles(objects, material=None):
    verts=[];faces=[]
    for o in objects:
        if o.type!='MESH':continue
        m=o.data;m.calc_loop_triangles()
        for t in m.loop_triangles:
            if material and not material(m.materials[t.material_index].name):continue
            faces.append(tuple(range(len(verts),len(verts)+3)))
            verts.extend(o.matrix_world@m.vertices[i].co for i in t.vertices)
    return verts,faces
def tree(objects, material=None):
    v,f=triangles(objects,material);return BVHTree.FromPolygons(v,f,all_triangles=True)
base=list(bpy.data.collections['lark_LOD0'].all_objects)
husk=list(bpy.data.collections['lark_husked_LOD0'].all_objects)
# Exterior plate candidate denominator includes hull/accent skins across all normals.
# Ray visibility rejects buried back faces, but open cavities can expose inner skins.
plates=lambda n:n in ('Lark_Hull','Lark_Accent')
v,f=triangles(base,plates);ref=tree(base,plates);target=tree(husk)
areas=0;lost={str(t):0 for t in (.02,.05,.10)};samples=0
for face in f:
    a,b,c=(v[i] for i in face);cross=(b-a).cross(c-a);area=cross.length/2
    if area<1e-10:continue
    n=cross.normalized()
    for weights in ((2/3,1/6,1/6),(1/6,2/3,1/6),(1/6,1/6,2/3)):
        p=a*weights[0]+b*weights[1]+c*weights[2]
        if ref.ray_cast(p+n*.002,n,30)[0] is not None:continue
        areas+=area/3;samples+=1
        for tolerance in (.02,.05,.10):
            hit=target.ray_cast(p+n*tolerance,-n,tolerance*2)[0]
            if hit is None:lost[str(tolerance)]+=area/3
report={'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),
 'shell_sampling':{'denominator':'Exterior-visible triangle samples of all LOD0 Lark_Hull and Lark_Accent surfaces, all directions, area weighted, three barycentric samples/triangle; visibility along outward normal. Includes potentially exposed inner skins; semantic outerplate identification remains required.', 'area_m2':areas,'samples':samples,'missing_area_m2':lost,'fraction':{k:x/areas for k,x in lost.items()},'qualification':'UNPROVEN whole-shell percentage: material roles do not uniquely identify outer plates; inherited versus newly removed area requires historical source comparison.'},
 'glyph_objects':[o.name for o in husk if 'glyph' in o.name.lower()],
 'emissive_seam_faces':sum(sum(1 for p in o.data.polygons if 'HollowSeam' in o.data.materials[p.material_index].name) for o in husk if o.type=='MESH'),
 'livery_images':[i.name for i in bpy.data.images if 'livery' in i.name],
 'static_limits':['Finite samples cannot prove continuous clearance, reachability, collision response, swept motion or runtime flicker.','No geometry correction justified from missing evidence or ambiguous plate classification.']}
# Actual transformed reference body vertices versus canopy triangles (standing reference only).
body=bpy.data.objects['REF_Biped'];canopy=tree([bpy.data.objects['CanopyGlass'],bpy.data.objects['CanopyFrame']])
points=[body.matrix_world@v.co for v in body.data.vertices]
report['reference_body']={'height_m':max(p.z for p in points)-min(p.z for p in points),'standing_nearest_canopy_vertex_sample_m':min(canopy.find_nearest(p)[3] for p in points),'seated_clearance':'OPEN: reference is unrigged standing mesh; do not substitute origin distance for seated head envelope'}
report['markers']={o.name:{'matrix':[list(r) for r in o.matrix_world]} for o in base if o.type=='EMPTY'}
report['colliders']=[o.name for o in bpy.data.objects if o.name.startswith('COL_') and '.' not in o.name and '_husk' not in o.name and '_dmg' not in o.name]
report['articulation_samples']={name:[0, .5,1] for name in ('canopy','gear','hardpoint')}
report['articulation_status']='Prepared normalized sample schedule only; authored axes/limits must be applied before clearance certification.'
(D/'objective-measurements.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:report[k] for k in ('shell_sampling','reference_body','glyph_objects','emissive_seam_faces','livery_images')},indent=2))
