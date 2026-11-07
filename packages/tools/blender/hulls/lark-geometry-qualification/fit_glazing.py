"""Reconstruct glazing from the saved frame's tube centre curves, not the obsolete CAN profile."""
import bpy,json,hashlib
from pathlib import Path
from mathutils import Vector
import argparse,sys
ap=argparse.ArgumentParser();ap.add_argument('--source',required=True);ap.add_argument('--output',required=True)
a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);src=Path(a.source).resolve();output=Path(a.output).resolve()
assert src != output, 'Disposable output required'
assert not output.exists(), 'Refuse overwrite'
P=Path(__file__).resolve()
assert hashlib.sha256(src.read_bytes()).hexdigest()=='d48d83e9c6a76b0214028a80389a77d6dfd19f65704c73ffc9f47dca58b244ba'
bpy.ops.wm.open_mainfile(filepath=str(src))
def sample(points,t):
 t=max(0,min(len(points)-1,t));i=min(int(t),len(points)-2);return points[i].lerp(points[i+1],t-i)
def rail(points,y):
 for a,b in zip(points,points[1:]):
  if a.y<=y<=b.y:return a.lerp(b,(y-a.y)/(b.y-a.y))
 return min(points,key=lambda p:abs(p.y-y)).copy()
report=[]
for variant,suffix in [('lark',''),('lark_damaged','_dmg'),('lark_husked','_husk')]:
 frame=bpy.data.objects['CanopyFrame'+suffix]
 v=frame.data.vertices
 c=[sum((v[j].co for j in range(i,i+8)),Vector())/8 for i in range(0,1272,8)]
 arches=[c[i:i+21] for i in range(0,84,21)]
 for lod in range(4):
  o=next(o for o in bpy.data.collections[f'{variant}_LOD{lod}'].objects if o.name.startswith('CanopyGlass'))
  assert len(v)>=1272, 'Frame topology requires inspection'
  old=o.data; verts=[];faces=[];uv=[]; n=12 if lod<3 else 6
  for band in range(3):
   for side in range(2):
    start=len(verts)
    # Ring 1 sits inside the sill tube; ring 10 is the centre rail.
    def arch(b,s):return sample(arches[b],1+9*s if side==0 else 19-9*s)
    sidecurve=c[84:109] if side==0 else c[134:159];center=c[109:134]
    for i in range(n+1):
     t=i/n
     for j in range(10):
      s=j/9;a=arch(band,s);b=arch(band+1,s);p=a.lerp(b,t)
      # Coons correction follows the rails while vanishing at arch boundaries.
      for weight,sc,ss in [(1-s,sidecurve,0),(s,center,1)]:
       aa=arch(band,ss);bb=arch(band+1,ss);q=aa.lerp(bb,t)
       correction=rail(sc,q.y)-q
       correction-= (rail(sc,aa.y)-aa).lerp(rail(sc,bb.y)-bb,t)
       p+=weight*correction
      p.z-=.006
      verts.append(o.matrix_world.inverted() @ frame.matrix_world @ p);uv.append((.02+.96*(side+s)/2,.02+.96*(band+t)/3))
    for i in range(n):
     for j in range(9):
      a=start+i*10+j;f=(a,a+10,a+11,a+1)
      faces.append(f if side==1 else tuple(reversed(f)))
  mesh=bpy.data.meshes.new(old.name+'_fitted');mesh.from_pydata(verts,[],faces);mesh.update()
  for m in old.materials:mesh.materials.append(m)
  layer=mesh.uv_layers.new(name='UVMap');layer.active_render=True
  for poly in mesh.polygons:
   poly.use_smooth=True
   for li in poly.loop_indices:layer.data[li].uv=uv[mesh.loops[li].vertex_index]
  # Orient outward/upward consistently.
  import bmesh
  bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
  if sum(f.normal.z for f in bm.faces)<0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
  bm.to_mesh(mesh);bm.free();o.data=mesh
  report.append(dict(object=o.name,before_triangles=sum(len(p.vertices)-2 for p in old.polygons),after_triangles=len(faces)*2,parent=o.parent.name if o.parent else None))
counts={}
for variant in ('lark','lark_damaged','lark_husked'):
 counts[variant]=[sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in bpy.data.collections[f'{variant}_LOD{i}'].objects if o.type=='MESH') for i in range(4)]
 assert 60000<=counts[variant][0]<=150000 and counts[variant][3]<counts[variant][0]*.05,counts
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(output))
(P.parent/'glazing-receipt.json').write_text(json.dumps(dict(objects=report,triangles=counts,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),arch_inset_frame_local=.006,partial_overall=True),indent=2))
