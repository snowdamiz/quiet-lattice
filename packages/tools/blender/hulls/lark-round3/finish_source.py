"""Finish source-owned livery maps, shell-fit colliders and packed glass bakes."""
import bpy,bmesh,sys,json,hashlib,math
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[5];sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import bake
SRC=ROOT/'assets/blend/hulls/lark.blend';OUT=ROOT/'assets/renders/hulls/lark-round3-current'
bpy.ops.wm.open_mainfile(filepath=str(SRC));bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;bake.ensure_cycles(scene,8);scene.render.threads_mode='FIXED';scene.render.threads=2
# Fold the port access into a steep exterior flight and an upper run above the shell.
# The old straight flight crossed the shell. Preserve its UV islands and rigid gear ownership at every LOD.
a=Vector((-3,.95,-1.95));old_end=Vector((-.92,.95,1.08));old_delta=old_end-a;old_dir=old_delta.normalized();old_normal=Vector((old_dir.z,0,-old_dir.x))
elbow=Vector((-2.25,.95,1.10));end=Vector((-.92,.95,1.48))
for coll in bpy.data.collections:
    if not coll.name.startswith('lark') or '_LOD' not in coll.name:continue
    for o in coll.objects:
        if o.type!='MESH' or not o.name.startswith('LandingMechanismMesh'):continue
        for v in o.data.vertices:
            p=o.matrix_world@v.co
            if not (.4<p.y<1.5 and p.x<-.7):continue
            t=(p-a).dot(old_delta)/old_delta.length_squared
            cross=(p-a).dot(old_normal)
            if t<=.72:center=a+(elbow-a)*(t/.72);direction=(elbow-a).normalized()
            else:center=elbow+(end-elbow)*((t-.72)/.28);direction=(end-elbow).normalized()
            normal=Vector((direction.z,0,-direction.x))
            v.co=o.matrix_world.inverted()@(center+normal*cross+Vector((0,p.y-.95,0)))
        o.data.update()
bpy.data.objects['BoardingSill'].location=end
bpy.data.objects['BoardingFoot']['access_route']=json.dumps([list(a),list(elbow),list(end)])
print('EXTERIOR BOARDING ROUTE POSED',flush=True)
# Bake semantic regions from LOD0; use these actual UV regions to author two alternate paint schemes.
c=bpy.data.collections['lark_LOD0'];meshes=[o for o in c.objects if o.type=='MESH' and any(s.material.get('engine_name') in ('Hull','Accent','Trim','Dark') for s in o.material_slots if s.material)];mats={s.material for o in meshes for s in o.material_slots if s.material}
for o in list(scene.objects):o.hide_render=o not in meshes
bake._select(meshes)
mask=bake._new_target('LiveryRegionMask',4096,False)
changes=[]
for m in mats:
    nt=m.node_tree;out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL');old=out.inputs['Surface'].links[0].from_socket
    tex=nt.nodes.new('ShaderNodeTexImage');tex.image=mask;nt.nodes.active=tex
    em=nt.nodes.new('ShaderNodeEmission');em.inputs['Color'].default_value={'Hull':(1,0,0,1),'Accent':(0,1,0,1),'Trim':(0,0,1,1)}.get(m.get('engine_name'),(0,0,0,1));nt.links.new(em.outputs[0],out.inputs['Surface']);changes.append((m,tex,em,out,old))
bpy.ops.object.bake(type='EMIT',use_clear=False)
print('LIVERY REGION MASK BAKED',flush=True)
regions=np.empty(4096*4096*4,np.float32);mask.pixels.foreach_get(regions);regions=regions.reshape(-1,4)
for m,tex,em,out,old in changes:
    m.node_tree.nodes.remove(tex);m.node_tree.nodes.remove(em);m.node_tree.links.new(old,out.inputs['Surface'])
base=bpy.data.images['lark_4k_baseColor'];pixels=np.empty(4096*4096*4,np.float32);base.pixels.foreach_get(pixels);pixels=pixels.reshape(-1,4)
original=[(.67,.62,.49),(.027,.27,.23),(.055,.13,.17)]
def linear(h):
    c=np.array([int(h[i:i+2],16)/255 for i in (1,3,5)])
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
records=[]
for scheme,hexes in [('compact',['#F4F4F0','#22406A','#F28C28']),('working',['#9A968C','#3A3B3D','#E3B341'])]:
    result=pixels.copy()
    for i in range(3):
        sel=(regions[:,i]>.8)&(np.sum(regions[:,:3],axis=1)<1.2)
        result[sel,:3]=np.clip(pixels[sel,:3]/np.array(original[i])*linear(hexes[i]),0,1)
    img=bpy.data.images.new('lark_livery_'+scheme,4096,4096,alpha=False);img.colorspace_settings.name='sRGB';img.pixels.foreach_set(result.ravel());img.update();img.pack();img.use_fake_user=True
    bpy.data.objects['Body']['livery_texture_'+scheme]=img.name
    records.append({'id':scheme,'image':img.name,'size':[4096,4096],'pixel_sha256':hashlib.sha256(result.tobytes()).hexdigest(),'palette':hexes})
    print('LIVERY',scheme,flush=True)
