"""Assemble the C.2 handoff from completed tool results, never from asserted receipts."""
import hashlib
import json
import math
from pathlib import Path
import shlex
import subprocess

HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[3]; REPORTS=HERE/'reports'
BASE='5731dc4c92954dd995c4a8ed5975bdbd2f7fdb45'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
source=read(REPORTS/'source-contract.json'); consumer=read(REPORTS/'consumer-contract.json')
assert consumer['totalVariants']==38 and consumer['totalLods']==152
stages=[]
for p in REPORTS.glob('*.json'):
    r=read(p)
    if isinstance(r,dict) and 'command' in r and 'samples' in r: stages.append(r)
stages.sort(key=lambda r:r['start'])
mandatory=['export-creatures-03','export-constructs-01','validate-sources-creatures-02','validate-sources-constructs-02','validate-glbs-creatures-02','validate-glbs-constructs-02','consumer-08']
for name in mandatory:
    r=next(s for s in stages if s['stage']==name)
    assert r['exit']==0 and not r['remainingProcesses'] and not r['stopReason'],name
    assert r['sampling']=='process group and descendant closure',name
    assert r['beforeSources']==r['afterSources'],name
    if name.startswith('validate-'):
        assert r['beforeExports']==r['afterExports'],name
        for p,h in {**r['afterSources'],**r['afterExports']}.items(): assert sha(ROOT/p)==h,(name,p)
assert all(not r['remainingProcesses'] for r in stages)
validations=[read(p) for p in (REPORTS/'validate-final').glob('*.json')]
assert len(validations)==14 and all(v['status']=='PASS' for v in validations)
assets=[]; native=[]
for f in source['files']:
    p=ROOT/f['source']; assert sha(p)==f['sha256']
    export=ROOT/'packages/client/public/models'/f['family']/(f['stem']+'.glb')
    c=next(c for c in consumer['files'] if c['stem']==f['stem']); assert sha(export)==c['sha256']
    for a in [p,export]:assets.append(dict(path=str(a.relative_to(ROOT)),bytes=a.stat().st_size,sha256=sha(a)))
    native.append(dict(family=f['family'],stem=f['stem'],asset=f['stem'],
                       variants=[dict(id=v['id'],review=f"#review:{f['family']}/{f['stem']}:{f['stem']}/{v['id']}") for v in f['variants']],
                       captureCommand=f"pnpm capture -- --review {f['family']}/{f['stem']}",
                       turntableCommand=f"pnpm turntable -- packages/client/public/models/{f['family']}/{f['stem']}.glb",
                       familyCommand=f"pnpm turntable -- packages/client/public/models/{f['family']}/{f['stem']}.glb --family",
                       familySheets=math.ceil(len(f['variants'])/6)))
protected={
 'assets/blend/_library.blend':'33cdd8b1be446e6a1c5dc7f908090b27701d99c3248770ad337e3a7f7cd5210c',
 'packages/client/public/models/creatures.glb':'4065f277d602a1ef0e5e79ecb597258c313b710a32cc89256c0b17d9d8f09b2b',
 'pnpm-lock.yaml':'120259c181fe999fbfa6defa856b0f65e28c7f01da8bfd6c6f2a60d9aa96d75f'}
