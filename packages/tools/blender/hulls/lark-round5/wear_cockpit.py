"""Author physical wear and cockpit faces into existing packed atlas; add cushion welt joins."""
import bpy,numpy as np,json,hashlib,math
from pathlib import Path
from mathutils import Vector
D=Path(__file__).resolve().parent;src=D.parents[4]/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src));before=hashlib.sha256(src.read_bytes()).hexdigest()
# Paint by world position on original render UV, never atlas-space rectangles.
changes=[]
for variant,prefix in [('lark','lark'),('lark_damaged','lark_damaged')]:
 im=bpy.data.images.get(prefix+'_4k_density_baseColor')
 if not im:continue
 w,h=im.size;a=np.empty(w*h*4,np.float32);im.pixels.foreach_get(a);a=a.reshape(h,w,4)
 for o in bpy.data.collections[variant+'_LOD0'].all_objects:
  if o.type!='MESH' or not o.data.uv_layers.get('UVMap'):continue
  m=o.data;m.calc_loop_triangles();uv=m.uv_layers['UVMap'];edgefaces={}
  for p in m.polygons:
   for e in p.edge_keys:edgefaces.setdefault(tuple(sorted(e)),[]).append(p)
  sharp={e for e,ps in edgefaces.items() if len(ps)==1 or (len(ps)==2 and ps[0].normal.dot(ps[1].normal)<.75)}
  colors={}
  for role in ('Hull','Accent','Trim','Dark'):
   samples=[]
   for p in m.polygons:
    mat=m.materials[p.material_index]
    if mat.get('engine_name')!=role:continue
    u=sum((uv.data[j].uv for j in p.loop_indices),Vector((0,0)))/len(p.loop_indices)
    samples.append(a[min(h-1,int(u.y*h)),min(w-1,int(u.x*w)),:3])
   if samples:colors[role]=np.median(samples,axis=0)
  for t in m.loop_triangles:
   mat=m.materials[t.material_index];role=mat.get('engine_name')
   if role not in colors:continue
   coords=np.array([uv.data[j].uv[:] for j in t.loops])*[w,h]
   lo=np.maximum(0,np.floor(coords.min(axis=0)).astype(int));hi=np.minimum([w-1,h-1],np.ceil(coords.max(axis=0)).astype(int))
   if np.any(hi<lo):continue
   rows=np.arange(lo[1],hi[1]+1);yc=rows+.5
   left=np.full(len(rows),np.inf);right=np.full(len(rows),-np.inf)
   for i,j in ((0,1),(1,2),(2,0)):
    aa,bb=coords[i],coords[j]
    if abs(bb[1]-aa[1])<1e-9:continue
    valid=(yc>=min(aa[1],bb[1]))&(yc<max(aa[1],bb[1]))
    ix=aa[0]+(yc-aa[1])*(bb[0]-aa[0])/(bb[1]-aa[1])
    left[valid]=np.minimum(left[valid],ix[valid]);right[valid]=np.maximum(right[valid],ix[valid])
   valid=np.isfinite(left)&np.isfinite(right)
   rows=rows[valid];left=np.maximum(0,np.ceil(left[valid]-.5).astype(int));right=np.minimum(w-1,np.floor(right[valid]-.5).astype(int));counts=np.maximum(0,right-left+1)
   yy=np.repeat(rows,counts);xx=np.repeat(left,counts)+np.arange(counts.sum())-np.repeat(np.cumsum(counts)-counts,counts)
   v0=coords[1]-coords[0];v1=coords[2]-coords[0];den=v0[0]*v1[1]-v1[0]*v0[1]
   if abs(den)<1e-8:continue
   dx=xx+.5-coords[0,0];dy=yy+.5-coords[0,1];b=(dx*v1[1]-dy*v1[0])/den;c=(v0[0]*dy-v0[1]*dx)/den;q=1-b-c;mask=(q>=0)&(b>=0)&(c>=0)
   if not mask.any():continue
   yy=yy[mask];xx=xx[mask];q=q[mask];b=b[mask];c=c[mask]
   pts=np.array([tuple(o.matrix_world@m.vertices[j].co) for j in t.vertices]);p=q[...,None]*pts[0]+b[...,None]*pts[1]+c[...,None]*pts[2];x,y,z=p[...,0],p[...,1],p[...,2]
   edge=np.zeros(xx.shape)
   for i,j in ((0,1),(1,2),(2,0)):
    if tuple(sorted((t.vertices[i],t.vertices[j]))) not in sharp:continue
    delta=pts[j]-pts[i];u=np.clip(np.sum((p-pts[i])*delta,axis=-1)/max(np.dot(delta,delta),1e-12),0,1)
    dist=np.linalg.norm(p-(pts[i]+u[...,None]*delta),axis=-1)
    edge=np.maximum(edge,np.clip(1-dist/.012,0,1))
   # Salt limited to lower surfaces and edges; polish around fitting contact rims.
   salt=edge*np.clip((-.25-z)/1.5,0,.5)
   color=np.broadcast_to(colors[role],(*xx.shape,3)).copy()
   weight=edge*.24+salt*.35
   color=color*(1-weight[...,None])+np.array([.40,.44,.41])*weight[...,None]
   # Retain all existing cockpit paint except explicitly authored broad forward display.
   if 'Cockpit' in o.name:
    color=a[yy,xx,:3].copy()
    display=(abs(x)<.46)&(y>1.89)&(y<2.21)&(z>1.245)&(z<1.255)
    color[display]=[.012,.035,.042]
    # Range ladder, heading line, twin system bars; restrained nacre/sea-green.
    line=(abs(y-2.04)<.004)&(abs(x)<.32)
    ticks=(abs((x+.3)% .1)<.006)&(y>2.03)&(y<2.065)&(abs(x)<.34)
    bars=((y>1.93)&(y<1.945)&(x>-.36)&(x<.1))|((y>1.96)&(y<1.975)&(x>-.36)&(x<.25))
    brackets=(abs(abs(x)-.39)<.006)&(y>1.93)&(y<2.17)
    color[display&(line|ticks|bars|brackets)]=[.30,.65,.57]
   a[yy,xx,:3]=color
  changes.append(o.name);print('PAINTED',variant,o.name,flush=True)
 im.pixels.foreach_set(a.ravel());im.pack();del a
