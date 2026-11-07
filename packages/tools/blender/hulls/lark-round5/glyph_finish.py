import bpy,json,hashlib,runpy,sys,math
from pathlib import Path
from mathutils import Vector
D=Path(__file__).resolve().parent;src=D.parents[4]/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src))
for o in list(bpy.data.objects):
 if o.name.startswith('HollowGlyph_LOD'):bpy.data.objects.remove(o,do_unlink=True)
def digest(o):
 m=o.data
 return hashlib.sha256(repr(([tuple(v.co) for v in m.vertices],[tuple(p.vertices) for p in m.polygons],[[tuple(x.uv) for x in u.data] for u in m.uv_layers])).encode()).hexdigest()
old={o.name:digest(o) for o in bpy.data.objects if o.type=='MESH'}
images={i.name:hashlib.sha256(bytes(i.packed_file.data)).hexdigest() for i in bpy.data.images if i.packed_file}
before=hashlib.sha256(src.read_bytes()).hexdigest();rows=[]
# Broken hexagonal rim and spoke fragments, projected onto surviving shoulder ribs.
for lod in range(3):
 coll=bpy.data.collections[f'lark_husked_LOD{lod}'];body=next(o for o in coll.objects if o.type=='MESH' and o.name.startswith('Body'))
 mesh=body.data
 verts=[];faces=[];uvs=[]
 candidates=[p for p in mesh.polygons if mesh.materials[p.material_index].name=='LIB_HollowSeam_Lark' and p.normal.z>.15]
 candidates.sort(key=lambda p:-p.area)
 chosen=[]
 for p in candidates:
  c=body.matrix_world@p.center
  if any((c-q).length<.35 for q in chosen):continue
  chosen.append(c)
  p.material_index=next(i for i,m in enumerate(mesh.materials) if 'HuskDark' in m.name)
  n=(body.matrix_world.to_3x3()@p.normal).normalized()
  u=n.cross(Vector((0,1,0))).normalized();v=n.cross(u).normalized()
  radius=min(.14,math.sqrt(p.area)*.24)
  if radius<.025:continue
  nodes=[c+(u*math.sin(i*math.pi/3)+v*math.cos(i*math.pi/3))*radius for i in range(6)]
  for a,b in [(nodes[0],nodes[1]),(nodes[1],c),(nodes[3],nodes[4]),(nodes[4],nodes[5])][:4 if lod<2 else 2]:
   a=a.lerp(b,.1);b=b.lerp(a,.1);width=radius*.10;side=n.cross((b-a).normalized())*width/2
   pts=[a-side,b-side,b+side,a+side];start=len(verts);verts.extend(q+n*.002 for q in pts);faces.append(tuple(range(start,start+4)))
   length=(b-a).length;uvs.extend([(.5,.5),(.5+length*.25,.5),(.5+length*.25,.5+width*.25),(.5,.5+width*.25)])
  if len(chosen)>=(3 if lod==0 else 2):break
 m=bpy.data.meshes.new(f'HollowGlyph_LOD{lod}');m.from_pydata(verts,[],faces);m.materials.append(bpy.data.materials['LIB_HollowSeam_Lark']);uv=m.uv_layers.new(name='UVMap')
 for i,v in enumerate(uvs):uv.data[i].uv=v
 o=bpy.data.objects.new(f'HollowGlyph_LOD{lod}',m);coll.objects.link(o)
 rows.append({'lod':lod,'strokes':len(faces),'triangles':len(faces)*2})
assert rows[0]['strokes']>=3,rows
assert all(digest(bpy.data.objects[n])==h for n,h in old.items())
assert images=={i.name:hashlib.sha256(bytes(i.packed_file.data)).hexdigest() for i in bpy.data.images if i.packed_file}
bpy.context.scene.cycles.device='CPU';bpy.context.scene.cycles.denoising_use_gpu=False
bpy.ops.wm.save_as_mainfile(filepath=str(src))
counts={}
for v in ('lark','lark_damaged','lark_husked'):
 counts[v]=[]
 for l in range(4):
  n=0
  for o in bpy.data.collections[f'{v}_LOD{l}'].all_objects:
   if o.type=='MESH':o.data.calc_loop_triangles();n+=len(o.data.loop_triangles)
  counts[v].append(n)
 a=counts[v];assert 60000<=a[0]<=150000 and all(x>y for x,y in zip(a,a[1:])) and a[3]<a[0]*.05
(D/'glyph-receipt.json').write_text(json.dumps({'before_sha256':before,'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'preserved_meshes':len(old),'packed_images_unchanged':True,'glyphs':rows,'lod_triangles':counts,'emission':'existing LIB_HollowSeam_Lark #9FE8DA strength 0.5 static','preview_budget':'44/48 after one closeup','limits':'Static fragments only; no whole-shell classification, export, runtime or visual PASS'},indent=2))
s= (D/'husk_density.py').read_text().replace("OUT / 'scratch/husk-openings.blend'","ROOT / 'assets/blend/hulls/lark.blend'").replace("'husk-density.json'","'glyph-density.json'").replace("out.open('x')","out.open('w')")
exec(compile(s,str(D/'husk_density.py'),'exec'),{'__file__':str(D/'husk_density.py'),'__name__':'__main__'})
sys.path.insert(0,str(D.parents[1]));sys.argv=['validate.py','--',str(src),'--family','hulls','--report',str(D/'glyph-validation.json')]
runpy.run_path(str(D.parents[1]/'validate.py'),run_name='__main__')
