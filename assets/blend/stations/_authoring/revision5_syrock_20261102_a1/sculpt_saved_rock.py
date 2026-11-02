"""One scoped edit of the saved rock; the exporter never invokes this operation."""
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
OUT = ROOT / 'assets/renders/stations/round5/syrock_20261102_a1'
sys.path[:0] = [str(HERE), str(HERE.parent)]
from paint_rock_regions import paint, TILE_METRES
from round4_common import compare, digest, save_report, snapshot
import sy_kit as S

SOURCE = OUT / 'preserved_round4/scrapyard.blend'
DEST = OUT / 'staged/stations/scrapyard.blend'
NATURAL = {'SY_Rock', 'SY_Regolith', 'SY_Fracture_R4', 'SY_Excavated_R4'}
assert digest(SOURCE) == 'f4a8c86c06314aa8ce6a5c9f21973e41860c94252de1aeabad86fc8a15164be9'
assert not DEST.exists()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False)
scene = bpy.context.scene
scene.render.threads_mode = 'FIXED'; scene.render.threads = 2
before = snapshot()
rock = bpy.data.objects['sy_rock_L0']
changed = {f'sy_rock_L{k}' for k in range(4)}


def smooth(a, b, value):
    t = max(0.0, min(1.0, (value-a)/(b-a)))
    return t*t*(3-2*t)


def angular(phi, values):
    phi %= math.tau
    knots = [0,.42,1.13,1.87,2.61,3.18,3.94,4.68,5.49,math.tau]
    return float(np.interp(phi, knots, values))


PLANES = [(np.array([.23,-.15,1.]),45.), (np.array([-1.,.15,.20]),54.),
          (np.array([1.,-.30,.12]),58.), (np.array([.40,1.,-.12]),101.),
          (np.array([.20,-.08,-1.]),57.)]


def sculpt(point):
    old = np.asarray(point, dtype=float); p = old.copy()
    length = np.linalg.norm(old)
    if length < 1: return p
    direction = old/length
    outside = smooth(.69,.87,length/S.radius(direction))
    for normal, limit in PLANES:
        excess = np.dot(normal,p)-limit
        if excess > 0: p -= normal*excess/np.dot(normal,normal)*outside
    rho = math.hypot(old[0],old[2]); phi = math.atan2(old[2],old[0])
    rim = (1-smooth(-91,-49,old[1]))*smooth(23,36,rho)
    lower = .3+.7*smooth(-34,-14,old[2])
    radial = angular(phi,[5,10,2,8,3,7,2,4,9,5])*rim*lower
    if rho > 1:
        p[0] += old[0]/rho*radial; p[2] += old[2]/rho*radial
    p[1] += angular(phi,[8,-7,15,-3,9,2,-5,7,-2,8])*rim*lower
    # Three unequal upper quarry cuts enlarge the cavity, leaving its occupied floor alone.
    if old[2] > 5 and length/S.radius(direction) < .84:
        for center, scale, depth in [((28,-54,30),(23,27,17),4.),
                                     ((-39,-6,26),(19,31,15),3.),
                                     ((18,53,28),(26,22,16),4.5)]:
            q=(old-np.array(center))/np.array(scale)
            cut=max(0.,1.-np.dot(q,q))**2
            p += direction*depth*cut
    return p


# The repeated thirteen-piece lip row is removed as separate saved solids, not regenerated.
old_lip = [o for o in bpy.data.collections['sy_rock'].objects if o.name.startswith('COL_R4Geo_LipFragment')]
assert len(old_lip) == 13
quantize = lambda p: tuple(round(float(v),3) for v in p)
lip_points = {quantize(o.matrix_world@v.co) for o in old_lip for v in o.data.vertices}
bm=bmesh.new();bm.from_mesh(rock.data)
remove=[v for v in bm.verts if quantize(rock.matrix_world@v.co) in lip_points]
assert len(remove) >= 13*10, len(remove)
bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(rock.data);bm.free()
for obj in old_lip:
    changed.add(obj.name);bpy.data.objects.remove(obj,do_unlink=True)