# Cushion perimeter welt follows measured seat bounds, staying 3mm above existing top.
# Existing atlas and UV layer remain; joining retains cockpit ownership/articulation.
for variant in ('lark','lark_damaged','lark_husked'):
 for lod in range(3):
  coll=bpy.data.collections[f'{variant}_LOD{lod}'];target=next((o for o in coll.all_objects if o.name.startswith('Cockpit') and o.type=='MESH'),None)
  if not target:continue
  verts=[];faces=[]
  paths=[ [(-.207,.976,.823),(.207,.976,.823),(.207,1.384,.823),(-.207,1.384,.823),(-.207,.976,.823)] ]
  # Fitted back cushion seam lies on its inclined forward face.
  paths.append([(-.196,1.125,.84),(-.196,.991,1.385),(.196,.991,1.385),(.196,1.125,.84)])
  for path in paths:
   for aa,bb in zip(path,path[1:]):
    aa,bb=Vector(aa),Vector(bb);axis=(bb-aa).normalized();side=axis.cross(Vector((0,0,1)))
    if side.length<.1:side=axis.cross(Vector((1,0,0)))
    side.normalize();up=axis.cross(side);base=len(verts)
    for pt in (aa,bb):
     for k in range(6):verts.append(tuple(pt+.003*(side*math.cos(k*math.tau/6)+up*math.sin(k*math.tau/6))))
    for k in range(6):faces.append((base+k,base+(k+1)%6,base+6+(k+1)%6,base+6+k))
  mesh=bpy.data.meshes.new('CushionWelt');mesh.from_pydata(verts,[],faces);mesh.materials.append(target.data.materials[0]);uv=mesh.uv_layers.new(name='UVMap')
  # Each strip gets metric UV span at 600 px/m within existing Dark atlas allocation.
  for face in mesh.polygons:
   vs=[mesh.vertices[j].co for j in face.vertices];length=(vs[3]-vs[0]).length;width=(vs[1]-vs[0]).length
   for li,co in zip(face.loop_indices,[(.85,.85),(.85+width*600/4096,.85),(.85+width*600/4096,.85+length*600/4096),(.85,.85+length*600/4096)]):uv.data[li].uv=co
  obj=bpy.data.objects.new('CushionWelt',mesh);coll.objects.link(obj)
  bpy.ops.object.select_all(action='DESELECT');target.select_set(True);obj.select_set(True);bpy.context.view_layer.objects.active=target;bpy.ops.object.join()
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True)
(D/'wear-cockpit-authoring.json').write_text(json.dumps({'before':before,'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'painted_objects':changes,'note':'Base/damage contact-edge wear and lower salt; existing husk maps preserved. Forward display face and fitted cushion welt joins. No export.'},indent=2))
