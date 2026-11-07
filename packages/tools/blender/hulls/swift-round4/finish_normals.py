"""Author fine stone grain and crystalline growth etching, then pack and test the actual 4k normal maps."""
import bpy,hashlib,json,os,shutil,sys
from pathlib import Path
root=Path(__file__).resolve().parents[5];sys.path.insert(0,str(root/'packages/tools/blender'))
from artlib import scene as S,rules as R,materials as M,bake,ktx
source=root/'assets/blend/hulls/swift.blend';job=Path(os.environ['SWIFT_JOB']);before=hashlib.sha256(source.read_bytes()).hexdigest()
assert before=='3b5c400b61e3814a6f7ea6ec02ae468713813ea2b7f7c3d9818dda11f021a0ca'
shutil.copyfile(source,job/'before-normal-finish.blend');bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.preferences.filepaths.save_version=0
os.environ['KTX']=str(Path(__file__).with_name('ktx_cpu.py'));rules=R.load();model=S.collect_source(rules);rows=[];seen=set();bake.ensure_cycles(bpy.context.scene)
bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
stock_channels=bake.channels_to_bake
bake.channels_to_bake=lambda info,ao:['normal']
try:
 for a in model.assets:
  for v in a.variants.values():
   meshes=S.render_meshes(rules,v.lods[0]);all_meshes=[o for objects in v.lods.values() for o in S.render_meshes(rules,objects)]
   mats={s.material for o in meshes for s in o.material_slots if s.material}
   for mat in sorted(mats,key=lambda m:m.name):
    role=R.material_name(mat)
    if role not in ['Dark','Swift_Crystal','SwiftDmg_Crystal'] or mat.as_pointer() in seen:continue
    seen.add(mat.as_pointer());nt=mat.node_tree;bs=M.MaterialInfo(mat).bsdf;old=bs.inputs['Normal'].links[0].from_socket
    pos=nt.nodes.new('ShaderNodeNewGeometry');pos.label='R4 material grain in metres'
    noise=nt.nodes.new('ShaderNodeTexNoise');noise.label='R4 fine stone grain' if role=='Dark' else 'R4 crystalline growth etching';noise.inputs['Scale'].default_value=65 if role=='Dark' else 45;noise.inputs['Detail'].default_value=2;noise.inputs['Roughness'].default_value=.58;nt.links.new(pos.outputs['Position'],noise.inputs['Vector'])
    bump=nt.nodes.new('ShaderNodeBump');bump.label=noise.label;bump.inputs['Strength'].default_value=.5 if role=='Dark' else .7;bump.inputs['Distance'].default_value=.007 if role=='Dark' else .008;nt.links.new(noise.outputs['Fac'],bump.inputs['Height']);nt.links.new(old,bump.inputs['Normal']);nt.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
    users=[o for o in meshes if any(s.material==mat for s in o.material_slots)]
    bake.bake_material(mat,users,4096,label=v.id+'_'+role+'_R4_detail',occluders=meshes)
    image=M.MaterialInfo(mat).channels['normal'].image;uv=M.surface_uvs(mat,all_meshes);M.clear_cache();raw_std=M.channel_std(image,None,uv,tag=mat.as_pointer())
    scratch=job/'scratch';png=scratch/(v.id+'_'+role+'.png');encoded=png.with_suffix('.ktx2');decoded=scratch/(v.id+'_'+role+'_decoded.png')
    image.filepath_raw=str(png);image.file_format='PNG';image.save();image.pack()
    command=ktx.encode_args(ktx.binary(),png,encoded,'uastc',False,True,ktx.png_channels(png.read_bytes()),ktx.settings(rules,'hulls'),2);ktx._run(command);ktx._run([ktx.binary(),'extract','--transcode','rgba8',str(encoded),str(decoded)])
    check=bpy.data.images.load(str(decoded));check.colorspace_settings.name='Non-Color';M.clear_cache();decoded_std=M.channel_std(check,None,uv,tag=mat.as_pointer())
    record={'variant':v.id,'material':mat.name,'engineName':role,'resolution':list(image.size),'rawStdUnderActualUVs':raw_std,'decodedUASTCStdUnderActualUVs':decoded_std,'stockThreshold':M.UNIFORM_STD,'encodeCommand':command,'temporaryMapHashes':{p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in [png,encoded,decoded]}}
    rows.append(record);(job/'normal-finish.json').write_text(json.dumps({'status':'IN_PROGRESS' if raw_std>=M.UNIFORM_STD*1.5 and decoded_std>=M.UNIFORM_STD*1.5 else 'FAIL','beforeSourceSha256':before,'materials':rows},indent=2));print(json.dumps(record),flush=True)
    assert raw_std>=M.UNIFORM_STD*1.5 and decoded_std>=M.UNIFORM_STD*1.5,'normal detail has insufficient margin'
    bpy.data.images.remove(check);M.clear_cache();image.filepath_raw='';mat['SwiftR4NormalAuthoring']='Packed 4k tangent normal baked from retained fine-grain/growth-etch nodes; editable source, tested through stock UASTC under actual UVs.'
    for p in [png,encoded,decoded]:p.unlink()  # temporary texture probes, never screenshots
    for im in bpy.data.images:
     if im.packed_file and im.has_data:im.buffers_free()
finally:bake.channels_to_bake=stock_channels
assert len(rows)==5
bpy.context.scene['SwiftR4NormalFinish']='Five 4k authored normal maps; fine stone grain and crystal growth etching; original procedural nodes retained.'
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
(job/'normal-finish.json').write_text(json.dumps({'status':'PASS','beforeSourceSha256':before,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'materials':rows,'sourceMapsPacked':True,'geometryChanged':False},indent=2));print('PASS packed 4k normal maps, UASTC surface-UV checks; source saved',flush=True)
