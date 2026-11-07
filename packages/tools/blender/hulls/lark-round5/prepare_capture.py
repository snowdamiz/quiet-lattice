"""CPU-only review setup. Run with run_capture_prep.py. Never saves production source."""
import bpy, json, hashlib, math
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
D=Path(__file__).resolve().parent
src=D.parents[4]/'assets/blend/hulls/lark.blend'
sha=hashlib.sha256(src.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(src))
base=list(bpy.data.collections['lark_LOD0'].all_objects)
report={'source_sha256':sha,'qualification':'REVIEW_PREPARATION_ONLY','limits':['Triangle overlaps detect surface intersections, not containment or continuous motion.','Nearest vertex distances are unsigned sampled upper bounds on minimum separation.','Diagnostic articulation angles are not authored runtime limits.'],'setups':{}}
def points(o): return [o.matrix_world@v.co for v in o.data.vertices]
def tree(obs):
 v=[];f=[]
 for o in obs:
  if o.type!='MESH':continue
  o.data.calc_loop_triangles();offset=len(v);v.extend(points(o));f.extend(tuple(offset+i for i in t.vertices) for t in o.data.loop_triangles)
 return BVHTree.FromPolygons(v,f,all_triangles=True)
def query(obs,targets):
 a=tree(obs);b=tree(targets)
 ps=[p for o in obs for p in points(o)]
 return {'surface_triangle_pairs':len(a.overlap(b)), 'vertex_nearest_m':min(b.find_nearest(p)[3] for p in ps),'sample_vertices':len(ps)}
def collection(name):
 c=bpy.data.collections.new('REVIEW_'+name);bpy.context.scene.collection.children.link(c);return c
def move(o,c):
 for old in list(o.users_collection):old.objects.unlink(o)
 c.objects.link(o);return o
def copy(o,c,shift=Vector()):
 n=o.copy();n.data=o.data.copy() if o.type=='MESH' else o.data;c.objects.link(n);n.parent=None;n.matrix_world=o.matrix_world.copy();n.location+=shift;return n
def beam(c,name,a,b,r):
 a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=(b-a).length,location=(a+b)/2)
 o=move(bpy.context.object,c);o.name=name;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def label(c,text,p):
 d=bpy.data.curves.new(text,'FONT');d.body=text;d.size=.15;o=bpy.data.objects.new(text,d);c.objects.link(o);o.location=p
canopy=[bpy.data.objects[n] for n in ('CanopyGlass','CanopyFrame')]
colliders=[o for o in bpy.data.objects if o.name.startswith('COL_') and '.' not in o.name and '_dmg' not in o.name and '_husk' not in o.name and o.type=='MESH']
meshes=[o for o in base if o.type=='MESH' and not o.name.startswith(('COL_','REF_'))]
report['source_meshes']=[o.name for o in meshes]
# Use saved geometry components for ladder measurements, including combined mesh islands.
rungs=[]
for o in meshes:
 if o.name not in ('Body','CockpitMechanismMesh','LandingMechanismMesh'):continue
 adjacency={v.index:set() for v in o.data.vertices}
 for e in o.data.edges:a,b=e.vertices;adjacency[a].add(b);adjacency[b].add(a)
 unseen=set(adjacency)
 while unseen:
  todo=[unseen.pop()];ids=[]
  while todo:
   i=todo.pop();ids.append(i)
   for j in adjacency[i]&unseen:unseen.remove(j);todo.append(j)
  ps=[o.matrix_world@o.data.vertices[i].co for i in ids];lo=Vector(tuple(min(p[k] for p in ps) for k in range(3)));hi=Vector(tuple(max(p[k] for p in ps) for k in range(3)))
  center=(lo+hi)/2
  foot_marker=bpy.data.objects['BoardingFoot'].matrix_world.translation
  sill_marker=bpy.data.objects['BoardingSill'].matrix_world.translation
  if min((center-foot_marker).length,(center-sill_marker).length)>2:continue
  rungs.append({'object':o.name,'center':list((lo+hi)/2),'bounds':[list(lo),list(hi)],'classification':'geometry island; parent identify tread versus rail'})
rungs.sort(key=lambda r:r['center'][2]);report['ladder_islands']=rungs
report['island_vertical_spacing_m']=[b['center'][2]-a['center'][2] for a,b in zip(rungs,rungs[1:])]
ground=min(p.z for o in meshes for p in points(o));report['ground_geometry_min_z']=ground
c=collection('body_grid_colliders');
for o in colliders:n=copy(o,c);n.display_type='WIRE';n.show_in_front=True
for i in range(-8,9):
 beam(c,'grid_1m',(-8,i,ground),(8,i,ground),.008);beam(c,'grid_1m',(i,-8,ground),(i,8,ground),.008)
label(c,'1m grid; 1.85m anthropometric proxy; NOT production rig',(-4,0,ground))
seat=bpy.data.objects['PilotSeat'].matrix_world.translation
foot=bpy.data.objects['BoardingFoot'].matrix_world.translation
sill=bpy.data.objects['BoardingSill'].matrix_world.translation
report['poses']={}
for name,hip,seated in [('seated',seat,True)]+[(f'boarding_{i}',foot.lerp(sill,i/4)+Vector((0,0,.9)),False) for i in range(5)]:
 pc=collection(name);pieces=[]
 pieces.append(beam(pc,name+'_torso',hip,hip+Vector((0,0,.65)),.19))
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.15,location=hip+Vector((0,0,.8)));pieces.append(move(bpy.context.object,pc))
 for side in (-1,1):
  h=hip+Vector((side*.11,0,0));k=h+Vector((0,.45,0) if seated else (0,0,-.45));ank=k+Vector((0,0,-.45))
  pieces.extend([beam(pc,'thigh',h,k,.085),beam(pc,'shin',k,ank,.065)])
  shoulder=hip+Vector((side*.22,0,.55));elbow=shoulder+Vector((side*.08,.20,-.22));hand=elbow+Vector((0,.25,-.1))
  pieces.extend([beam(pc,'arm',shoulder,elbow,.055),beam(pc,'forearm',elbow,hand,.045)])
 bpy.context.view_layer.update()
 report['poses'][name]={'hip':list(hip),'standing_dimension_m':1.85,'segments_m':{'legs':.9,'hip_to_crown':.95},'canopy':query(pieces,canopy),'colliders':query(pieces,colliders) if colliders else None,'production_body':False}
 label(pc,name+' proxy 1.85m',hip+Vector((.5,0,1)))