warp_records=[]
for obj in list(bpy.data.objects):
    if obj.name == 'sy_rock_L0' or obj.name.startswith(('COL_Rock_','COL_R4Geo_')):
        inverse=obj.matrix_world.inverted();maximum=0.
        for vertex in obj.data.vertices:
            old=obj.matrix_world@vertex.co;new=Vector(sculpt(old))
            maximum=max(maximum,(new-old).length);vertex.co=inverse@new
        obj.data.update();changed.add(obj.name)
        warp_records.append({'name':obj.name,'max_displacement_m':maximum})

# Triangulate the altered natural surface before assigning its final physical UV charts.
bm=bmesh.new();bm.from_mesh(rock.data)
faces=[f for f in bm.faces if rock.data.materials[f.material_index].name in NATURAL]
bmesh.ops.triangulate(bm,faces=faces);bm.normal_update();bm.to_mesh(rock.data);bm.free();rock.data.update()
slots={m.name:i for i,m in enumerate(rock.data.materials)}
for polygon in rock.data.polygons:
    if rock.data.materials[polygon.material_index].name not in NATURAL: continue
    center=np.array(polygon.center);r=np.linalg.norm(center)
    inner=polygon.normal.dot(polygon.center)<-1
    plane=min(abs(np.dot(n,center)-limit)/np.linalg.norm(n) for n,limit in PLANES)
    name='SY_Excavated_R4' if inner else 'SY_Rock'
    if not inner and plane<1.2: name='SY_Fracture_R4'
    if polygon.normal.z>.64 and center[2]<-12: name='SY_Regolith'
    polygon.material_index=slots[name];polygon.use_smooth=False

natural_polys=[p for p in rock.data.polygons if rock.data.materials[p.material_index].name in NATURAL]
tree=BVHTree.FromPolygons([v.co for v in rock.data.vertices],[list(p.vertices) for p in natural_polys])
chunk_records=[]
shape=np.array([[-.61,-.38,-.5],[.38,-.51,-.45],[.59,.17,-.41],[-.24,.56,-.46],
                [-.43,-.24,.34],[.13,-.39,.63],[.48,.19,.21],[-.14,.40,.48],[.02,.08,.74]])
