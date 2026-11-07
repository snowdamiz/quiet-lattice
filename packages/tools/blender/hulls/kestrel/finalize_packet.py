"""Seal current CPU evidence and enumerate, without running, the future GPU review."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[4];OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'
sys.path.insert(0,str(HERE))
from asset_contract import VARIANTS,sha


def main():
    q=json.loads((OUT/'qualification.json').read_text());assert q['status']=='PASS'
    for spec in (q['source'],q['export']):assert sha(ROOT/spec['path'])==spec['sha256']
    for name,h in q['reports'].items():assert sha(OUT/name)==h
    focused_tests={}
    for name,count in [('lane-tests-qualified.txt',6),('export-contract-tests-complete-document.txt',8)]:
        result=(OUT/name).read_text();assert result.rstrip().endswith('OK') and f'Ran {count} tests' in result
        if name.startswith('export-'):assert q['export']['sha256'] in result
        focused_tests[name]={'status':'PASS','tests':count,'sha256':sha(OUT/name)}
    export_run=json.loads((OUT/'export-final.run.json').read_text())
    assert export_run['exitCode']==0 and export_run['ownedGroupReapedBeforeUnlock'] and export_run['sourceBefore']==export_run['sourceAfter']==q['source']['sha256']
    recovery=json.loads((HERE/'recovery.json').read_text());base=recovery['base']
    frozen={}
    core_files=['packages/tools/blender/export_hulls.py','packages/tools/blender/families.json','packages/tools/blender/validate.py']+[str(p.relative_to(ROOT)) for p in (ROOT/'packages/tools/blender/artlib').glob('*.py')]
    for file in core_files:
        original=subprocess.check_output(['git','show',base+':'+file],cwd=ROOT)
        assert (ROOT/file).read_bytes()==original,('shared exporter or rules changed',file)
        frozen[file]=hashlib.sha256(original).hexdigest()
    changes=subprocess.check_output(['git','diff','--name-only',base],cwd=ROOT,text=True).splitlines()
    untracked=subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()
    allowed=('packages/tools/blender/hulls/kestrel/','assets/renders/hulls/kestrel-round3-current/')
    for path in changes+untracked:
        assert path in ('assets/blend/hulls/kestrel.blend','packages/client/public/models/hulls/kestrel.glb') or path.startswith(allowed),('out-of-scope change',path)
    images=[];current=[];decoded=0
    for p in sorted(OUT.rglob('*.png')):
        w,h=struct.unpack_from('>II',p.read_bytes(),16);decoded+=w*h*4
        row={'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'width':w,'height':h,'sha256':sha(p)};images.append(row)
        meta=p.with_suffix('.json')
        if meta.exists():
            r=json.loads(meta.read_text())
            if r.get('artifact') in (q['source']['path'],q['export']['path']):
                expected=q['export']['sha256'] if r['artifact']==q['export']['path'] else q['source']['sha256']
                if r.get('sha256')==expected and not r.get('supersededBy'):
                    assert r['imageSha256']==row['sha256'];current.append({**row,'input':r['artifact'],'inputSha256':expected,'variant':r['variant'],'LOD':r['lod'],'view':r['view']})
    assert len(images)<=48 and sum(i['bytes'] for i in images)<=512*1024**2 and decoded<=512*1024**2
    assert len(current)>=27,('incomplete current render packet',len(current))
    inventory={'sourceSha256':q['source']['sha256'],'exportSha256':q['export']['sha256'],'currentCPUImages':current,'allRetainedImagesIncludingReferencesAndSupersededDrafts':images,'retention':{'images':len(images),'encodedBytes':sum(i['bytes'] for i in images),'decodedRGBABytes':decoded,'imageLimit':48,'byteLimit':512*1024**2},'contactSheets':['turntable-eight-angles.png','materials-three-states.png','states-and-liveries-nine.png'],'sharedCoreUnchangedFromBase':frozen,'runtimeAndVisualStatus':'PENDING; CPU evidence is not runtime or visual approval'}
    for sheet in inventory['contactSheets']:
        meta=json.loads((OUT/Path(sheet).with_suffix('.json')).read_text());assert sha(OUT/sheet)==meta['sha256']
        for image in meta['inputs']:assert sha(OUT/image['file'])==image['sha256']
    comparisons=json.loads((OUT/'contact-sheet-verification.json').read_text());assert comparisons['status']=='PASS'
    for comparison in comparisons['comparisons']:assert sha(OUT/comparison['sheet'])==comparison['sha256'] and comparison['maximumDecodedRGBError']<1e-6
    inventory['contactSheetVerificationSha256']=sha(OUT/'contact-sheet-verification.json')
    inventory['focusedCPUTests']=focused_tests
    (OUT/'cpu-preview-manifest.json').write_text(json.dumps(inventory,indent=2)+'\n')
    cases=['noon-lush','night-exotic','open-space'];targets=[]
    for variant in VARIANTS:
        path='assets/renders/review/hulls/kestrel/kestrel'+('' if variant=='kestrel' else '/'+variant)
        captures=[{'path':path+f'/{case}_lod{lod}.png','light':case,'LOD':lod} for case in cases for lod in (0,2)]
        captures += [{'path':path+f'/wireframe_lod{lod}.png','light':'noon-lush','LOD':lod,'wireframe':True} for lod in (0,2)]
        captures += [{'path':path+'/'+name,'light':'noon-lush','LOD':2,'distanceMetres':distance} for name,distance in [('far_lod2.png',100),('far200_lod2.png',200)]]
        captures += [{'path':path+'/overlay.png','collidersAndMarkers':True}]
        targets.append({'asset':'kestrel','variant':variant,'command':['pnpm','capture','--','--review','hulls/kestrel','--asset','kestrel','--variant',variant],'captures':captures,'perf':{'path':path+'/perf.json','cases':cases,'independentPairedRunsPerCase':5,'measure':['actual renderer draw calls at LOD0 and LOD2','1080p shown and hidden whole-scene CPU/GPU frame times','paired asset deltas with spread, errors, missing/disjoint samples','actual device texture memory'],'ceiling':{'runtimeDrawTarget':12,'wholeSceneFrameMs':16.67},'status':'NOT RUN'}})
    future={'task':'P1.E12.T02','component':'Kestrel','visualRound':3,'lastVisualGrade':'R2 REVISE 3.8; materials 3, placeholder 3, all others 4','status':'PENDING, NOT EXECUTED','source':q['source'],'export':q['export'],'targets':targets,'rawCaptureCount':sum(len(t['captures']) for t in targets),'pairedPerfRunCount':len(targets)*len(cases)*5,'retentionPlan':{'workspace':'Separate parent GPU review worktree; this complete CPU packet remains immutable on its retained commit. Hydrate only the eight listed CPU images into the new review packet.','CPUImages':['turntable-eight-angles.png','materials-three-states.png','states-and-liveries-nine.png','fit-cockpit.png','fit-boarding.png','fit-hardpoint-clear.png','fit-pilot.png','export-pilot.png'],'GPU':'Capture 1920x1080 one variant at a time, compose the eleven capture kinds as labelled 3x3 sheets with 960x540 image cells plus 20-pixel labels, verify cells, then remove that variant raw frames. Retain perf JSON. Do not bulk retain 99 raw frames.','sheetDimensions':[2880,1680],'finalImagesIncludingFourAdditionalViews':23,'finalDecodedRGBABytes':354067200,'maxDecodedRGBABytesWithOneVariantElevenRawFrames':445305600,'limitImages':48,'limitBytes':536870912,'required':'Recompute exact encoded and decoded totals before each retention step; reduce optional copies if actual dimensions exceed this plan.'},'additionalViews':['canopy open with 1.85 m pilot reference','boarding approach and 1.4 m clear passage','three hardpoints with matching module-scale reference','frozen sibling-hull family sheet from parent-owned retained packets'],'parentGates':['fresh source/code review','fresh blind third visual grade, artifacts only','runtime performance and GPU qualification under a separately authorized parent run'],'notClaimed':['whole four-hull task completion','runtime or visual PASS','merge or release readiness']}
    future['retentionPlan']['CPUImageHashes']={name:sha(OUT/name) for name in future['retentionPlan']['CPUImages']}
    future['retentionPlan']['currentTaskCleanup']='STOPPED. All 39 current images remain; no archive image removal or dehydration is authorized.'
    future['retentionPlan']['GPU']='Inventory only, not an execution grant. The listed capture CLI writes raw files. Before any future GPU run, the parent must provide an approved bounded workflow, such as streaming captures into the proposed contact sheets without retaining all 99 raw files. Do not remove or dehydrate archive images to satisfy this plan.'
    future['additionalViews']=[
        {'path':'assets/renders/review/hulls/kestrel/round3/canopy-open-scale.png','resolution':[1920,1080],'variant':'kestrel','LOD':0,'condition':'Canopy open 72 degrees; 1.85 m reference figure; runtime pivot/clearance visible','CPUReference':'fit-cockpit.png'},
        {'path':'assets/renders/review/hulls/kestrel/round3/boarding-approach-scale.png','resolution':[1920,1080],'variant':'kestrel','LOD':0,'condition':'Landed gear and open canopy; full stairs and 1.4 m clear approach; 1 m grid','CPUReference':'fit-boarding.png'},
        {'path':'assets/renders/review/hulls/kestrel/round3/hardpoints-module-scale.png','resolution':[1920,1080],'variant':'kestrel','LOD':0,'condition':'HP_S_1, HP_S_2, HP_M_1 with compatible module-size references and labelled 1 m ruler','CPUReference':'fit-hardpoint-clear.png'},
        {'path':'assets/renders/review/hulls/kestrel/round3/frozen-family-scale.png','resolution':[1920,1080],'condition':'Four-hull metre scale; parent must supply frozen sibling packet hashes; do not revise other hulls','siblingPacketHashes':'PENDING parent inventory; not inferred from this worktree'}]
    for item in future['additionalViews']:
        if 'CPUReference' in item:
            name=item['CPUReference'];item['CPUReferenceSha256']=sha(OUT/name);meta=json.loads((OUT/Path(name).with_suffix('.json')).read_text());item['CPUCamera']={k:meta.get(k) for k in ('cameraPosition','lookAt','orthographicScaleMetres')}
    (OUT/'future-gpu-review-inventory.json').write_text(json.dumps(future,indent=2)+'\n')
    manifest={str(p.relative_to(ROOT)):sha(p) for p in sorted(HERE.glob('*.py'))}
    (OUT/'tools-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'status':'CPU packet sealed','currentRenders':len(current),'retention':inventory['retention'],'futureGPUCaptures':future['rawCaptureCount'],'futureGPUExecuted':False},indent=2))


if __name__=='__main__':main()
