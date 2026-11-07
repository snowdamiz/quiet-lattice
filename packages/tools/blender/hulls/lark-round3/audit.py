"""Read-only source/GLB contract audit and focused destructive-in-memory negative controls."""
import bpy,sys,json,hashlib,math,tempfile,copy,os
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current';sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core,rules as R,scene as S,checks as C,materials as M,glb,ktx
sys.path.insert(0,str(Path(__file__).parent))
from runtime_limits import configure
configure(ktx)
SRC=ROOT/'assets/blend/hulls/lark.blend';GLB=ROOT/'packages/client/public/models/hulls/lark.glb';rules=R.load()

def asset(path):return {'path':str(path.relative_to(ROOT)),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

def source_facts():
    model=S.collect_source(rules);S.assign_classes(rules,'hulls',model)
    variants=[]
    for v in model.assets[0].variants.values():
        draws={};textures={};tri=C.lod_tris(rules,v)
        for n,obs in v.lods.items():
            meshes=S.render_meshes(rules,obs)
            draws[n]=sum(len({p.material_index for p in o.data.polygons}) for o in meshes)
            textures[n]=sorted({(ch.image.name,tuple(ch.image.size)) for m in C._materials_of(rules,v,[n]) for ch in M.MaterialInfo(m).channels.values() if ch.image})
        assert max(draws.values())<=12,(v.id,draws)
        assert all(textures[n]==textures[0] for n in (1,2,3)),(v.id,'lower LOD texture mismatch')
        for m in C._materials_of(rules,v):
            if m.get('engine_name') in ('Hull','Accent','Trim','Dark'):
                assert m.get('bake_source_lod')==0
                assert all(tuple(ch.image.size)==(4096,4096) for ch in M.MaterialInfo(m).channels.values() if ch.image)
        assert 60000<=tri[0]<=150000 and tri[3]<tri[0]*.05
        pts=[o.matrix_world@Vector(p) for o in S.render_meshes(rules,v.lods[0]) for p in o.bound_box]
        length=max(p.y for p in pts)-min(p.y for p in pts)
        assert 12<=length<=14,(v.id,length)
        variants.append({'id':v.id,'triangles':tri,'draws_all_parts_visible':draws,'textures':textures,'length_m':length})
    # True skin deformation around semantic hinges, not only metadata or a node count.
    motions=[]
    for rig in [o for o in bpy.data.collections['lark_LOD0'].objects if o.type=='ARMATURE']:
        mesh=next(o for o in bpy.data.collections['lark_LOD0'].objects if o.type=='MESH' and any(md.type=='ARMATURE' and md.object==rig for md in o.modifiers))
        assert all(len([g for g in v.groups if g.weight>.999])==1 for v in mesh.data.vertices)
        def evaluated():
            bpy.context.view_layer.update();ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());return np.array([tuple(ev.matrix_world@v.co) for v in ev.data.vertices])
        for name in ['GearFront','GearLeft','GearRight','CockpitStick','CockpitThrottle']:
            if name not in rig.pose.bones:continue
            bone=rig.pose.bones[name];before=evaluated();old=bone.matrix_basis.copy();bone.rotation_mode='XYZ';bone.rotation_euler.x=.4;after=evaluated();bone.matrix_basis=old;bpy.context.view_layer.update()
            group=mesh.vertex_groups[name].index;selected=np.array([any(g.group==group and g.weight>.99 for g in v.groups) for v in mesh.data.vertices]);delta=np.linalg.norm(after-before,axis=1)
            assert selected.any() and delta[selected].max()>.02,(name,'joint fails to move its part')
            assert delta[~selected].max(initial=0)<1e-5,(name,'moves another part')
            motions.append({'joint':name,'vertices':int(selected.sum()),'max_motion_m':float(delta[selected].max()),'other_part_max_m':float(delta[~selected].max(initial=0))})
    body=bpy.data.objects['Body'];vertices=[body.matrix_world@v.co for v in body.data.vertices]
    hp={}
    for name in ('HP_S_1','HP_S_2'):
        p=bpy.data.objects[name].matrix_world.translation;distance=min((v-p).length for v in vertices);assert distance<.20,(name,distance);hp[name]={'location':list(p),'nearest_mount_vertex_m':distance}
    colliders=[]
    for o in bpy.data.collections['lark'].objects:
        if not o.name.startswith('COL_'):continue
        planes=[(o.matrix_world@o.data.vertices[p.vertices[0]].co,o.matrix_world.to_3x3()@p.normal) for p in o.data.polygons]
        colliders.append((o,planes))
    samples=vertices[::7];inside=0
    for point in samples:
        inside+=any(all((point-origin).dot(normal)<=.012 for origin,normal in planes) for _,planes in colliders)
    coverage=inside/len(samples);assert coverage>.985,coverage
    ref=bpy.data.objects['REF_Biped'];assert abs(ref.dimensions.z-1.85)<.02
    return {'variants':variants,'motions':motions,'hardpoints':hp,'collider_sample_coverage':coverage,'collider_sample_count':len(samples),'colliders':[{'name':o.name,'triangles':S.tri_count(o)} for o,_ in colliders],'reference_height_m':ref.dimensions.z,'boarding':{n:list(bpy.data.objects[n].location) for n in ('Interact','BoardingFoot','BoardingSill','PilotSeat')}}

