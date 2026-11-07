"""One-time R3 -> R4 authoring operation. Export never calls this file.
Edits the pinned, recovered source in place; refuses a second application.
"""
import bpy,bmesh,math,json,os,sys,hashlib
from pathlib import Path
from mathutils import Vector, Matrix
SOURCE=Path('assets/blend/hulls/swift.blend').resolve()
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()=='dbf00e1c750a108faaa3e29402b0b3b9085d32b55e026e5316a6800afcefbba5'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.cycles.device='CPU';scene.render.threads_mode='FIXED';scene.render.threads=2
report={'damage':{},'lod':{},'materials':[]}

def active(o):
 bpy.ops.object.select_all(action='DESELECT');o.hide_set(False);o.select_set(True);bpy.context.view_layer.objects.active=o

def islands(mesh):
 adj=[[] for _ in mesh.vertices]
 for e in mesh.edges:a,b=e.vertices;adj[a].append(b);adj[b].append(a)
 seen=set();groups=[];vgroup={}
 for v in mesh.vertices:
  if v.index in seen:continue
  todo=[v.index];seen.add(v.index);vs=[]
  while todo:
   i=todo.pop();vs.append(i);vgroup[i]=len(groups)
   for n in adj[i]:
    if n not in seen:seen.add(n);todo.append(n)
  groups.append({'verts':vs,'faces':[]})
 for p in mesh.polygons:groups[vgroup[p.vertices[0]]]['faces'].append(p.index)
 return groups

def bounds(mesh,g):
 co=[mesh.vertices[i].co for i in g['verts']]
 return Vector(tuple(min(v[i] for v in co) for i in range(3))),Vector(tuple(max(v[i] for v in co) for i in range(3)))

def remove_vertices(o,vs):
 bm=bmesh.new();bm.from_mesh(o.data);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.verts[i] for i in sorted(vs)],context='VERTS');bm.to_mesh(o.data);bm.free();o.data.update()

def node(nt,typ,label):
 n=nt.nodes.new(typ);n.label=label;return n

def mathnode(nt,op,a,b=None):
 n=node(nt,'ShaderNodeMath',op);n.operation=op
 for i,x in enumerate([a,b]):
  if x is None:continue
  if isinstance(x,(int,float)):n.inputs[i].default_value=x
  else:nt.links.new(x,n.inputs[i])
 return n.outputs[0]

def range_node(nt,src,lo,hi,a,b,label):
 n=node(nt,'ShaderNodeMapRange',label);n.clamp=True
 for k,v in [('From Min',lo),('From Max',hi),('To Min',a),('To Max',b)]:n.inputs[k].default_value=v
 nt.links.new(src,n.inputs['Value']);return n.outputs[0]

# Preserve R3 painted masks on their original UV channel while a separate export atlas is repacked.
for ob in bpy.data.objects:
 if ob.type=='MESH' and ob.data.uv_layers:
  original_uv=ob.data.uv_layers.active
  paint=ob.data.uv_layers.new(name='R3Paint')
  for i,v in enumerate(original_uv.data):paint.data[i].uv=v.uv
  ob.data.uv_layers.active=original_uv

# Contact-specific wear masks retain the existing painted mask and decals.
contacts=[((-0.58,1.65,.68),(.18,.8,.15)),((-1.38,1.53,-.5),(.30,.48,1.0)),
 ((-.03,-2.05,1.05),(.65,.6,.25)),((-2.5,-1.7,-.13),(.6,.15,.15)),((2.5,-1.5,-.10),(.6,.15,.15)),
 ((0,4.22,-.13),(.35,.2,.18)),((0,1.78,.40),(.15,.18,.25)),((-.33,1.7,.48),(.16,.28,.12))]
