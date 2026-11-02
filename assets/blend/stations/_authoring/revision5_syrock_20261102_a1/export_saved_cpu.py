"""Export only saved station work, without bakes; serial KTX encoders use two threads."""
import hashlib
import json
import os
from pathlib import Path
import sys

import bpy

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[4]
OUT=ROOT/'assets/renders/stations/round5/syrock_20261102_a1'
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
sys.path.insert(0,str(HERE.parent))
from artlib import bake,checks,export,ktx,materials
from round4_common import digest,snapshot

assert os.environ.get('ART_KTX_JOBS')=='1'
report=OUT/'saved_export02_preflight.json';assert not report.exists()
records=[];commands=[]
original_bake=export._bake;original_encode=ktx.encode_args;original_compress=ktx.compress
initial=json.loads((OUT/'initial_saved_source.json').read_text())
assert initial['source_sha256']=='f4a8c86c06314aa8ce6a5c9f21973e41860c94252de1aeabad86fc8a15164be9'
frozen=ROOT/'assets/renders/stations/round4/current/models/stations/scrapyard.glb'
assert digest(frozen)=='00610b536701916229540c74be1935848716703fea7f4575c6d8c2d8c125ead2'
old_doc,old_binary=ktx.glb.read(frozen)
old_images={image['name']:i for i,image in enumerate(old_doc['images'])}
allowed={image['name']:image for image in initial['images'] if image['name'].startswith(('SY_Scrap_','SY_Grate_'))}
assert len(allowed)==7
identity_gate=[]


def no_pending_bakes(rules,family,model,resolution):
    plans=[]
    for asset in model.assets:
        for variant in asset.variants.values():
            for material in checks._materials_of(rules,variant):
                info=materials.MaterialInfo(material);ao=checks.ao_to_bake(rules,family,variant.cls,info)
                todo=bake.channels_to_bake(info,ao) if info.bsdf is not None else []
                plans.append({'asset':asset.name,'variant':variant.id,'material':material.name,'pending_bakes':todo,'ao_bake_needed':ao})
    records.append({'saved_source':bpy.data.filepath,'source_sha256':hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),'plans':plans})
    report.write_text(json.dumps(records,indent=2)+'\n')
    assert not any(p['pending_bakes'] for p in plans),'Pending bake refused; no bake started'
    current=snapshot()['materials']
    for name in ('SY_Scrap','SY_Grate'):
        assert current[name]==initial['snapshot']['materials'][name],name
    for name,old in allowed.items():
        image=bpy.data.images[name]
        assert image.packed_file and hashlib.sha256(image.packed_file.data).hexdigest()==old['packed_sha256'],name
        assert list(image.size)==old['size'],name
        identity_gate.append({'image':name,'packed_source_sha256':old['packed_sha256'],'source_material_exact':True})
    (OUT/'frozen_texture_source_identity.json').write_text(json.dumps(identity_gate,indent=2)+'\n')
    bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
    original_bake(rules,family,model,resolution)


def two_thread_encoder(tool,src,dst,codec,srgb,normal,channels,settings,threads):
    argv=original_encode(tool,src,dst,codec,srgb,normal,channels,settings,2)
    assert argv[argv.index('--threads')+1]=='2'
    commands.append({'argv':argv,'encoder_threads':2,'parallel_encoders':1})
    (OUT/'ktx_cpu02_commands.json').write_text(json.dumps(commands,indent=2)+'\n')
    return argv


def retain_frozen_shared_images(src,dst,settings,log=print):
    assert len(identity_gate)==7,'Actual saved-source identities must pass before reuse'
    doc,binary=ktx.glb.read(src);old_slots=ktx.image_slots(old_doc);new_slots=ktx.image_slots(doc)
    replace={};reused=[]
    for index,image in enumerate(doc['images']):
        name=image.get('name')
        if name not in allowed:continue
        previous=old_images[name]
        assert new_slots[index]==old_slots[previous],name
        old_image=old_doc['images'][previous]
        assert old_image['mimeType']==ktx.KTX2
        payload=ktx._image_bytes(old_doc,old_binary,previous)
        replace[image['bufferView']]=payload;image['mimeType']=ktx.KTX2
        reused.append({'image':name,'packed_source_sha256':allowed[name]['packed_sha256'],
            'frozen_ktx_sha256':hashlib.sha256(payload).hexdigest(),'slots':sorted(new_slots[index])})
    assert len(reused)==7
    cached=Path(src).with_name('source_with_frozen_images.glb');assert not cached.exists()
    ktx.glb.write(cached,doc,ktx._repack(doc,binary,replace))
    (OUT/'frozen_shared_image_reuse.json').write_text(json.dumps({'baseline_export':str(frozen),
        'baseline_sha256':digest(frozen),'saved_source_identity_gate':True,'images':reused,
        'metadata_or_payload_normalization':False},indent=2)+'\n')
    return original_compress(cached,dst,settings,log)


export._bake=no_pending_bakes;ktx.encode_args=two_thread_encoder;ktx.compress=retain_frozen_shared_images
args=sys.argv[sys.argv.index('--')+1:]
raise SystemExit(export.main('stations',args))