bpy.data.images.remove(mask)
# Convex collision envelopes built from the actual base shell vertices, not nominal hull dimensions.
body=bpy.data.objects['Body'];points=[body.matrix_world@v.co for v in body.data.vertices]
root=bpy.data.collections['lark']
for o in list(root.objects):
    if o.name.startswith('COL_'):bpy.data.objects.remove(o,do_unlink=True)
regions=[('Body',lambda p:abs(p.x)<=3.15),('NacelleL',lambda p:-5.25<=p.x<-3.15),('NacelleR',lambda p:3.15<p.x<=5.25),('WingL',lambda p:p.x<-5.25),('WingR',lambda p:p.x>5.25)]
collider_records=[]
for name,accept in regions:
    verts=[tuple(p) for p in points if accept(p)];bm=bmesh.new()
    for p in verts:bm.verts.new(p)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.002)
    result=bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
    bmesh.ops.delete(bm,geom=list(set(result['geom_interior']+result['geom_unused'])),context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    mesh=bpy.data.meshes.new('COL_'+name);bm.to_mesh(mesh);bm.free()
    o=bpy.data.objects.new('COL_'+name,mesh);root.objects.link(o);o.hide_render=True;o.display_type='WIRE'
    mesh.calc_loop_triangles()
    if len(mesh.loop_triangles)>480:
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
        modifier=o.modifiers.new('Collider_budget','DECIMATE');modifier.ratio=460/len(mesh.loop_triangles);modifier.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        center=sum((v.co for v in mesh.vertices),Vector())/len(mesh.vertices)
        for v in mesh.vertices:v.co=center+(v.co-center)*1.012
        mesh.update();mesh.calc_loop_triangles()
    collider_records.append({'name':o.name,'triangles':len(mesh.loop_triangles),'source_vertices':len(verts)})
    print('COLLIDER',collider_records[-1],flush=True)
# Glass remains a distinct canopy material and source-owned packed map set, including its retained crazing.
for vid in ('lark_damaged','lark_husked'):
    coll=bpy.data.collections[vid+'_LOD0'];objs=[o for o in coll.objects if o.type=='MESH']
    for o in objs:
        for m in o.data.materials:
            if m.get('engine_name')=='Glass':
                bake.bake_material(m,[o],4096,label=vid+'_Glass',occluders=objs)
# The Hollow writes narrow glyph/seam traces onto the retained shell; no running lamps or live exhaust.
coll=bpy.data.collections['lark_husked_LOD0'];objects=[o for o in coll.objects if o.type=='MESH' and any(s.material.get('engine_name') in ('Hull','Accent','Trim','Dark') for s in o.material_slots if s.material)];mats={s.material for o in objects for s in o.material_slots if s.material}
for o in list(scene.objects):o.hide_render=o not in objects
for o in objects:
    attr=o.data.color_attributes.new(name='HollowTrace',type='FLOAT_COLOR',domain='CORNER');values=[]
    for loop in o.data.loops:
        p=o.matrix_world@o.data.vertices[loop.vertex_index].co;x,y,z=p
        radius=math.hypot(x,y+4.9);theta=math.atan2(x,y+4.9)
        seam=min(abs(math.sin(theta-a))*radius for a in (-.64,-.39,.39,.64))
        lit=z>.25 and -4.5<y<-.1 and radius>1.0 and seam<.028
        glyph=z>.25 and abs(abs(x)-1.8)<.30 and abs(y+1.4)<.40 and (abs(y+1.4)<.025 or abs(abs(x)-1.8)<.025)
        values.extend((.35,.72,.61,1) if lit or glyph else (0,0,0,1))
    attr.data.foreach_set('color',values)
image=bake._new_target('lark_husked_4k_emissive',4096,True);changes=[]
bake._select(objects)
for m in mats:
    nt=m.node_tree;out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL');surface=out.inputs['Surface'].links[0].from_socket
    tex=nt.nodes.new('ShaderNodeTexImage');tex.image=image;nt.nodes.active=tex
    attr=nt.nodes.new('ShaderNodeVertexColor');attr.layer_name='HollowTrace';em=nt.nodes.new('ShaderNodeEmission');nt.links.new(attr.outputs['Color'],em.inputs['Color']);nt.links.new(em.outputs[0],out.inputs['Surface']);changes.append((m,out,surface,tex,attr,em))
bpy.ops.object.bake(type='EMIT',use_clear=False);bake._finish(image,'lark_husked','emissive')
for m,out,surface,tex,attr,em in changes:
    nt=m.node_tree
    for node in (tex,attr,em):nt.nodes.remove(node)
    nt.links.new(surface,out.inputs['Surface']);bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    if m.get('engine_name') in ('Hull','Accent'):
        tex=nt.nodes.new('ShaderNodeTexImage');tex.image=image;nt.links.new(tex.outputs['Color'],bs.inputs['Emission Color']);bs.inputs['Emission Strength'].default_value=.5
    elif m.get('engine_name','').startswith('Nav') or m.get('engine_name')=='EngineGlow':
        bs.inputs['Emission Strength'].default_value=.000001
for o in objects:
    for attr in list(o.data.color_attributes):o.data.color_attributes.remove(attr)
print('HOLLOW TRACE BAKED',flush=True)
# Store a complete source-side livery contract for serialization; no export-generated paint.
scene['lark_livery_textures']=json.dumps(records)
bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
(OUT/'source-finish.json').write_text(json.dumps({'liveries':records,'colliders':collider_records,'source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest()},indent=2)+'\n')