assert all(sha(ROOT/p)==h for p,h in protected.items())
assert not (ROOT/'packages/tools/blender/artlib/__pycache__').exists()
codecs=[json.loads(line) for line in (REPORTS/'codec.jsonl').read_text().splitlines()]
assert all(c['exit']==0 for c in codecs)
assert all(c['actual'][c['actual'].index('--threads')+1]=='1' for c in codecs if c['actual'][0]=='create')
assert all(b['start']>=a['end'] for a,b in zip(codecs,codecs[1:]))
threads=max(len([row for row in s['rows'] if row[0]!='USER']) for c in codecs for s in c['threadSamples'])
assert threads==1
previews=[p for fam in ['creatures','constructs'] for p in (ROOT/'assets/renders'/fam/'e08t08').glob('*.png')]
assert len(previews)<=96 and sum(p.stat().st_size for p in previews)<=256*1024**2
qualified=[s for s in stages if s.get('sampling')=='process group and descendant closure']
resources=dict(qualifiedMaxAggregateRSS=max(s['maxRSS'] for s in qualified),
               sampling='0.5 second process group plus descendant closure; samples, not an unsampled peak claim',
               initialExportResourceLimit='export-creatures-01 tracked only its initial process group; superseded by export-creatures-02',
               maxStageSeconds=max(s['end']-s['start'] for s in stages),
               minimumPreStageFreeBytes=min(s['beforeFree'] for s in stages),
               minimumSampledFreeBytes=min(x['free'] for s in stages for x in s['samples']),
               codecCalls=len(codecs),codecThreadsSampled=threads,codecMaximumConcurrent=1,
               previewPNGs=len(previews),previewBytes=sum(p.stat().st_size for p in previews),
               allStageProcessesReaped=all(not s['remainingProcesses'] for s in stages),
               worktreeBaselineKiB=4521824,
               worktreeFinalKiB=int(subprocess.check_output(['du','-sk',str(ROOT)],text=True).split()[0]))
resources['worktreeGrowthBytes']=(resources['worktreeFinalKiB']-resources['worktreeBaselineKiB'])*1024
assert resources['qualifiedMaxAggregateRSS']<=8*1024**3
assert resources['minimumSampledFreeBytes']>=12*1024**3
assert resources['maxStageSeconds']<=2700 and resources['worktreeGrowthBytes']<6*1024**3
manifest=dict(task='P1.E08.T08',scope='CPU source/export unit only',base=BASE,branch=git('branch','--show-current'),
              assets=assets,protectedUnchanged=protected,resources=resources,
              sourceContract='reports/source-contract.json',consumerContract='reports/consumer-contract.json',
              stockValidations=[dict(file=v['file'],status=v['status']) for v in validations],
              toolchain=dict(blender='5.2.3 LTS',ktx='4.4.2',
                             ktxSHA256=sha(Path('/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx'))),
              dependencies=dict(strategy='read-only local symlinks, matching parent lockfile; no install',vitestCache='reports/vite-cache',
                                links={p:str((ROOT/p).resolve()) for p in ['node_modules','packages/tools/node_modules','packages/client/node_modules']}))
mask_limit=[]
for f in source['files']:
    if f['family']!='creatures': continue
    p=ROOT/'packages/client/public/models/creatures'/(f['stem']+'.glb'); data=p.read_bytes()
    j=json.loads(data[20:20+int.from_bytes(data[12:16],'little')])
    formats={}
    for mesh in j['meshes']:
        for primitive in mesh['primitives']:
            for key in ['COLOR_0','_LIMB','_PIVOT','_GLOW']:
                if key not in primitive['attributes']: continue
                accessor=j['accessors'][primitive['attributes'][key]]
                formats.setdefault(key,set()).add((accessor['componentType'],accessor.get('normalized',False),accessor['type']))
    assert formats['COLOR_0']=={(5123,True,'VEC4')},formats
    assert formats['_PIVOT']=={(5126,False,'VEC3')},formats
    mask_limit.append(dict(file=str(p.relative_to(ROOT)),sha256=sha(p),formats={k:sorted(v) for k,v in formats.items()}))
limit=dict(status='OPEN SPEC DISCREPANCY; not exact float mask export',
           owner='Parent P1.E08.T08 decision / P1.E14.T12 export tooling',
           brief='geometry.quantize=false is described as preserving the mask as exact floats',
           actual='Pinned Blender 5.2.3 RGBA export selects BYTE_COLOR, converted to normalized UINT16. Stock meshopt preserves that stream. Sources remain POINT FLOAT_COLOR; _limb/_pivot/_glow remain exact Float32 values.',
           source='/Applications/Blender.app/Contents/Resources/5.2/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_extract.py:1323',
           rounding='/Applications/Blender.app/Contents/Resources/5.2/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_attributes.py:184',
           consumerBoundary=consumer['maskBoundary'],files=mask_limit,
           resolution='No exporter/toolchain/runtime edits authorized here. Parent must resolve the specification or route an exporter correction; normalized-mask behavioral PASS is not an exact-float PASS.')
