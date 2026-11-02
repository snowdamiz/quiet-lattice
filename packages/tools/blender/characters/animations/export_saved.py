"""Validate/export only saved shared-motion actions. Never authors, renders or bakes.

Blender -b -t 2 --factory-startup --python-exit-code 1 -P .../export_saved.py -- [--validate-only]
The animation-only GLB intentionally carries no meshes/materials/skins: the frozen
T01 exports supply them. Node-local tracks use their exact canonical source bind.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import re
import struct
import sys

import bpy
from mathutils import Matrix, Quaternion

ROOT=Path(__file__).resolve().parents[5]
SOURCE=ROOT/'assets/blend/characters/animations/shared_motion.blend'
DEST=ROOT/'packages/client/public/models/characters/animations'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def curves(action):
    return [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def validate(rig, profile):
    assert rig.type=='ARMATURE' and len(rig.data.bones)==69
    assert set(bpy.data.collections['REF'].objects.keys())=={'REF_Grid','REF_Biped'}
    assert len(profile['bones'])==70
    names={b['name']:b for b in profile['bones']}
    assert set(names)==set(rig.data.bones.keys())|{'neutral_bone'}
    assert rig.matrix_world==Matrix.Identity(4)
    conversion=Matrix.Rotation(-math.pi/2,4,'X')
    for bone in rig.data.bones:
        local=bone.parent.matrix_local.inverted()@bone.matrix_local if bone.parent else conversion@bone.matrix_local
        position,rotation,scale=local.decompose()
        expected=names[bone.name]
        assert expected['parent']==(bone.parent.name if bone.parent else None)
        assert max(abs(position[i]-expected['position'][i]) for i in range(3))<2e-6
        q=Quaternion((expected['quaternion'][3],*expected['quaternion'][:3]))
        assert rotation.rotation_difference(q).angle<1e-4
        assert max(abs(scale[i]-expected['scale'][i]) for i in range(3))<2e-6
    assert bpy.context.scene['source_profile_id']==profile['id']
    assert not rig.constraints and not rig.animation_data.drivers and not rig.animation_data.nla_tracks
    assert all(not pb.constraints for pb in rig.pose.bones)
    assert len(bpy.data.actions)==42
    fps=bpy.context.scene.render.fps
    assert fps==60
    inventory=[]
    for action in sorted(bpy.data.actions,key=lambda a:a.name):
        meta=json.loads(action['motion_metadata'])
        assert action.name==meta['name'] and action['source_profile_id']==profile['id']
        assert list(action.frame_range)==[0,round(meta['duration']*fps)]
        assert meta['duration']>0 and len(json.loads(action['authored_pose_events']))>=3
        fcurves=curves(action)
        assert len(fcurves)==69*7
        channels=set()
        for fc in fcurves:
            match=re.fullmatch(r'pose\.bones\["([A-Za-z_][A-Za-z0-9_]*)"\]\.(location|rotation_quaternion)',fc.data_path)
            assert match and match[1] in names,fc.data_path
            assert (fc.data_path,fc.array_index) not in channels
            channels.add((fc.data_path,fc.array_index))
            assert len(fc.keyframe_points)==round(meta['duration']*fps)+1
            assert all(k.interpolation=='LINEAR' and all(math.isfinite(x) for x in k.co) for k in fc.keyframe_points)
        inventory.append(meta)
    return inventory


def export(rig, profile, inventory):
    binary=bytearray()
    gltf={'asset':{'version':'2.0','generator':'Astra saved-action animation exporter'},'nodes':[],
          'scenes':[{'nodes':[]}],'scene':0,'animations':[],'bufferViews':[],'accessors':[],'buffers':[{}]}
    indices={b['name']:i for i,b in enumerate(profile['bones'])}
    for b in profile['bones']:
        node={'name':b['name'],'translation':b['position'],'rotation':b['quaternion'],'scale':b['scale']}
        children=[indices[p['name']] for p in profile['bones'] if p['parent']==b['name']]
        if children:
            node['children']=children
        if b['parent'] is None:
            gltf['scenes'][0]['nodes'].append(indices[b['name']])
        gltf['nodes'].append(node)

    def accessor(values,width):
        while len(binary)%4:
            binary.append(0)
        data=struct.pack('<'+'f'*len(values),*values)
        view=len(gltf['bufferViews'])
        gltf['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)})
        binary.extend(data)
        item={'bufferView':view,'componentType':5126,'count':len(values)//width,'type':{1:'SCALAR',3:'VEC3',4:'VEC4'}[width]}
        if width==1:
            item.update(min=[min(values)],max=[max(values)])
        gltf['accessors'].append(item)
        return len(gltf['accessors'])-1

    conversion=Matrix.Rotation(-math.pi/2,4,'X')
    bind={b['name']:b for b in profile['bones']}
    rest={b.name:(b.parent.matrix_local.inverted()@b.matrix_local if b.parent else conversion@b.matrix_local) for b in rig.data.bones}
    scene=bpy.context.scene
    for meta in inventory:
        action=bpy.data.actions[meta['name']]
        rig.animation_data.action=action
        count=round(meta['duration']*60)+1
        values={(b.name,p):[] for b in rig.data.bones for p in ('translation','rotation')}
        for frame in range(count):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            for pb in rig.pose.bones:
                local=pb.parent.matrix.inverted()@pb.matrix if pb.parent else conversion@pb.matrix
                rp,rq,rs=rest[pb.name].decompose()
                pp,pq,ps=local.decompose()
                bp=bind[pb.name]
                q=Quaternion((bp['quaternion'][3],*bp['quaternion'][:3]))@rq.inverted()@pq
                q.normalize()
                vector=values[(pb.name,'rotation')]
                packed=[q.x,q.y,q.z,q.w]
                if vector and sum(a*b for a,b in zip(vector[-4:],packed))<0:
                    packed=[-v for v in packed]
                vector.extend(packed)
                values[(pb.name,'translation')].extend([bp['position'][i]+pp[i]-rp[i] for i in range(3)])
                assert max(abs(ps[i]-rs[i]) for i in range(3))<2e-5,'Unexpected animated scale'
        time=accessor([f/60 for f in range(count)],1)
        animation={'name':action.name,'samplers':[],'channels':[],'extras':{**meta,'sourceProfileId':profile['id']}}
        for (name,path),data in values.items():
            width=4 if path=='rotation' else 3
            baseline=bind[name]['quaternion' if path=='rotation' else 'position']
            differs=max(abs(v-baseline[i%width]) for i,v in enumerate(data))>2e-6
            if not differs and not (name=='root' and path=='translation'):
                continue
            assert all(math.isfinite(v) for v in data)
            output=accessor(data,width)
            sampler=len(animation['samplers'])
            animation['samplers'].append({'input':time,'output':output,'interpolation':'LINEAR'})
            animation['channels'].append({'sampler':sampler,'target':{'node':indices[name],'path':path}})
        assert len(animation['channels'])>5
        gltf['animations'].append(animation)
        print('EXPORTED_SAVED_ACTION',action.name,count,len(animation['channels']),flush=True)
    gltf['buffers'][0]['byteLength']=len(binary)
    encoded=json.dumps(gltf,separators=(',',':')).encode()
    encoded+=b' '*((-len(encoded))%4)
    binary+=b'\0'*((-len(binary))%4)
    total=12+8+len(encoded)+8+len(binary)
    result=struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
    path=DEST/'shared_motion.glb'
    path.write_bytes(result)
    return path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--validate-only',action='store_true')
    parser.add_argument('--selftest',action='store_true',help='RAM-only negative controls; no export or save')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    before=sha(SOURCE)
    binding=json.loads((DEST/'source-bind.json').read_text())
    assert sha(ROOT/binding['capturedFrom'])==binding['exportSha256']
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    bpy.context.scene.render.threads_mode='FIXED'
    bpy.context.scene.render.threads=2
    rig=bpy.data.objects['RIG_shared_motion']
    inventory=validate(rig,binding['profile'])
    controls=[]
    if args.selftest:
        action=bpy.data.actions[0]
        fc=curves(action)[0]
        original=fc.data_path
        try:
            fc.data_path='location'
            try:
                validate(rig,binding['profile'])
            except AssertionError:
                controls.append('object channel rejected')
            else:
                raise RuntimeError('Validator accepted an unsupported object channel')
        finally:
            fc.data_path=original
        original=action['source_profile_id']
        try:
            action['source_profile_id']='unknown-source'
            try:
                validate(rig,binding['profile'])
            except AssertionError:
                controls.append('unknown source identity rejected')
            else:
                raise RuntimeError('Validator accepted an unknown source identity')
        finally:
            action['source_profile_id']=original
        assert validate(rig,binding['profile'])==inventory
    if not args.validate_only and not args.selftest:
        output=export(rig,binding['profile'],inventory)
        manifest={'schema':1,'library':'shared_motion.glb','librarySha256':sha(output),
            'authoredSource':'assets/blend/characters/animations/shared_motion.blend','authoredSourceSha256':before,
            'sourceBindManifest':'source-bind.json','sourceBindManifestSha256':sha(DEST/'source-bind.json'),
            'sourceProfileId':binding['profile']['id'],'fps':60,'blendMode':'normal','interpolation':'LINEAR',
            'locomotionPolicy':'in-place; root translation anchored; caller owns world travel, orientation extraction and speed matching',
            'contactPolicy':'stance ankles stay at source bind ground height and move opposite virtual travel; adaptation preserves local bind offsets, not species-specific IK',
            'recallPolicy':'body poses only; glyph ignition, dissolve/flash and anchor placement belong to E07.T14/E06.T03/T04',
            'clips':[{**meta,'sourceProfileId':binding['profile']['id']} for meta in inventory]}
        (DEST/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    assert sha(SOURCE)==before,'Exporter modified the authored source'
    report={'status':'PASS','scope':'CPU-only saved source action validation; not a visual grade',
        'source':str(SOURCE.relative_to(ROOT)),'sourceSha256':before,'sourceProfileId':binding['profile']['id'],
        'savedActions':len(inventory),'authoredBones':69,'canonicalProfileBones':70,'fps':60,
        'restHierarchyAndAxesMatchCanonicalProfile':True,'onlySupportedFiniteBoneCurves':True,
        'sourceUnchanged':True,'negativeControls':controls,'rendered':False,'baked':False}
    Path(__file__).with_name('source-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print('ANIMATION_SOURCE_VALIDATION_PASS',len(inventory),'saved actions; no render/bake/source mutation',flush=True)


if __name__=='__main__':
    main()
