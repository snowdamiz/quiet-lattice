"""Correct mapped material pigmentation and ORM; intersect contact wear across shared UV users."""
import bpy,numpy as np,json,hashlib
from pathlib import Path
D=Path(__file__).resolve().parent;src=D.parents[4]/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src));before=hashlib.sha256(src.read_bytes()).hexdigest()
# Paint by world position on original render UV, never atlas-space rectangles.
import shutil
if not (D/"scratch/wear2-before.blend").exists():shutil.copy2(src,D/"scratch/wear2-before.blend")
changes=[]
for variant,prefix in [('lark','lark'),('lark_damaged','lark_damaged')]:
 im=bpy.data.images.get(prefix+'_4k_density_baseColor')
 if not im:continue
 w,h=im.size;a=np.empty(w*h*4,np.float32);im.pixels.foreach_get(a);a=a.reshape(h,w,4)
 import ctypes
 lib=ctypes.CDLL(str(D/'scratch/wear2_raster.dylib'))
 owner=np.zeros((h,w),np.uint8);wear=np.ones((h,w),np.float32);conflict=np.zeros((h,w),np.uint8)
 palette={'Hull':np.array([237,230,214])/255,'Accent':np.array([46,143,132])/255,'Trim':np.array([138,143,150])/255,'Dark':np.array([44,47,52])/255}
 for o in bpy.data.collections[variant+'_LOD0'].all_objects:
  if o.type!='MESH' or not o.data.uv_layers.get('UVMap'):continue
  m=o.data;m.calc_loop_triangles();uv=m.uv_layers['UVMap'];ef={}
  for p in m.polygons:
   for e in p.edge_keys:ef.setdefault(tuple(sorted(e)),[]).append(p)
  sharp={e for e,ps in ef.items() if len(ps)==1 or (len(ps)==2 and ps[0].normal.dot(ps[1].normal)<.75)}
  rows=[]
  for t in m.loop_triangles:
   role=m.materials[t.material_index].get('engine_name')
   if role not in palette:continue
   pts=[o.matrix_world@m.vertices[i].co for i in t.vertices];alt=[]
   area=(pts[1]-pts[0]).cross(pts[2]-pts[0]).length
   for i,j in ((1,2),(2,0),(0,1)):
    alt.append(area/max((pts[j]-pts[i]).length,1e-9) if tuple(sorted((t.vertices[i],t.vertices[j]))) in sharp else 0)
   rows.append([v*4096 for li in t.loops for v in uv.data[li].uv]+alt+[p.z for p in pts]+[list(palette).index(role)+1])
  ts=np.array(rows,np.float32)
  if len(rows):lib.raster(ctypes.c_void_p(ts.ctypes.data),ctypes.c_int(len(rows)),ctypes.c_void_p(owner.ctypes.data),ctypes.c_void_p(wear.ctypes.data),ctypes.c_void_p(conflict.ctypes.data))
  changes.append(o.name);print('MAPPED',o.name,flush=True)
 print('CONFLICT_PIXELS',int(conflict.sum()),flush=True)
 assert not conflict.any(), 'Cross-role atlas overlap'
 touched=owner>0
 for rid,(role,color) in enumerate(palette.items(),1):
  mask=owner==rid;weight=wear[mask]
  a[mask,:3]=color[None,:]*(1-weight[:,None])+np.array([.40,.44,.41])*weight[:,None]
 im.pixels.foreach_set(a.ravel());im.pack();del a
 orm=bpy.data.images[prefix+'_4k_density_ORM'];oa=np.empty(w*h*4,np.float32);orm.pixels.foreach_get(oa);oa=oa.reshape(h,w,4)
 orm_before={}
 for rid,(role,rough,metal) in enumerate([('Hull',.42,0),('Accent',.40,0),('Trim',.36,1),('Dark',.42,.8)],1):
  mask=owner==rid;weight=wear[mask]
  orm_before[role]=[np.min(oa[mask,:3],axis=0).tolist(),np.max(oa[mask,:3],axis=0).tolist()]
  oa[mask,0]=1;oa[mask,1]=rough+weight*.16;oa[mask,2]=metal
 orm.pixels.foreach_set(oa.ravel());orm.pack();del oa
 (D/('wear2-'+variant+'-orm.json')).write_text(json.dumps(orm_before,indent=2))
 print('OWNERSHIP',variant,'cross_role_conflicts',int(conflict.sum()),'pixels',int(touched.sum()),'edge_pixels',int(((wear>0)&touched).sum()),flush=True)

bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True)
(D/'wear2-authoring.json').write_text(json.dumps({'before':before,'after':hashlib.sha256(src.read_bytes()).hexdigest(),'objects':changes},indent=2))