(REPORTS/'export-mask-limit.json').write_text(json.dumps(limit,indent=2)+'\n')
manifest['openMaskPrecisionLimit']='reports/export-mask-limit.json'
(REPORTS/'asset-hash-inventory.json').write_text(json.dumps(manifest,indent=2)+'\n')
(REPORTS/'native-pending.json').write_text(json.dumps(dict(status='NOT RUN; parent admission required',files=native,
    targets=38,reviewImagesPerTarget=['noon-lush_lod0.png','noon-lush_lod2.png','night-exotic_lod0.png','night-exotic_lod2.png','open-space_lod0.png','open-space_lod2.png','wireframe_lod0.png','wireframe_lod2.png','overlay.png','far_lod2.png'],
    reviewPNGs=380,reviewContactSheets=38,perfReports=38,perfLightingMeasurements=114,
    turntableSheets=38,materialCloseupSheets=38,siblingSheets=9,
    additionalGates=['fresh independent code review','fresh blind rubric grade','separate native frame-budget qualification; no CPU timing substitution'],
    animationLimit='Stock Review selects posed meshes; it does not play the Fauna vertex gait or attack phases.'),indent=2)+'\n')
lines=[
'TASK: P1.E08.T08 (art) Creatures at the new bar',
'STATUS: BLOCKED for full task acceptance: CPU authorship/export and behavioral checks delivered, but stock RGBA mask precision conflicts with the brief; parent/exporter-owner resolution and separate native gates remain. Whole-task/native/visual PASS is NOT CLAIMED.',
'SUMMARY: Seven editable saved Blender sources and seven stock-compressed GLBs; 34 creature rest/attack variants, one Compact outpost drone, three Overseer phase reads; all 152 LODs saved and exported. Integer point limb IDs, Z-up joints, sparse glow tips, active POINT masks and shaped knee/ankle loops are preserved. Shared packed 2k PBR paint sets. Sources link the frozen library by relative path. Compact CPU previews were inspected and revised; all previous images and failed-stage logs remain.',
'BRANCH: '+git('branch','--show-current'),
'BASE: '+BASE,
'COMMIT: final SHA/tree are returned with this report in the handoff; this report does not self-reference its enclosing commit.',
'FILES CHANGED: '+', '.join(a['path'] for a in assets)+'; packages/tools/blender/e08t08/**; assets/renders/{creatures,constructs}/e08t08/**.',
'VERIFY:']
for s in stages:
    lines.append(f"- {s['stage']}: exit {s['exit']}; {shlex.join(s['command'])}; {s['end']-s['start']:.3f}s; remaining processes {len(s['remainingProcesses'])}. Log: reports/{s['stage']}.log")
    if s['exit']:
        lines.append('  Last 20 lines of retained failure:')
        lines.extend(('  '+line).rstrip() for line in (REPORTS/(s['stage']+'.log')).read_text(errors='replace').splitlines()[-20:])
