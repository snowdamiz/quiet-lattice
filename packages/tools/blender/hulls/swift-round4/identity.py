"""Compare actual source surfaces/UVs/normals/material assignments and marker transforms to the decoded GLB.
Texture payloads are separately checked by the unmodified stock validator. Geometry import removes only texture
references in a temporary derivative to avoid needlessly transcoding 4k maps for a geometry measurement.
"""
import bpy,json,os,sys,hashlib,math
from pathlib import Path
from mathutils import Vector,kdtree
ROOT=Path(__file__).resolve().parents[5];sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import scene as S, rules as R, core, glb
args=sys.argv[sys.argv.index('--')+1:];candidate=None if args[0]=='--probe-source' else Path(args[0]).resolve();job=Path(os.environ['SWIFT_JOB']);rules=R.load()
source=ROOT/'assets/blend/hulls/swift.blend';core.load(source)

def collect(model):
 bpy.context.view_layer.update()
 result={}
 for a in model.assets:
  for variant in a.variants.values():
   for level,objects in variant.lods.items():
    key=variant.id+'/LOD'+str(level);groups={};markers={}
    for o in S.render_meshes(rules,objects):
     m=o.data;m.calc_loop_triangles();uv=m.uv_layers.active;normal_matrix=o.matrix_world.to_3x3().inverted().transposed();normals=m.corner_normals
     for t in m.loop_triangles:
      mat=R.material_name(o.material_slots[t.material_index].material);group=groups.setdefault(mat,{'corners':[],'triangles':0,'area':0,'zeroAreaTriangles':0,'zeroAreaUVTriangles':0,'nonfinite':0})
      pts=[o.matrix_world@m.vertices[v].co for v in t.vertices];group['triangles']+=1;area=(pts[1]-pts[0]).cross(pts[2]-pts[0]).length*.5;group['area']+=area;group['zeroAreaTriangles']+=int(area<1e-10)
      if uv:
       ua,ub,uc=[uv.data[li].uv for li in t.loops];group['zeroAreaUVTriangles']+=int(abs((ub.x-ua.x)*(uc.y-ua.y)-(ub.y-ua.y)*(uc.x-ua.x))<1e-12)
      for p,li in zip(pts,t.loops):
       n=(normal_matrix@normals[li].vector).normalized();u=uv.data[li].uv if uv else Vector((999,999))
       group['corners'].append((*p,*n,*u));group['nonfinite']+=int(not all(math.isfinite(c) for c in (*p,*n,*u)))
    for o in objects+variant.extras+a.extras:
     if o.type=='EMPTY' and S.marker_spec(rules,o.name):markers[R.strip(o.name)]=[float(c) for row in o.matrix_world for c in row]
    result[key]={'groups':groups,'markers':markers}
 return result
source_model=S.collect_source(rules)
expected=collect(source_model)
# Blender's serializer calls Mesh.validate() itself. Diagnose its warnings on disposable
# mesh copies and distinguish surface changes from discarded derived/selection data.
def mesh_surface_signature(m):
 m.calc_loop_triangles();uv=m.uv_layers.active
 data=([tuple(v.co) for v in m.vertices],[(tuple(p.vertices),p.material_index) for p in m.polygons],[tuple(n.vector) for n in m.corner_normals],[tuple(v.uv) for v in uv.data] if uv else None)
 return hashlib.sha256(repr(data).encode()).hexdigest()
validation_probe=[];seen=set()
for a in source_model.assets:
 for v in a.variants.values():
  for level,objects in v.lods.items():
   for o in S.render_meshes(rules,objects):
    if o.data.as_pointer() in seen:continue
    seen.add(o.data.as_pointer());m=o.data.copy();before=mesh_surface_signature(m)
    attrs_before=[(x.name,x.domain,x.data_type,len(x.data)) for x in m.attributes]
    repaired=m.validate(verbose=False);after=mesh_surface_signature(m)
    if repaired:validation_probe.append({'object':o.name,'variant':v.id,'lod':level,'surfaceUnchanged':before==after,'beforeSurfaceSha256':before,'afterSurfaceSha256':after,'attributesBefore':attrs_before,'attributesAfter':[(x.name,x.domain,x.data_type,len(x.data)) for x in m.attributes]})
    bpy.data.meshes.remove(m)