for m in bpy.data.materials:
 if not m.use_nodes or m.name.startswith('LIB_'):continue
 nt=m.node_tree;bs=next((n for n in nt.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if not bs:continue
 role=m.get('engine_name','');husk=m.name.startswith('SwiftHusk')
 if role in ('Hull','Dark','Trim','Accent'):
  pos=node(nt,'ShaderNodeNewGeometry','R4 authored contact regions').outputs['Position'];mask=None
  for center,radius in contacts:
   sub=node(nt,'ShaderNodeVectorMath','contact center');sub.operation='SUBTRACT';nt.links.new(pos,sub.inputs[0]);sub.inputs[1].default_value=center
   div=node(nt,'ShaderNodeVectorMath','contact extent');div.operation='DIVIDE';nt.links.new(sub.outputs[0],div.inputs[0]);div.inputs[1].default_value=radius
   length=node(nt,'ShaderNodeVectorMath','contact distance');length.operation='LENGTH';nt.links.new(div.outputs[0],length.inputs[0])
   fac=range_node(nt,length.outputs['Value'],.25,1.0,1,0,'contact falloff')
   mask=fac if mask is None else mathnode(nt,'MAXIMUM',mask,fac)
  wear=nt.nodes.get('WearMask')
  paint_uv=node(nt,'ShaderNodeUVMap','retained R3 painting');paint_uv.uv_map='R3Paint'
  for mask_name in ['WearMask','DecalMask']:
   if nt.nodes.get(mask_name):nt.links.new(paint_uv.outputs['UV'],nt.nodes[mask_name].inputs['Vector'])
  if wear:
   for output in wear.outputs:
    for link in list(output.links):
     dest=link.to_socket
     if output.name=='Alpha' and not husk:
      nt.links.remove(link);dest.default_value=0
     elif output.name=='Color':
      mul=node(nt,'ShaderNodeMixRGB','contact-only painted wear');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1
      nt.links.new(output,mul.inputs[1]);nt.links.new(mask,mul.inputs[2]);nt.links.new(mul.outputs[0],dest)
  edge=nt.nodes.get('Map Range')
  if edge:
   for link in list(edge.outputs[0].links):
    if link.to_node.type=='MIX':nt.links.new(mathnode(nt,'MULTIPLY',edge.outputs[0],mathnode(nt,'MULTIPLY',mask,.25)),link.to_socket)
  bump=nt.nodes.get('Bump')
  if bump:
   bump.inputs['Strength'].default_value=.27 if role in ('Hull','Dark') else .15
   bump.inputs['Distance'].default_value=.007 if role in ('Hull','Dark') else .002
  if role in ('Hull','Dark') and not husk:
   noise=nt.nodes.get('Noise Texture.002') or nt.nodes.get('Noise Texture')
   nt.links.new(range_node(nt,noise.outputs['Fac'],.15,.85,.64,.82,'slate roughness'),bs.inputs['Roughness'])
  # Broad damaged paint clouds were not localized destruction; remove their mask channels.
  if m.name.startswith('SwiftDmg') and wear:
   img=wear.image
   import numpy as np
   px=np.empty(len(img.pixels),dtype=np.float32);img.pixels.foreach_get(px);px=px.reshape(-1,4)
   px[:,1:]=0;img.pixels.foreach_set(px.reshape(-1));img.pack()
  report['materials'].append(m.name)
 if 'Crystal' in m.name and not husk:
  cloud=nt.nodes.get('Mix');crack=nt.nodes.get('Mix.001');noise=nt.nodes.get('Noise Texture.001')
  if cloud:
   cloud.inputs[6].default_value=(.065,.035,.15,1);cloud.inputs[7].default_value=(.40,.29,.57,1)
   nt.links.new(range_node(nt,noise.outputs['Fac'],.30,.67,0,1,'clouded interior contrast'),cloud.inputs[0])
  if crack:
   crack.inputs[7].default_value=(.54,.46,.69,1)
   nt.links.new(mathnode(nt,'MULTIPLY',nt.nodes['Map Range'].outputs[0],.28),crack.inputs[0])
  bs.inputs['Emission Strength'].default_value=.25
  if nt.nodes.get('Map Range.002'):
   nt.nodes['Map Range.002'].inputs['To Min'].default_value=.08;nt.nodes['Map Range.002'].inputs['To Max'].default_value=.23
  if nt.nodes.get('Bump'):nt.nodes['Bump'].inputs['Distance'].default_value=.0018

# Replace the old repeated hinged plates by unlifted retained pieces, then fracture selected sites.
base=bpy.data.objects['Body'];original=islands(base.data)
# Match the retained connected panels by topology and ordered vertex coordinates.
# R3 separately repacked variant UVs, so UV matching is deliberately not used.
for suffix in ['_dmg','_husk']:
 o=bpy.data.objects['Body'+suffix];restored=0;panels=0
 for group in islands(o.data):
  vi=sorted(group['verts']);faces=group['faces']
  if not faces or sum(len(o.data.polygons[f].vertices)-2 for f in faces)<100:continue
  role=o.material_slots[o.data.polygons[faces[0]].material_index].material.get('engine_name')
  if role not in ['Hull','Accent','Trim']:continue
  lo,hi=bounds(o.data,group);center=(lo+hi)*.5;candidates=[]
  for original_group in original:
   if len(original_group['verts'])!=len(vi):continue
   blo,bhi=bounds(base.data,original_group)
   if ((blo+bhi)*.5-center).length>.4:continue
   bv=sorted(original_group['verts']);dist=[(o.data.vertices[x].co-base.data.vertices[y].co).length for x,y in zip(vi,bv)]
   if max(dist,default=999)<.42:candidates.append((sum(dist),max(dist),bv))
  if not candidates:continue
  score,maximum,bv=min(candidates,key=lambda item:item[0])
  if .02<maximum<.42:
   for x,y in zip(vi,bv):o.data.vertices[x].co=base.data.vertices[y].co
   restored+=len(vi);panels+=1
 o.data.update();report['damage'][suffix]={'unliftedVertices':restored,'unliftedPanels':panels}

# Mesh creation helpers: shaped octagonal sections, real thickness, bevelled edges and fitted controls.
def mesh_object(name,verts,faces,mat,coll,parent=None):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new(name,me);coll.objects.link(ob);me.materials.append(mat)
 if parent:ob.parent=parent
 active(ob);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
 return ob

def loft(name,sections,mat,coll,axis='z',parent=None):
 # (height, center across x, center across second axis, width, depth)
 verts=[];ring=[(-.38,-.5),(.38,-.5),(.5,-.32),(.5,.32),(.38,.5),(-.38,.5),(-.5,.32),(-.5,-.32)]
 for h,cx,cy,w,d in sections:
  for x,y in ring:verts.append((cx+x*w,cy+y*d,h) if axis=='z' else (cx+x*w,h,cy+y*d))
 faces=[tuple(reversed(range(8)))]
 for j in range(len(sections)-1):
  for i in range(8):faces.append((j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i))
 faces.append(tuple(range((len(sections)-1)*8,len(sections)*8)))
 return mesh_object(name,verts,faces,mat,coll,parent)

def bar(name,a,b,r,mat,coll,parent=None,n=8):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();u=axis.cross(Vector((0,0,1)))
 if u.length<.1:u=axis.cross(Vector((0,1,0)))
 u.normalize();v=axis.cross(u);verts=[tuple(p+r*(u*math.cos(i*2*math.pi/n)+v*math.sin(i*2*math.pi/n))) for p in (a,b) for i in range(n)]
 faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 return mesh_object(name,verts,faces,mat,coll,parent)

def screen(name,center,w,h,mat,coll,parent,angle=math.radians(68)):
 # Front faces toward the pilot (-Y), with a sloped instrument face.
 cx,cy,cz=center;up=Vector((0,math.cos(angle),math.sin(angle)));right=Vector((1,0,0));normal=right.cross(up)
 border=[(-.44,-.5),(.44,-.5),(.5,-.38),(.5,.38),(.44,.5),(-.44,.5),(-.5,.38),(-.5,-.38)]
 verts=[tuple(Vector(center)+right*x*w+up*y*h) for x,y in border]
 ob=mesh_object(name,verts,[tuple(range(8))],mat,coll,parent);return ob,up,normal

def text_mesh(name,body,pos,size,mat,coll,parent,angle=math.radians(68)):
 cu=bpy.data.curves.new(name,'FONT');cu.body=body;cu.size=size;cu.extrude=.0003;cu.align_x='CENTER';cu.resolution_u=2
 ob=bpy.data.objects.new(name,cu);coll.objects.link(ob);ob.location=pos;ob.rotation_euler.x=angle;cu.materials.append(mat);active(ob);bpy.ops.object.convert(target='MESH');ob=bpy.context.object
 if parent:ob.parent=parent
 return ob

# A display is an emissive optical insert, separate from engine/nav emitters; a procedural map is baked at export.
def display_material(name,color,dead=False):
 m=bpy.data.materials.new(name);m.use_nodes=True;nt=m.node_tree;bs=nt.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.002,.005,.008,1);bs.inputs['Roughness'].default_value=.36
 # Reuse a full PBR local slate shader for non-emitting dead inserts; live marks are emissive-only profile via lib_source.
 m['lib_source']='LIB_GlyphLight';bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=.35 if dead else 1.2
 return m
live=display_material('SwiftR4_Display',(0.12,.70,.58));lilac=display_material('SwiftR4_Charge',(.52,.28,.9));dead=display_material('SwiftR4_DeadDisplay',(.015,.035,.03),True)
# These optical inserts use the existing EngineGlow profile for exemption, with unique exported names.
for m in [live,lilac,dead]:m.name='LIB_GlyphLight_'+m.name;m['engine_name']=m.name

for variant,suffix,prefix in [('swift','','Swift'),('swift_damaged','_dmg','SwiftDmg'),('swift_husked','_husk','SwiftHusk')]:
 coll=bpy.data.collections[variant+'_LOD0'];body=bpy.data.objects['Body'+suffix];cockpit=bpy.data.objects['CockpitInteriorMesh'+suffix]
 groups=islands(cockpit.data);keep=set(range(14))|{42,43,44,45,142,143};remove=set(v for i,g in enumerate(groups) if i not in keep for v in g['verts']);remove_vertices(cockpit,remove)
 dark=cockpit.material_slots[0].material;trim=cockpit.material_slots[1].material;glow=dead if suffix=='_husk' else live
 parent=next(o for o in coll.objects if o.type=='EMPTY' and o.name.startswith('CockpitInterior'))
 pieces=[]
 def add(o):pieces.append(o);return o
 # Tapered seat pan, reclined back, integrated shoulder wings, head cradle and inset bolsters.
 add(loft('R4_SeatShell'+suffix,[(.08,0,1.40,.36,.34),(.18,0,1.42,.52,.52),(.25,0,1.42,.54,.52),(.29,0,1.42,.48,.48)],dark,coll,parent=parent))
 add(loft('R4_SeatPad'+suffix,[(.255,0,1.45,.40,.44),(.28,0,1.44,.44,.45),(.32,0,1.43,.39,.39)],dark,coll,parent=parent))
 add(loft('R4_BackShell'+suffix,[(.27,0,1.20,.50,.17),(.45,0,1.18,.45,.16),(.70,0,1.13,.48,.18),(.88,0,1.09,.57,.19),(1.02,0,1.06,.34,.17),(1.12,0,1.04,.30,.14)],dark,coll,parent=parent))
 add(loft('R4_Lumbar'+suffix,[(.31,0,1.30,.35,.10),(.47,0,1.29,.37,.13),(.66,0,1.25,.34,.12),(.84,0,1.20,.39,.10),(.91,0,1.17,.32,.08)],dark,coll,parent=parent))
 for s in [-1,1]:
  add(loft('R4_Bolster'+str(s)+suffix,[(.29,s*.21,1.43,.09,.44),(.40,s*.23,1.40,.09,.38),(.46,s*.23,1.32,.07,.24)],dark,coll,parent=parent))
  add(loft('R4_HeadWing'+str(s)+suffix,[(.91,s*.16,1.07,.07,.14),(1.06,s*.18,1.09,.08,.20),(1.15,s*.15,1.07,.06,.14)],dark,coll,parent=parent))
  # Continuous thick shoulder and lap harness, resting against the empty seat.
  for j,(a,b) in enumerate([((s*.17,1.22,.91),(s*.12,1.38,.48)),((s*.12,1.38,.48),(s*.045,1.53,.34)),((s*.24,1.43,.36),(s*.045,1.53,.34))]):
   d=Vector(b)-Vector(a);mid=(Vector(a)+Vector(b))*.5
   belt=loft('R4_Restraint'+str(s)+str(j)+suffix,[(0,0,0,.045,.012),(d.length,0,0,.045,.012)],trim,coll,parent=parent);belt.rotation_mode='QUATERNION';belt.rotation_quaternion=d.to_track_quat('Z','Y');belt.location=a;add(belt)
 add(loft('R4_HarnessLatch'+suffix,[(.325,0,1.54,.10,.07),(.36,0,1.54,.10,.07),(.37,0,1.54,.07,.05)],dark,coll,parent=parent))
 # Fitted instrument binnacle; faceted cheeks, recessed screens and a low coaming.
 add(loft('R4_InstrumentHousing'+suffix,[(.26,0,2.16,.55,.19),(.40,0,2.14,.71,.22),(.64,0,2.22,.78,.20),(.70,0,2.25,.72,.17)],dark,coll,parent=parent))
 for i,cx in enumerate([-.235,0,.235]):
  center=(cx,2.06,.535);panel,up,normal=screen('R4_ScreenInset'+str(i)+suffix,center,.215,.225,next(o.material_slots[0].material for o in coll.objects if o.name.startswith('CanopyGlass')),coll,parent);add(panel)
  # Perimeter optical rim and informational layout, different by instrument.
  for j in [-1,1]:
   a=Vector(center)+Vector((j*.097,0,0))-up*.095+normal*.003;b=a+up*.19
   add(bar('R4_DisplayRail'+str(i)+str(j)+suffix,a,b,.002,glow,coll,parent,n=4))
  titles=['SHIELD','NAV / IX','CHARGE'];values=['090','0780','120']
  for txt,dy,sz in [(titles[i],.065,.019),(values[i],-.005,.047),(['READY','SCAN','PULSE'][i],-.073,.014)]:
   add(text_mesh('R4_Readout'+str(i)+txt+suffix,txt,Vector(center)+up*dy+normal*.006,sz,glow if i!=2 or suffix=='_husk' else lilac,coll,parent))
 # Small instrument-specific graphics: shield segments, navigational reticle and charge bars.
  for j in range(5 if i!=1 else 3):
   yy=-.040; xx=(j-2)*.027 if i!=1 else 0
   a=Vector(center)+Vector((xx,0,0))+up*yy+normal*.009
   b=a+Vector((.018,0,0)) if i!=1 else a+Vector((.025*(j+1),0,0))+up*(j-1)*.012
   add(bar('R4_InstrumentGraphic'+str(i)+str(j)+suffix,a,b,.0025,glow if i!=2 or suffix=='_husk' else lilac,coll,parent,n=4))
 # Side consoles taper around knees; their distinct control groups replace rows of identical buttons.
 for s in [-1,1]:
  add(loft('R4_SideConsole'+str(s)+suffix,[(.0,s*.36,1.78,.15,.58),(.32,s*.36,1.78,.20,.71),(.43,s*.37,1.77,.20,.65),(.47,s*.37,1.76,.16,.60)],dark,coll,parent=parent))
  for j in range(3 if s<0 else 2):
   y=1.48+j*.16
   add(bar('R4_RotaryBase'+str(s)+str(j)+suffix,(s*.37,y,.47),(s*.37,y,.489),.036,dark,coll,parent,n=12))
   add(bar('R4_RotaryKnob'+str(s)+str(j)+suffix,(s*.37,y,.49),(s*.37,y,.52),.024,trim,coll,parent,n=8))
   add(bar('R4_RotaryIndex'+str(s)+str(j)+suffix,(s*.37-.015,y,.522),(s*.37+.015,y,.522),.002,glow,coll,parent,n=4))
  for j in range(2):
   y=1.97+j*.08
   add(bar('R4_GuardedToggle'+str(s)+str(j)+suffix,(s*.37,y,.48),(s*.37+.014,y+.025,.53),.009,trim,coll,parent,n=6))
   for dx in [-.026,.026]:add(bar('R4_ToggleGuard'+str(s)+str(j)+str(dx)+suffix,(s*.37+dx,y-.025,.48),(s*.37+dx,y+.032,.53),.007,dark,coll,parent,n=6))
 # Footplates, handgrip ribs, and rear service panel fitted to the same envelope.
 for s in [-1,1]:
  add(loft('R4_Pedal'+str(s)+suffix,[(.0,s*.13,2.26,.16,.22),(.04,s*.13,2.29,.16,.21),(.12,s*.13,2.36,.13,.11)],dark,coll,parent=parent))
  add(loft('R4_RearService'+str(s)+suffix,[(.47,s*.30,.885,.20,.035),(.68,s*.30,.885,.22,.035),(.76,s*.30,.885,.16,.035)],dark,coll,parent=parent))
  for j in range(5):add(bar('R4_ServiceVent'+str(s)+str(j)+suffix,(s*.30-.065,.911,.52+j*.031),(s*.30+.065,.911,.52+j*.031),.004,trim,coll,parent,n=4))
 # Selected missing slabs expose broken rooted spars. No repeated raised rectangle across the whole ship.
 if suffix:
  gs=islands(body.data);targets=[Vector((-2.65,-2.65,-.20)),Vector((1.06,-1.55,.28)),Vector((.17,-3.10,.73))]
  if suffix=='_husk':targets+=[Vector((3.05,-2.8,-.22)),Vector((-.30,-3.6,.40))]
  removed=[]
  for site,t in enumerate(targets):
   candidates=[]
   for g in gs:
    if not g['faces']:continue
    lo,hi=bounds(body.data,g);ctr=(lo+hi)*.5;mat=body.material_slots[body.data.polygons[g['faces'][0]].material_index].material
    tris=sum(len(body.data.polygons[f].vertices)-2 for f in g['faces'])
    if tris>100 and mat.get('engine_name') in ['Hull','Accent'] and (hi-lo).y>.5:candidates.append(((ctr-t).length,g,lo,hi))
   _,g,lo,hi=min(candidates,key=lambda x:x[0]);removed.extend(g['verts']);gs.remove(g)
   ctr=(lo+hi)*.5;z=hi.z-.07;w=max(.12,(hi.x-lo.x)*.65);length=(hi.y-lo.y)*.70
   # Fracture plates are irregular pentagonal remnants, at the old surface, with stepped broken ends.
   for side in [-1,1]:
    y=ctr.y+side*length*.42
    verts=[(ctr.x-w*.48,y,z),(ctr.x+w*.43,y+.03,z+.02),(ctr.x+w*.28,y-side*.16,z+.04),(ctr.x+.02,y-side*.09,z-.01),(ctr.x-w*.44,y-side*.22,z+.01)]
    verts+= [(x,yy,zz-.035) for x,yy,zz in verts]
    faces=[(0,1,2),(0,2,3),(0,3,4),(9,8,7),(9,7,6),(9,6,5)]+[(j,(j+1)%5,(j+1)%5+5,j+5) for j in range(5)]
    add(mesh_object('R4_FractureLip'+str(site)+str(side)+suffix,verts,faces,trim,coll))
   for j in [-1,1]:
    a=(ctr.x+j*w*.32,ctr.y-length*.4,z-.08);b=(ctr.x+j*w*.20,ctr.y+length*.32,z-.04)
    add(bar('R4_ExposedRoot'+str(site)+str(j)+suffix,a,b,.028,dark,coll,n=6))
    add(bar('R4_FractureLight'+str(site)+str(j)+suffix,Vector(a)+Vector((.014,0,.02)),Vector(b)+Vector((.014,0,.02)),.006,glow,coll,n=4))
   report['damage'][suffix].setdefault('sites',[]).append({'center':list(ctr),'removedTriangles':sum(len(body.data.polygons[f].vertices)-2 for f in g['faces'])})
  remove_vertices(body,set(removed))
 # Consolidate authored mesh groups without losing parent/pivot semantics; optical inserts retain separate material slots.
 for o in pieces:
  active(o);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 # Join new cockpit pieces into the retained cockpit mesh, keep damage pieces in body.
 for target,subset in [(cockpit,[o for o in pieces if o.parent==parent]),(body,[o for o in pieces if o.parent is None])]:
  if subset:
   active(target)
   for o in subset:o.select_set(True)
   bpy.ops.object.join()
 # Remove degenerate inherited split-face fragments, keep flat grown facets.
 for o in [body,cockpit]:
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.dissolve_degenerate(bm,dist=1e-7,edges=list(bm.edges));bm.to_mesh(o.data);bm.free()
 # UV islands for all LOD0 meshes sharing a material, packed together; new geometry must participate in the bake.
 meshes=[o for o in coll.objects if o.type=='MESH']
 bpy.ops.object.select_all(action='DESELECT')
 for o in meshes:o.hide_set(False);o.select_set(True)
 bpy.context.view_layer.objects.active=body;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.003,area_weight=.3);bpy.ops.object.mode_set(mode='OBJECT')
 # Author explicit LOD1/2 from the revised LOD0. The canopy and feet are held exactly, rear tip is isolated before reduction.
 body_groups=islands(body.data);rear=set()
 for g in body_groups:
  lo,hi=bounds(body.data,g)
  if lo.y < -5.4:rear.update(g['verts'])
 for level,ratio in [(1,.38),(2,.19),(3,.018)]:
  lc=bpy.data.collections[variant+f'_LOD{level}'];old=[o for o in lc.objects];mapping={}
  for o in old:bpy.data.objects.remove(o,do_unlink=True)
  for o in coll.objects:
   # At far LOD retain established semantic pivots and simple canopy; interior is hidden by the canopy.
   if level==3 and (o.name.startswith(('Cockpit','Screen','Lens_','Blink_','Light_','Interact_'))):continue
   c=o.copy();c.name=o.name+f'_R4L{level}';lc.objects.link(c);mapping[o]=c
   if o.type=='MESH':
    c.data=o.data.copy()
    if o==body:
     # Protect the exact 58-triangle rear crystal tip by detaching it from the reduction selection.
     protected=c.vertex_groups.new(name='R4_silhouette_keep');protected.add(sorted(rear),1.0,'REPLACE')
     active(c);mod=c.modifiers.new('R4_body_reduction','DECIMATE');mod.ratio=ratio;mod.vertex_group=protected.name;mod.invert_vertex_group=True;mod.vertex_group_factor=1.0;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    elif 'CanopyGlass' in o.name or ('Gear' in o.name and level<=2):pass
    elif level==3:
     active(c);mod=c.modifiers.new('R4_far_part','DECIMATE');mod.ratio=.12;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    elif o==cockpit:
     active(c);mod=c.modifiers.new('R4_interior_reduction','DECIMATE');mod.ratio=.60 if level==1 else .30;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name)
  for original,c in mapping.items():
   inverse=original.matrix_parent_inverse.copy();c.parent=mapping.get(original.parent,original.parent);c.matrix_parent_inverse=inverse
 report['lod'][variant]={str(n):sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in bpy.data.collections[variant+f'_LOD{n}'].objects if o.type=='MESH') for n in range(4)}
scene['SwiftRound4']='Authored source; exporter may validate, bake, reduce missing LODs, and serialize only.'
scene['SwiftRound4Base']='82c3d50ff79a60b9dac38f0bdfbe421381c8dd73'
for authored_mesh in bpy.data.meshes:authored_mesh.validate()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE),compress=True)
Path(os.environ['SWIFT_JOB'],'author.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