lines.extend([
'- Four explicit stock validate commands passed all fourteen files. Stock export sources unchanged before/after; all source/export hashes in reports/asset-hash-inventory.json.',
f"- Actual GLTFLoader + MeshoptDecoder, stock collectLods/showLod/parseSpec/applyGameLook: {consumer['totalVariants']} variants, {consumer['totalLods']} LODs, {consumer['malformedControls']} malformed decoded consumer controls rejected. Saved source geometry/joint/mask samples checked after real decode. Source audit rejected four additional malformed attribute controls.",
'- Texture boundary: the CPU consumer test substitutes texture metadata only to avoid browser/WebGL. Actual KTX pixels, PBR, mips, codecs, quantization and budgets are checked by the unchanged stock exporter and validator, which transcode the actual images. No native image equivalence claim.',
'- Mask precision boundary: sources are POINT FLOAT_COLOR, but pinned stock Blender exports RGBA COLOR_0 as normalized UINT16. Actual decoded samples are within 0.5/65535 plus float tolerance per channel; this is not exact float preservation. _limb, _pivot and _glow are exact Float32. reports/export-mask-limit.json records the actual accessor formats and tooling source lines.',
'DECISIONS:',
'- How to express hand weights with an integer consumer? -> Place authored knee/ankle rings inside the existing shader bend bands; keep integer IDs and one pose joint per limb -> fractional weights are rounded away. No armature or new weight channel.',
'- How to represent attacks? -> Separate posed geometry variants -> stock Review never drives morphTargetInfluences or the fauna shader.',
'- Which predators? -> quad_small pack, biped stalker, flyer diver -> the concrete temperament contract selects these three only.',
'- How to contain stock codecs? -> Task-local KTX launcher serializes encode/decode and changes only --threads to 1 -> stock jobs=1 otherwise requests all 15 host CPUs, and decode otherwise permits two calls. Process-thread samples prove one actual codec thread.',
'- How to remove low-LOD warnings? -> Save lower LODs produced by stock artlib.lods.generate and remove its duplicate collapsed faces with Blender mesh.validate -> LOD0 hashes and lower-LOD point attributes remain unchanged; final stock export has no invalid-mesh warning.',
'- How to preserve discrete attributes through decimation? -> Snap sub-1e-5 arithmetic drift in saved lower-LOD IDs and joints to the authored exact values -> decoded consumer test found 3.000000238 as a limb ID. All geometry and LOD0 remain unchanged; source audit now checks all 152 LODs and actual decoded IDs are integers.',
'- Where do Overseer helpers live? -> One shared root COL_Body and four Muzzle_laser empties, inherited by all three phase reads -> stock source layout cannot have a second collection with the same name as the asset. Body massing and laser positions are shared; no duplicate helper sets.',
'- Why relative library paths? -> //../_library.blend -> source can move to the parent checkout without retaining this worktree path.',
'- Scope incident -> helper imports generated 11 local artlib .pyc cache files; tracked source was never edited. Files were preserved in reports/history/artlib-bytecode.zip and moved under task evidence; artlib cache directory restored absent. Explicit sys.dont_write_bytecode prevents recurrence. Details: reports/bytecode-restoration.json.',
'OUT OF SCOPE FOUND:',
'- Parent P1.E08.T08 / P1.E14.T12: exact-float mask wording conflicts with pinned stock RGBA export. No forbidden exporter edits or post-export GLB rewrite made. The normalized mask passes the actual consumer and stock validator, but exact-float acceptance is unresolved.',
'- Parent P1.E08.T08 gates: native Review for the exact 38-target inventory, three lighting cases at LOD0/2, wireframes, overlays, 100 m views, paired performance, native turntable/material/family sheets, fresh code review and blind grade. reports/native-pending.json enumerates all targets and counts. None run here.',
'- P1.E08.T02 owns gait and attack-phase playback and per-instance runtime scale; P1.E08.T06 owns drone/Overseer live behavior; P1.E14.T07 owns loader adoption and generator removal. P1.E14.T13 owns native frame-budget qualification. Legacy creatures.glb and all runtime code remain unchanged.',
'ARTIFACTS:',
'- reports/asset-hash-inventory.json: fourteen exact SHA-256 digests, resource evidence and pinned toolchain.',
'- reports/source-contract.json, reports/consumer-contract.json, reports/validate-final/*.json, reports/export-final/*.json.',
'- reports/saved-lods.json and reports/lod-repair-probe.json: real lower-LOD repair evidence; reports/history preserves prior sources/exports.',
'- assets/renders/creatures/e08t08/* and assets/renders/constructs/e08t08/*: '+str(len(previews))+' compact CPU PNGs; not a grader packet.',
'- reports/native-pending.json: exact remaining native inventory. reports/*.log and reports/*.json retain every bounded stage, failures, samples, terminal exits and process cleanup.',
'RESOURCE SUMMARY: '+json.dumps(resources,sort_keys=True),
'No push, PR, merge, native/browser/server/database run, cloud launch, installation, toolchain upgrade, or screenshot cleanup.'])
(HERE/'C2-report.txt').write_text('\n'.join(lines)+'\n')
print(json.dumps(dict(assets=len(assets),validations=len(validations),resources=resources)))