if candidate is None:
 result={'status':'PASS' if all(x['surfaceUnchanged'] for x in validation_probe) else 'FAIL','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'probe':validation_probe}
 (job/'mesh-validation-probe.json').write_text(json.dumps(result,indent=2));print(json.dumps({'status':result['status'],'repairWarnings':len(validation_probe),'changedSurfaces':[x['object'] for x in validation_probe if not x['surfaceUnchanged']]}));sys.exit(0 if result['status']=='PASS' else 1)
js,data=glb.read(candidate)
# Preserve mesh attributes, transforms and primitive material indices byte-for-byte.
for mat in js.get('materials',[]):
 def strip(x):
  if isinstance(x,dict):
   for k in list(x):
    if k.endswith('Texture'):del x[k]
    else:strip(x[k])
  elif isinstance(x,list):
   for v in x:strip(v)
 strip(mat)
js.pop('textures',None);js.pop('images',None);js.pop('samplers',None)
for key in ['extensionsUsed','extensionsRequired']:
 if key in js:js[key]=[s for s in js[key] if s!='KHR_texture_basisu']
tmp=job/'geometry-only.glb';glb.write(tmp,js,data);core.load(tmp);actual=collect(S.collect_export(rules));tmp.unlink()
fail=[];rows={};position_tol=.002;uv_tol=.0002;normal_tol=math.radians(2)

def compare(a,b):
 tree=kdtree.KDTree(len(b))
 for i,p in enumerate(b):tree.insert(p[:3],i)
 tree.balance();mp=mu=mn=0;bad=0
 for p in a:
  near=tree.find_range(p[:3],position_tol)
  if not near:bad+=1;continue
  # At a split edge, choose the corner that also matches its normal and UV, not just nearest position.
  def penalty(entry):
   q=b[entry[1]];du=math.hypot(p[6]-q[6],p[7]-q[7]);dot=max(-1,min(1,sum(p[i]*q[i] for i in range(3,6))));angle=math.acos(dot)
   return max(du/uv_tol,angle/normal_tol),du,angle
  chosen=min(near,key=lambda e:penalty(e)[0]);score,du,angle=penalty(chosen)
  mp=max(mp,chosen[2]);mu=max(mu,du);mn=max(mn,angle)
  if score>1:bad+=1
 return {'unmatchedCorners':bad,'maxPositionError':mp,'maxUVError':mu,'maxNormalDegrees':math.degrees(mn)}
if set(expected)!=set(actual):fail.append('variant/LOD set differs')
for key,x in expected.items():
 if key not in actual:continue
 y=actual[key];rows[key]={}
 if set(x['groups'])!=set(y['groups']):fail.append(key+' material set differs')
 for mat,a in x['groups'].items():
  if mat not in y['groups']:continue
  b=y['groups'][mat];ab=compare(a['corners'],b['corners']);ba=compare(b['corners'],a['corners'])
  row={'sourceTriangles':a['triangles'],'exportTriangles':b['triangles'],'sourceArea':a['area'],'exportArea':b['area'],'sourceToExport':ab,'exportToSource':ba,'sourceGeometry':{k:a[k] for k in ['zeroAreaTriangles','zeroAreaUVTriangles','nonfinite']},'exportGeometry':{k:b[k] for k in ['zeroAreaTriangles','zeroAreaUVTriangles','nonfinite']}};rows[key][mat]=row
  if a['triangles']!=b['triangles'] or ab['unmatchedCorners'] or ba['unmatchedCorners'] or b['zeroAreaTriangles'] or b['nonfinite'] or (b['zeroAreaUVTriangles'] and mat not in ['Glass','EngineGlow','NavRed','NavGreen','NavWhite'] and not mat.startswith('LIB_GlyphLight')):fail.append(key+'/'+mat+' surface mismatch')
 if set(x['markers'])!=set(y['markers']):fail.append(key+' marker names differ')
 for name,mat in x['markers'].items():
  if name in y['markers'] and max(abs(a-b) for a,b in zip(mat,y['markers'][name]))>1e-5:fail.append(key+'/'+name+' marker transform changed')
# Deliberate 1 cm corruption of an isolated expected point must fail the same matcher.
probe=[(0.,0.,0.,0.,0.,1.,.5,.5)];corrupt=[(.01,0.,0.,0.,0.,1.,.5,.5)]
negative=compare(probe,corrupt)['unmatchedCorners']==1
if not negative:fail.append('negative control did not detect geometry displacement')
out={'status':'FAIL' if fail else 'PASS','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'glbSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'source':str(source),'glb':str(candidate),'positionToleranceMeters':position_tol,'UVTolerance':uv_tol,'normalToleranceDegrees':2,'failures':fail,'negativeControlDetected1cmDisplacement':negative,'sourceMeshValidationProbe':validation_probe,'surfaces':rows,'sourceMarkers':{k:v['markers'] for k,v in expected.items()},'exportMarkers':{k:v['markers'] for k,v in actual.items()}}
(job/'identity.json').write_text(json.dumps(out,indent=2));print(json.dumps({'status':out['status'],'failures':fail,'surfaces':sum(len(x) for x in rows.values())}));sys.exit(1 if fail else 0)
