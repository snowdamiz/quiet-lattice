import bpy,bmesh,json,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve();D=P.parent;src=P.parents[5]/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src))
def components(bm):
 seen=set()
 for f in bm.faces:
  if f in seen:continue
  todo=[f];seen.add(f);fs=[]
  while todo:
   a=todo.pop();fs.append(a)
   for e in a.edges:
    for b in e.link_faces:
     if b not in seen:seen.add(b);todo.append(b)
  yield fs
ref=bpy.data.objects['Body'];bm=bmesh.new();bm.from_mesh(ref.data);bm.transform(ref.matrix_world);bm.normal_update()
patches=[]
for fs in components(bm):
 if any(ref.data.materials[f.material_index].name!='Lark_Hull' for f in fs):continue
 # Dorsal outer-facing skin; exclude closed plate thickness and undersides.
 outer=[f for f in fs if f.normal.z>.15]
 if not outer:continue
 vs=set(v for f in fs for v in f.verts);lo=Vector(tuple(min(v.co[i] for v in vs) for i in range(3)));hi=Vector(tuple(max(v.co[i] for v in vs) for i in range(3)))
 patches.append(dict(fs=fs,outer=outer,lo=lo,hi=hi,area=sum(f.calc_area() for f in outer)))
den=sum(p['area'] for p in patches)
# Interior dorsal shoulders: leave nose, tail, wings, nacelles and centre canopy.
candidates=[p for p in patches if p['lo'].z>.25 and max(abs(p['lo'].x),abs(p['hi'].x))<2 and p['hi'].y<3 and p['lo'].y>-5 and p['lo'].x*p['hi'].x>0]
candidates.sort(key=lambda p:-p['area']);selected=[];area=0
for p in candidates:
 if area>=den*.20:break
 selected.append(p);area+=p['area']
print('AREA',den,area,area/den,'PATCHES',len(selected),flush=True)
assert .15<=area/den<=.30
verts=[];faces=[]
for p in selected:
 for f in p['outer']:
  faces.append(tuple(range(len(verts),len(verts)+len(f.verts))));verts.extend(v.co.copy() for v in f.verts)
surface=BVHTree.FromPolygons(verts,faces)
# Vertical projected patch footprints are bounded by actual plate triangles.
flat=BVHTree.FromPolygons([Vector((v.x,v.y,0)) for v in verts],faces)
report={'denominator':'Sum of world-space areas of Body Lark_Hull faces with outward normal Z > 0.15, per connected plate. Dorsal skin only; excludes underside, edge thickness, trim, dark backing, glass. Not a whole-hull loss percentage.','reference_dorsal_area_m2':den,'selected_dorsal_area_m2':area,'fraction':area/den,'regions':[{'min':list(p['lo']),'max':list(p['hi']),'area_m2':p['area']} for p in selected],'lods':{},'limitations':['Inherited losses not counted. Dorsal-area segmentation only; whole outer-shell 15–30% not established.','Backing deletion uses face-centroid footprint classification; boundary slivers require visual inspection.']}
for l in range(4):
 coll=bpy.data.collections[f'lark_husked_LOD{l}'];o=next(o for o in coll.objects if o.type=='MESH' and o.name.startswith('Body'))
 m=bmesh.new();m.from_mesh(o.data);m.transform(o.matrix_world);m.normal_update();remove=[];matched=0;back=0
 for fs in components(m):
  mat=o.data.materials[fs[0].material_index].name
  if 'HuskHull' in mat:
   hits=0;count=0
   for f in fs:
    if f.normal.z<=.15:continue
    count+=1;c=f.calc_center_median();q,n,idx,dist=surface.find_nearest(c)
    if q is not None and dist<.12 and abs(n.dot(f.normal))>.65:hits+=1
   if count and hits/count>.45:remove.extend(fs);matched+=1
   elif l==3:
    for f in fs:
     c=f.calc_center_median();q,n,idx,dist=flat.ray_cast(Vector((c.x,c.y,10)),Vector((0,0,-1)))
     if q is not None and c.z>-.5:remove.append(f)
  elif 'HuskDark' in mat:
   for f in fs:
    c=f.calc_center_median();q,n,idx,dist=flat.ray_cast(Vector((c.x,c.y,10)),Vector((0,0,-1)))
    if q is not None and c.z>-.5:
     s,nn,ii,dd=surface.ray_cast(Vector((c.x,c.y,10)),Vector((0,0,-1)))
     if s is not None and c.z<s.z+.12:remove.append(f);back+=1
 bmesh.ops.delete(m,geom=list(set(remove)),context='FACES');m.transform(o.matrix_world.inverted());m.to_mesh(o.data);m.free();o.data.update()
 report['lods'][str(l)]={'matched_plate_components':matched,'backing_faces_removed':back,'removed_faces':len(set(remove))}
# Restrained fragments on existing seam/rib geometry, keeping atlas UVs.
report['seams']=[]
for l in range(4):
 o=next(o for o in bpy.data.collections[f'lark_husked_LOD{l}'].objects if o.type=='MESH' and o.name.startswith('Body'))
 original=next((m for m in o.data.materials if 'HuskDark' in m.name),None)
 if original:
  mat=bpy.data.materials.get('LIB_HollowSeam_Lark')
  if mat is None:
   mat=original.copy();mat.name='LIB_HollowSeam_Lark';mat['engine_name']='HollowSeam'
   bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
   def lin(c):return ((c+.055)/1.055)**2.4 if c>.04045 else c/12.92
   for key in ('Emission Color','Emission Strength'):
    for link in list(bs.inputs[key].links):mat.node_tree.links.remove(link)
   bs.inputs['Emission Color'].default_value=tuple(lin(v/255) for v in (159,232,218))+(1,)
   bs.inputs['Emission Strength'].default_value=.5
  o.data.materials.append(mat);slot=len(o.data.materials)-1;count=0
  for f in o.data.polygons:
   c=o.matrix_world@f.center
   if o.data.materials[f.material_index]==original and c.z>1.1 and .6<abs(c.x)<1.5 and (-2.8<c.y<-2.4 or -.9<c.y<-.6):f.material_index=slot;count+=1
  report['seams'].append({'lod':l,'faces':count})
# Measure cleared reference surface independently of deleted-face counts.
o=bpy.data.objects['Body_husk'];m=o.data
opaque=[p for p in m.polygons if any(x in m.materials[p.material_index].name for x in ('HuskHull','HuskDark'))]
bvh=BVHTree.FromPolygons([o.matrix_world@v.co for v in m.vertices],[tuple(p.vertices) for p in opaque])
clear=0
for p in selected:
 for f in p['outer']:
  c=f.calc_center_median();q,n,idx,d=bvh.ray_cast(c+f.normal*.15,-f.normal,.35)
  if q is None:clear+=f.calc_area()
report['clear_reference_centroid_area_m2']=clear
report['clear_reference_centroid_fraction']=clear/den
report['limitations'].append('Centroid ray area is a sampled surface-clearance estimate; CPU views establish frame visibility. No dynamic flicker qualification.')
report['source_before_sha256']=hashlib.sha256(src.read_bytes()).hexdigest()
bpy.ops.wm.save_as_mainfile(filepath=str(D/'scratch/husk-openings.blend'))
(D/'husk-exposure.json').write_text(json.dumps(report,indent=2))