core.load(SRC)
assert not any(mesh.validate() for mesh in bpy.data.meshes),'Source mesh needs repair before serialization'
facts=source_facts();negative=[]
facts['packed_images']=[{'name':i.name,'size':list(i.size),'packed_bytes':i.packed_file.size,'packed_sha256':hashlib.sha256(bytes(i.packed_file.data)).hexdigest()} for i in bpy.data.images if i.packed_file]
# Compare the three actual saved palettes at surface UVs, excluding unused atlas space.
body_mesh=bpy.data.objects['Body'].data;body_mesh.calc_loop_triangles();sample_uv=[]
for index,tri in enumerate(body_mesh.loop_triangles):
    if index%13:continue
    if body_mesh.materials[tri.material_index].get('engine_name') not in ('Hull','Accent','Trim'):continue
    uv=sum((body_mesh.uv_layers.active.data[i].uv for i in tri.loops),Vector((0,0)))/3
    sample_uv.append((min(4095,max(0,int(uv.y*4096))),min(4095,max(0,int(uv.x*4096)))))
palette_samples={};palette_records=[]
for scheme,image_name in [('Thalune','lark_4k_baseColor'),('Compact','lark_livery_compact'),('Working','lark_livery_working')]:
    image=bpy.data.images[image_name];assert tuple(image.size)==(4096,4096)
    pixels=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(4096,4096,4)
    sampled=np.array([pixels[y,x,:3] for y,x in sample_uv]);palette_samples[scheme]=sampled
    palette_records.append({'index':len(palette_records),'scheme':scheme,'image':image_name,'surface_samples':len(sample_uv),'mean_linear_rgb':sampled.mean(axis=0).tolist(),'packed_sha256':hashlib.sha256(bytes(image.packed_file.data)).hexdigest()})
palette_distances=[]
for a,b in [('Thalune','Compact'),('Thalune','Working'),('Compact','Working')]:
    distance=float(np.abs(palette_samples[a]-palette_samples[b]).mean());assert distance>.02,(a,b,distance)
    palette_distances.append({'schemes':[a,b],'surface_mean_absolute_rgb_distance':distance})
facts['livery_surface_samples']={'palettes':palette_records,'pairwise_distances':palette_distances}
# Inspect actual surface texels in the authored impact region, and physical surface separation.
impact={}
for vid,name in (('lark','Body'),('lark_damaged','Body_dmg')):
    o=bpy.data.objects[name];mesh=o.data;mesh.calc_loop_triangles();image=bpy.data.images[vid+'_4k_baseColor']
    pixels=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(4096,4096,4);values=[];points=[]
    for tri in mesh.loop_triangles:
        if mesh.materials[tri.material_index].get('engine_name')!='Hull':continue
        p=sum((mesh.vertices[i].co for i in tri.vertices),Vector())/3
        if abs(p.x-2.3)>1.2 or abs(p.y+.45)>1.4 or p.z<.25:continue
        uv=sum((mesh.uv_layers.active.data[i].uv for i in tri.loops),Vector((0,0)))/3
        color=pixels[min(4095,max(0,int(uv.y*4096))),min(4095,max(0,int(uv.x*4096))),:3]
        values.append(float(color@np.array([.2126,.7152,.0722])));points.append(p)
    assert values
    impact[vid]={'samples':len(values),'median_linear_luminance':float(np.median(values))}
    if vid=='lark':base_points=points
    else:
        tree=BVHTree.FromPolygons([v.co for v in mesh.vertices],[p.vertices[:] for p in mesh.polygons]);distances=[tree.find_nearest(p)[3] for p in base_points]
        impact['deformation_max_m']=max(distances);impact['deformation_median_m']=float(np.median(distances))
