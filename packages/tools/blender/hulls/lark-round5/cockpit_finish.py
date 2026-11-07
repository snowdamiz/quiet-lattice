import bpy,math,json,hashlib,shutil
from pathlib import Path
from mathutils import Vector
D=Path(__file__).resolve().parent;src=D.parents[4]/'assets/blend/hulls/lark.blend'
shutil.copy2(src,D/'scratch/cockpit-before.blend')
bpy.ops.wm.open_mainfile(filepath=str(src))
o=bpy.data.objects['CockpitMechanismMesh'];m=o.data
faces=[p for p in m.polygons if abs((o.matrix_world@p.center).z-1.25)<1e-5 and abs(p.center.x)<.49 and 1.89<p.center.y<2.21]
assert faces and all(p.normal.z>.99 for p in faces)
report={'screen_matrix':[list(r) for r in o.matrix_world],'face_normals':[list(p.normal) for p in faces],'offset_m':.003,'added':{}}
for variant in ('lark','lark_damaged','lark_husked'):
 for lod in range(3):
  coll=bpy.data.collections[f'{variant}_LOD{lod}'];target=next(o for o in coll.all_objects if o.type=='MESH' and o.name.startswith('Cockpit'))
  mat=target.data.materials[0]
  # Reuse the variant's existing Trim atlas response; husk retains its dark material.
  if variant!='lark_husked':
   mat=next((m for ob in coll.all_objects if ob.type=='MESH' for m in ob.data.materials if m and m.get('engine_name')=='Trim'),mat)
  vs=[];fs=[]
  def stroke(a,b,r=.003):
   a,b=Vector(a),Vector(b);axis=(b-a).normalized();side=axis.cross(Vector((0,0,1)))
   if side.length<.01:side=axis.cross(Vector((1,0,0)))
   side.normalize();up=axis.cross(side);base=len(vs);n=6 if lod==0 else 4
   for p in (a,b):
    for k in range(n):vs.append(tuple(p+r*(side*math.cos(k*math.tau/n)+up*math.sin(k*math.tau/n))))
   for k in range(n):fs.append((base+k,base+(k+1)%n,base+n+(k+1)%n,base+n+k))
  if lod<2 and variant!='lark_husked':
   stroke((-.33,2.055,1.253),(.33,2.055,1.253),.002)
   for i in range(-3,4):
    x=i*.09;stroke((x,2.045,1.253),(x,2.075 if i%2 else 2.09,1.253),.002)
   for y,length in [(1.955,.43),(1.99,.29)]:stroke((-.32,y,1.253),(-.32+length,y,1.253),.003)
   for x in (-.39,.39):
    stroke((x,1.94,1.253),(x,2.16,1.253),.002)
   for side in (-1,1):
    for j in range(3):
     y=1.51+j*.08;x=side*.45;z=1.013
     stroke((x-.025,y-.012,z),(x+.025,y-.012,z),.002)
     for k in range(j+1):stroke((x-.02+k*.015,y-.009,z),(x-.02+k*.015,y+.009,z),.002)
  # Overlapping cushion edge binding, following the existing inclined back pad.
  path=[(-.208,.974,.823),(.208,.974,.823),(.208,1.386,.823),(-.208,1.386,.823),(-.208,.974,.823)]
  for a,b in zip(path,path[1:]):stroke(a,b,.004)
  for x in (-.203,.203):stroke((x,1.127,.84),(x,.999,1.39),.004)
  stroke((-.203,.999,1.39),(.203,.999,1.39),.004)
  mesh=bpy.data.meshes.new('CockpitFaceJoinery');mesh.from_pydata(vs,[],fs);mesh.materials.append(mat);uv=mesh.uv_layers.new(name='UVMap')
  for p in mesh.polygons:
   q=[mesh.vertices[i].co for i in p.vertices];w=(q[1]-q[0]).length;h=(q[3]-q[0]).length
   for li,co in zip(p.loop_indices,[(.85,.85),(.85+w*600/4096,.85),(.85+w*600/4096,.85+h*600/4096),(.85,.85+h*600/4096)]):uv.data[li].uv=co
  obj=bpy.data.objects.new('CockpitFaceJoinery',mesh);coll.objects.link(obj)
  bpy.ops.object.select_all(action='DESELECT');target.select_set(True);obj.select_set(True);bpy.context.view_layer.objects.active=target;bpy.ops.object.join();report['added'][coll.name]=len(fs)*2
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True)
report['sha256']=hashlib.sha256(src.read_bytes()).hexdigest();(D/'cockpit-authoring.json').write_text(json.dumps(report,indent=2))