# Saved livery textures applied to independent copies of saved material graphs.
lc=collection('three_liveries');images=sorted([i for i in bpy.data.images if i.name.startswith('lark_livery_')],key=lambda i:i.name);assert len(images)==2;images=[None]+images
report['liveries']=[]
for index,img in enumerate(images):
 mats={};assigned=[]
 for o in meshes:
  n=copy(o,lc,Vector(((index-1)*18,22,0)))
  for slot in n.material_slots:
   m=slot.material
   if not m:continue
   if m.name not in mats:
    nm=m.copy();mats[m.name]=nm
    if nm.use_nodes:
     for node in nm.node_tree.nodes:
      if img and node.type=='TEX_IMAGE' and node.image and ('baseColor' in node.image.name or node.image.name.startswith('lark_livery_')):node.image=img;assigned.append(nm.name)
   slot.material=mats[m.name]
 report['liveries'].append({'image':img.name if img else 'saved default','materials':sorted(set(assigned)),'translation':[(index-1)*18,22,0],'scale':1})
 assert assigned or img is None
 label(lc,img.name if img else "saved default",((index-1)*18,28,ground))
# Socket envelopes use nearest saved hardpoint mount bounding dimensions.
mounts=[o for o in meshes if any(s in o.name.lower() for s in ('hardpoint','socket','mount'))]
report['modules']=[]
for hp in [o for o in bpy.data.objects if o.name.startswith('HP_') and '.' not in o.name]:
 mounts=mounts or [bpy.data.objects['Body']]
 mount=min(mounts,key=lambda o:((sum(points(o),Vector())/len(o.data.vertices))-hp.matrix_world.translation).length)
 ps=[p for p in points(mount) if (p-hp.matrix_world.translation).length<.65];assert ps
 dims=[max(p[k] for p in ps)-min(p[k] for p in ps) for k in range(3)]
 mc=collection(hp.name+'_module');bpy.ops.mesh.primitive_cube_add(size=1);module=move(bpy.context.object,mc);module.name='REFERENCE_MODULE_'+hp.name;module.matrix_world=hp.matrix_world.copy();module.dimensions=dims;bpy.context.view_layer.update()
 for axis in range(3):end=Vector();end[axis]=max(dims);beam(mc,'axis_'+'XYZ'[axis],hp.matrix_world.translation,hp.matrix_world@end,.015)
 samples=[]
 for angle in (-30,0,30):
  module.matrix_world=hp.matrix_world@Matrix.Rotation(math.radians(angle),4,'Y');module.dimensions=dims;bpy.context.view_layer.update()
  samples.append({'degrees':angle,'matrix':[list(r) for r in module.matrix_world],'query':query([module],meshes)})
  copy(module,mc).name='sample_'+str(angle)
 report['modules'].append({'socket':hp.name,'samples':samples,'size_source':mount.name+' vertices within 0.65m of socket (diagnostic local envelope)','dimensions':dims,'query':query([module],meshes),'warning':'Mount bounding envelope proxy, not production equipment'})
# Materialize three diagnostic poses per mechanism with exact matrices and queries.
report['articulation']=[]
for name in ('Canopy','GearAssembly'):
 root=bpy.data.objects[name];moving=[o for o in root.children_recursive if o.type=='MESH']
 if name=='Canopy':moving=canopy
 assert moving,name
 fixed=[o for o in meshes if o not in moving]
 for angle in (0,30,60):
  ac=collection(f'{name}_{angle}deg');pivot=root.matrix_world.translation;transform=Matrix.Translation(pivot)@Matrix.Rotation(math.radians(angle),4,'X')@Matrix.Translation(-pivot)
  copies=[copy(o,ac) for o in moving]
  for o in copies:o.matrix_world=transform@o.matrix_world
  bpy.context.view_layer.update();report['articulation'].append({'mechanism':name,'diagnostic_degrees':angle,'axis':'world X','pivot':list(pivot),'matrices':{o.name:[list(r) for r in o.matrix_world] for o in copies},'query':query(copies,fixed),'limits':'Authored range unavailable; diagnostic samples only'})
report['open']=['Production actor fit and boarding reach/contact','Continuous articulation, containment and runtime collision','Whole-shell denominator; retain only existing 19.64% dorsal claim','Glyph finish and flicker; no speculative source edit','Parent capture and final export']
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.render.threads_mode='FIXED';scene.render.threads=2
for c in bpy.data.collections:
 if c.name.startswith('REVIEW_'):c.hide_render=True
report['capture_instructions']='Enable one REVIEW collection at a time; three_liveries contains all three identical-scale ships. Hide original collections for lineup. Use uniform world lighting. No rendering performed.'
output=D/'scratch/capture-preparation.blend';bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)
assert hashlib.sha256(src.read_bytes()).hexdigest()==sha
report['scene']=str(output);report['scene_bytes']=output.stat().st_size
(D/'capture-preparation.json').write_text(json.dumps(report,indent=2))