for label,target,size,angle in [('Shoulder',(-60,-75,40),(29,19,12),.3),
                               ('Brow',(42,-88,31),(18,26,9),-.45),
                               ('Port',(-58,27,32),(15,11,7),.8),
                               ('Stern',(38,93,-19),(32,16,12),-.2),
                               ('SillL',(-39,-98,-29),(11,19,7),.6),
                               ('SillR',(44,-95,-25),(7,9,5),-.8)]:
    hit,normal,_,distance=tree.find_nearest(Vector(target));assert hit is not None
    n=np.array(normal);n/=np.linalg.norm(n)
    if np.dot(n,np.array(hit))<0:n=-n
    tangent=np.cross(n,[0.,0.,1.])
    if np.linalg.norm(tangent)<.01:tangent=np.cross(n,[0.,1.,0.])
    tangent/=np.linalg.norm(tangent);up=np.cross(n,tangent)
    t=tangent*math.cos(angle)+up*math.sin(angle);u=np.cross(n,t)
    origin=np.array(hit)-n*size[2]*.24
    points=[origin+t*p[0]*size[0]+u*p[1]*size[1]+n*p[2]*size[2] for p in shape]
    bm=bmesh.new();verts=[bm.verts.new(p) for p in points]
    bmesh.ops.convex_hull(bm,input=verts,use_existing_faces=False)
    unused=[v for v in bm.verts if not v.link_faces]
    if unused:bmesh.ops.delete(bm,geom=unused,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    mesh=bpy.data.meshes.new(f'R5_{label}');bm.to_mesh(mesh);bm.free()
    for name in [m.name for m in rock.data.materials]:mesh.materials.append(bpy.data.materials[name])
    for p in mesh.polygons:p.material_index=slots['SY_Fracture_R4' if p.normal.dot(Vector(n))<.6 else 'SY_Rock']
    chunk=bpy.data.objects.new(f'R5_{label}',mesh);bpy.data.collections['sy_rock_LOD0'].objects.link(chunk)
    collider=bpy.data.objects.new(f'COL_R5Cleave_{label}',mesh.copy());collider.data.materials.clear();bpy.data.collections['sy_rock'].objects.link(collider)
    collider.hide_render=True;collider['collider']=True;changed.add(collider.name)
    bpy.ops.object.select_all(action='DESELECT');rock.select_set(True);chunk.select_set(True);bpy.context.view_layer.objects.active=rock;bpy.ops.object.join()
    chunk_records.append({'label':label,'contact':list(hit),'size_m':list(size),'nearest_distance_m':distance,'collider':collider.name})


def project(obj):
    mesh=obj.data
    uv=mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    anisotropy=[]
    for p in mesh.polygons:
        if mesh.materials[p.material_index].name not in NATURAL:continue
        normal=np.array(p.normal);axis=int(np.argmax(abs(normal)));axes=[a for a in range(3) if a!=axis]
        anisotropy.append(1/max(abs(normal[axis]),1e-8))
        for loop in p.loop_indices:
            point=obj.matrix_world@mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv=(point[axes[0]]/TILE_METRES,point[axes[1]]/TILE_METRES)
    return {'natural_faces':len(anisotropy),'metric_tile_m':TILE_METRES,
            'projection_anisotropy_max':float(max(anisotropy)),'projection_anisotropy_p95':float(np.percentile(anisotropy,95))}


uv_records={'LOD0':project(rock)}
maps=paint(HERE/'textures')
for name in NATURAL:
    material=bpy.data.materials[name]
    images=[n for n in material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
    for channel in ('base','orm','normal'):
        path=HERE/'textures'/f'{name}_R5_{channel}.png'
        targets=[n for n in images if f'_{channel}' in n.image.name];assert len(targets)==1,(name,channel)
        img=bpy.data.images.load(str(path),check_existing=False);img.name=f'{name}_R5_{channel}'
        img.colorspace_settings.name='sRGB' if channel=='base' else 'Non-Color';img.pack()
        targets[0].image=img

for lod,ratio in ((1,.65),(2,.36),(3,.035)):
    bpy.data.objects.remove(bpy.data.objects[f'sy_rock_L{lod}'],do_unlink=True)
    obj=bpy.data.objects.new(f'sy_rock_L{lod}',rock.data.copy());bpy.data.collections[f'sy_rock_LOD{lod}'].objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    modifier=obj.modifiers.new('R5_AuthoredCleaveLOD','DECIMATE');modifier.ratio=ratio;modifier.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=modifier.name);uv_records[f'LOD{lod}']=project(obj)
triangles=[sum(len(p.vertices)-2 for p in bpy.data.objects[f'sy_rock_L{k}'].data.polygons) for k in range(4)]
assert 8000<=triangles[0]<=60000 and all(a>b for a,b in zip(triangles,triangles[1:])) and triangles[-1]<triangles[0]*.05
assert all(v['projection_anisotropy_max']<=math.sqrt(3)+.001 for v in uv_records.values())
invariants=compare(before,snapshot(),changed,NATURAL)
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene['station_submission']=5
scene['round5_scope']='Saved asymmetrical cleaved mass, unequal quarry cuts, sparse local fracture/mineral PBR and metric final-surface charts'
DEST.parent.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.save_as_mainfile(filepath=str(DEST),compress=True)
save_report(OUT/'authored_saved_source.json',{'input_sha256':digest(SOURCE),'output_sha256':digest(DEST),
    'saved_source':str(DEST),'triangles':triangles,'uv':uv_records,'rock_material_maps':maps,
    'removed_repeated_lip_solids':len(old_lip),'removed_lip_vertices':len(remove),'new_cleaved_chunks':chunk_records,
    'warped_objects':warp_records,'invariants':invariants,'render_performed':False,'bakes_performed':False,
    'runtime_route_validation':'PENDING saved-source geometric audit; no runtime traversal claim','threads':2})
print('SAVED FIFTH SCRAPYARD SOURCE',str(DEST),triangles,uv_records)