assert impact['lark_damaged']['median_linear_luminance']<impact['lark']['median_linear_luminance']*.65,impact
assert impact['deformation_max_m']>.15,impact
facts['impact']=impact
def rejected(name,break_it,restore):
    break_it()
    try:
        source_facts()
    except AssertionError as error:
        negative.append({'case':name,'result':'REJECTED','reason':str(error)})
    else:
        raise AssertionError('Negative control accepted: '+name)
    finally:
        restore()
# Mutations are never saved, and each is restored before the next check.
m=bpy.data.materials['Lark_Hull'];node=next(n for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and 'baseColor' in n.image.name);original=node.image
small=bpy.data.images.new('Negative_1024',1024,1024)
rejected('1024 hero texture',lambda:setattr(node,'image',small),lambda:setattr(node,'image',original));bpy.data.images.remove(small)
lod2=next(o for o in bpy.data.collections['lark_LOD2'].objects if o.type=='MESH' and any(s.material==m for s in o.material_slots));slot=next(s for s in lod2.material_slots if s.material==m);copy_material=m.copy()
copy_image=original.copy();copy_image.name='Negative_LOD2_independent_map'
next(n for n in copy_material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image==original).image=copy_image
rejected('independently textured lower LOD',lambda:setattr(slot,'material',copy_material),lambda:setattr(slot,'material',m));bpy.data.materials.remove(copy_material);bpy.data.images.remove(copy_image)
body=bpy.data.objects['Body'];polygon=body.data.polygons[0];old_index=polygon.material_index;extra=m.copy();extra['engine_name']='NegativeExtraDraw';body.data.materials.append(extra);extra_index=len(body.data.materials)-1
rejected('thirteenth material draw',lambda:setattr(polygon,'material_index',extra_index),lambda:setattr(polygon,'material_index',old_index));body.data.materials.pop(index=extra_index);bpy.data.materials.remove(extra)
hp=bpy.data.objects['HP_S_1'];loc=hp.location.copy()
def move_hp():hp.location.x+=30;bpy.context.view_layer.update()
def restore_hp():hp.location=loc;bpy.context.view_layer.update()
rejected('hardpoint detached from socket',move_hp,restore_hp)
mesh=bpy.data.objects['LandingMechanismMesh'];md=next(m for m in mesh.modifiers if m.type=='ARMATURE')
rejected('disconnected gear skin',lambda:setattr(md,'show_viewport',False),lambda:setattr(md,'show_viewport',True))
# The actual stock validator must reject a missing LOD and a dark engine material.
coll=bpy.data.collections['lark_LOD3'];old=coll.name;coll.name='_negative_missing_lod'
report=core.run_checks(rules,SRC,'hulls','source');assert report.status!='PASS';negative.append({'case':'stock validator: missing LOD3','result':'REJECTED'});coll.name=old
engine=bpy.data.materials['Lark_EngineGlow'];bs=next(n for n in engine.node_tree.nodes if n.type=='BSDF_PRINCIPLED');strength=bs.inputs['Emission Strength'].default_value;bs.inputs['Emission Strength'].default_value=0
report=core.run_checks(rules,SRC,'hulls','source');assert report.status!='PASS';negative.append({'case':'stock validator: engine emission removed','result':'REJECTED'});bs.inputs['Emission Strength'].default_value=strength
if '--source-only' in sys.argv:
    report=core.validate_path(rules,SRC,family='hulls');core.write_and_print(report,OUT/'source-validation.json',verbose=True);assert report.status=='PASS'
    (OUT/'source-contract-audit.json').write_text(json.dumps({'source':asset(SRC),'source_facts':facts,'negative_controls':negative},indent=2)+'\n')
    print('SOURCE CONTRACT AUDIT PASS',flush=True);sys.exit(0)
