"""Check the actual source bezels against the plane dimensions mounted by unchanged Cockpit.js."""
import bpy,json,math,os,sys,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.geometry import convex_hull_2d
source=Path('assets/blend/hulls/swift.blend').resolve();bpy.ops.wm.open_mainfile(filepath=str(source));rows=[];failed=[]
for variant in ['swift','swift_damaged','swift_husked']:
 for lod in range(3):
  coll=bpy.data.collections[variant+f'_LOD{lod}'];interior=next(o for o in coll.objects if o.name.startswith('CockpitInteriorMesh'))
  for name,w,h in [('ScreenLeft',.3,.19),('ScreenCenter',.27,.27),('ScreenRight',.3,.19)]:
   marker=next(o for o in coll.objects if o.name.startswith(name));point=marker.matrix_world.translation
   # Find the exported glass inset nearest the marker. This is measured from actual mesh polygons.
   candidates=[]
   for p in interior.data.polygons:
    mat=interior.material_slots[p.material_index].material
    if mat.get('engine_name')!='Glass':continue
    center=interior.matrix_world@p.center
    candidates.append(((center-point).length,p))
   if not candidates:failed.append(f'{variant} LOD{lod} no glass insets');continue
   distance,face=min(candidates,key=lambda x:x[0]);normal=(interior.matrix_world.to_3x3()@face.normal).normalized()
   linked=set(face.vertices);expanded=True
   while expanded:
    expanded=False
    for _,other in candidates:
     if linked.intersection(other.vertices) and not set(other.vertices)<=linked:linked.update(other.vertices);expanded=True
   points=[interior.matrix_world@interior.data.vertices[i].co for i in linked]
   right=Vector((1,0,0));up=normal.cross(right).normalized();origin=points[0]
   flat=[Vector(((p-origin).dot(right),(p-origin).dot(up))) for p in points];hull=[flat[i] for i in convex_hull_2d(flat)]
   if sum(a.x*b.y-b.x*a.y for a,b in zip(hull,hull[1:]+hull[:1]))<0:hull.reverse()
   errors=[]
   for x,y in [(-w/2,-h/2),(w/2,-h/2),(w/2,h/2),(-w/2,h/2)]:
    corner=marker.matrix_world@Vector((x,y,0));plane=(corner-origin).dot(normal)
    q=Vector(((corner-origin).dot(right),(corner-origin).dot(up)))
    if not -.001<=plane<=.020:errors.append('plane separation')
    for a,b in zip(hull,hull[1:]+hull[:1]):
     if (b.x-a.x)*(q.y-a.y)-(b.y-a.y)*(q.x-a.x)<-1e-5:errors.append('outside bezel');break
   aligned=(marker.matrix_world.to_3x3()@Vector((0,0,1))).normalized().dot(normal)
   if aligned<.999:errors.append('normal mismatch')
   rows.append({'variant':variant,'lod':lod,'marker':marker.name,'nearestGlassFace':face.index,'centerDistance':distance,'normalDot':aligned,'errors':errors})
   if errors:failed.append(f'{variant}/LOD{lod}/{name}: '+','.join(sorted(set(errors))))
out={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'status':'FAIL' if failed else 'PASS','failures':failed,'measurements':rows,'runtimeDimensionsFrom':'packages/client/src/entities/Cockpit.js:39-41'}
Path(os.environ['SWIFT_JOB'],'display-fit.json').write_text(json.dumps(out,indent=2));print(json.dumps({'status':out['status'],'failures':failed}));sys.exit(1 if failed else 0)