# Validate the actual immutable source and current compressed export afresh.
checks=[]
for path in (SRC,GLB):
    report=core.validate_path(rules,path,family='hulls');dest=OUT/('audit-'+path.suffix[1:]+'.json');core.write_and_print(report,dest,verbose=True);checks.append({'path':str(path.relative_to(ROOT)),'status':report.status});assert report.status=='PASS'
doc,binary=glb.read(GLB);mats=doc['materials'];nodes=doc['nodes']
def descendants(index):
    yield index
    for child in nodes[index].get('children',[]):yield from descendants(child)
export_lods=[]
for i,n in enumerate(nodes):
    if n.get('name','').startswith('lark') and '_LOD' in n.get('name',''):
        ids=list(descendants(i));draws=sum(len(doc['meshes'][nodes[j]['mesh']]['primitives']) for j in ids if 'mesh' in nodes[j]);assert draws<=12,(n['name'],draws)
        skins=[nodes[j]['skin'] for j in ids if 'skin' in nodes[j]];assert len(skins)==2,(n['name'],skins)
        mappings=[p['extensions']['KHR_materials_variants']['mappings'] for j in ids if 'mesh' in nodes[j] for p in doc['meshes'][nodes[j]['mesh']]['primitives'] if 'KHR_materials_variants' in p.get('extensions',{})]
        if n['name'].startswith('lark_LOD'):
            assert mappings and all(sorted(v for entry in mapping for v in entry['variants'])==[0,1,2] for mapping in mappings)
        else:assert not mappings
        export_lods.append({'name':n['name'],'draws':draws,'skins':skins,'livery_mapped_primitives':len(mappings)})
assert len(export_lods)==12
assert [v['name'] for v in doc['extensions']['KHR_materials_variants']['variants']]==['Thalune','Compact','Working']
assert len(doc.get('skins',[]))==24
for semantic in ('GearFront','GearLeft','GearRight','CockpitStick','CockpitThrottle'):
    assert sum(n.get('name')==semantic for n in nodes)==12,semantic
texture_inventory,required=ktx.inspect(GLB)
assert all(im['ktx'] and im['ktx']['width']==4096 and im['ktx']['height']==4096 for im in texture_inventory)
for im in texture_inventory:
    entry=doc['images'][im['index']];view=doc['bufferViews'][entry['bufferView']];offset=view.get('byteOffset',0)
    im['sha256']=hashlib.sha256(binary[offset:offset+view['byteLength']]).hexdigest()
with tempfile.TemporaryDirectory(prefix='negative-export-',dir=os.environ['TMPDIR']) as tmp:
    bad=copy.deepcopy(doc);bad['extensionsRequired'].remove('EXT_meshopt_compression');path=Path(tmp)/'missing-required-extension.glb';glb.write(path,bad,binary)
    bad_hash=hashlib.sha256(path.read_bytes()).hexdigest();report=core.validate_path(rules,path,family='hulls',source=SRC)
    core.write_and_print(report,OUT/'negative-export-validation.json',verbose=True)
    assert report.status!='PASS';negative.append({'case':'stock export validator: meshopt not required','result':'REJECTED','mutated_export_sha256':bad_hash,'temporary_asset_removed':True})
output={'source':asset(SRC),'export':asset(GLB),'source_facts':facts,'stock_validation':checks,'negative_controls':negative,'export_lods':export_lods,'skins':len(doc['skins']),'liveries':doc['extensions']['KHR_materials_variants'],'compressed_images':texture_inventory,'boundaries':'CPU source/export correctness only; no engine capture, gameplay, visual grade or frame-time claim'}
(OUT/'contract-audit.json').write_text(json.dumps(output,indent=2)+'\n')
print('CONTRACT AUDIT PASS',flush=True)
