"""Assemble and atomically publish the exact CPU/source handoff.

CLI: build_report.py --attempt UNIQUE_NAME --inputs REPO_RELATIVE_JSON
Inputs schemaVersion=1. Ref = {"path": repo-relative file, "sha256": hex}.
Required: baseline Ref (files[path].sha256), inventory [Ref x8],
sourceAudit/exportAudit/consumer/meshValidity Receipt, commands
{eslint,format,pythonSyntax: Receipt}, stock [{reports:[Ref], receipt:Receipt,
reuseBaseline:bool}], resourceControls/localLfs Ref, attempts [Ref to JSONL],
images [{group,kind:source|materials|export,sheet:Ref,readout:Ref}].
Receipt = {process:Ref,log:Ref,inputs:{evaluated repo path:sha256},result:Ref};
result is omitted for stock/commands. Audit inputs cover their eight files;
consumer covers all source/export/inventory files; meshValidity all sources.
Commands bind at least one checked file; pythonSyntax includes this script.
Stock covers exactly all 16 files; reuseBaseline checks artifact, report,
process and log against baseline. Current source/material sheets cover all
eight groups; export sheets are optional. All other PNGs remain historical.
Only reports/CURRENT.json with status PASS and matching report hashes is current.
Staging directories, failed attempts and legacy root reports are not current.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import struct
import subprocess
import sys
import traceback
import uuid

ROOT=Path(__file__).resolve().parents[5]
TASK=ROOT/'assets/blend/cities/ixari'
RENDERS=ROOT/'assets/renders/cities/ixari'
REPORTS=TASK/'reports'
CHECKED={}


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()
def rel(path):return str(path.relative_to(ROOT))
def read(path):return json.loads(path.read_text())


def require(condition,message):
    if not condition:raise ValueError(message)


def input_path(name):
    p=Path(name)
    require(not p.is_absolute() and '..' not in p.parts and str(p)==name,'expected canonical repository-relative path')
    require(not any(c in name for c in '\n\r\0'),'invalid path')
    return ROOT/p


def checked(path,expected=None):
    value=digest(path)
    require(expected is None or value==expected,f'hash mismatch: {rel(path)}')
    require(path not in CHECKED or CHECKED[path]==value,f'input changed during publication: {rel(path)}')
    CHECKED[path]=value
    return value


def reference(ref):
    require(isinstance(ref,dict) and re.fullmatch('[0-9a-f]{64}',ref.get('sha256','')),'invalid receipt reference')
    p=input_path(ref['path']);checked(p,ref['sha256']);return p


def json_ref(ref):return read(reference(ref))


def receipt(entry,required=()):
    p=json_ref(entry['process']);reference(entry['log'])
    require(type(p['exitCode']) is int and p['exitCode']==0 and p['reaped'] is True and p['stoppedBy'] is None,
            f"failed process receipt: {entry['process']['path']}")
    require(isinstance(p['command'],list) and p['command'],'missing command')
    require(p['threadEnv'] and all(str(v)=='2' for v in p['threadEnv'].values()),'thread env must be 2')
    inputs=entry['inputs'];require(isinstance(inputs,dict) and inputs,'missing evaluated-input hashes')
    require(set(required)<=set(inputs),'receipt omits required evaluated inputs')
    for name,h in inputs.items():checked(input_path(name),h)
    for name,h in inputs.items():
        if name in p.get('evaluatedInputsBefore',{}):
            require(p['evaluatedInputsBefore'][name]==h and p.get('evaluatedInputsAfter',{}).get(name)==h,
                    'receipt input changed during or after execution: '+name)
    for name,h in p.get('inputScriptSha256',{}).items():checked(input_path(name),h)
    return p


def audits(entry,mode,files,assets):
    receipt(entry,files)
    audit=json_ref(entry['result'])
    require(audit['status']=='PASS' and audit['mode']==mode,'failed or wrong audit mode')
    rows=audit['files'];require(len(rows)==8 and {f['path'] for f in rows}==set(files),'audit file coverage')
    for f in rows:
        checked(input_path(f['path']),f['sha256'])
        variants=f['variants'];expected={a['id']:a for a in assets if a['source' if mode=='source' else 'glb']==f['path']}
        require(len(variants)==len(expected) and {v['id'] for v in variants}==set(expected),'audit asset coverage')
        for v in variants:
            require(v['errors']==[] and v['lodTriangles']==expected[v['id']]['lodTriangles'],'audit/inventory disagreement')
    if mode=='source':
        controls=audit['negativeControls']
        require(len(controls)>=5 and all(c.get('stockStatus')=='FAIL' or c.get('status')=='REJECTED' for c in controls),'source negative controls')
    return audit


def cpu_images(config,files):
    images=sorted(RENDERS.rglob('*.png'))
    require(not list(RENDERS.rglob('scratch.png')),'scratch image remains')
    require(len(images)<=48 and sum(p.stat().st_size for p in images)<=512*1024**2,'image retention cap')
    selected={};coverage=set();groups={f['group']:f for f in files}
    for entry in config['images']:
        group=entry['group'];kind=entry['kind'];key=(group,kind)
        require(group in groups and kind in ('source','materials','export') and key not in coverage,'duplicate/invalid image selection')
        coverage.add(key)
        p=reference(entry['sheet']);r=json_ref(entry['readout'])
        require(p in images and p not in selected,'selected image missing/duplicate')
        source=groups[group]['export' if kind=='export' else 'source']
        require(r['source']==source['path'] and r['sourceSha256']==source['sha256'],'stale current CPU image')
        require('CPU' in r['claim'] and r['threads']==2 and r['cells'],'invalid CPU readout')
        selected[p]=dict(path=rel(p),sha256=CHECKED[p],readout=entry['readout']['path'],views=len(r['cells']),
                         group=group,kind=kind,classification='CURRENT_CPU_ITERATION')
    require({(g,k) for g in groups for k in ('source','materials')}<=coverage,'missing source/material sheets')
    all_images=[]
    for p in images:
        if p in selected:all_images.append(selected[p]);continue
        item=dict(path=rel(p),sha256=checked(p),classification='HISTORICAL_UNVERIFIED',kind='historical CPU iteration')
        rp=p.parent/'readout.json'
        if rp.is_file():
            checked(rp);item['readout']=rel(rp)
            try:
                r=read(rp);source=input_path(r['source'])
                item['classification']='HISTORICAL_SUPERSEDED' if source.is_file() and checked(source)==r['sourceSha256'] else 'HISTORICAL_STALE_SOURCE'
            except (ValueError,KeyError,TypeError):pass
        all_images.append(item)
    return images,list(selected.values()),all_images


def artifact(path):
    raw=path.read_bytes();chunks={};offset=12
    require(struct.unpack_from('<III',raw)==(0x46546c67,2,len(raw)),'invalid GLB header')
    while offset<len(raw):
        length,kind=struct.unpack_from('<II',raw,offset);chunks[kind]=raw[offset+8:offset+8+length];offset+=8+length
    doc=json.loads(chunks[0x4E4F534A]);binary=chunks[0x004E4942];images=[]
    for image in doc['images']:
        view=doc['bufferViews'][image['bufferView']];start=view.get('byteOffset',0);data=binary[start:start+view['byteLength']]
        require(image['mimeType']=='image/ktx2' and data.startswith(b'\xabKTX 20\xbb\r\n\x1a\n'),'invalid KTX image')
        width,height=struct.unpack_from('<II',data,20);mips,scheme,dfd=struct.unpack_from('<III',data,40)
        images.append(dict(name=image.get('name'),sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),width=width,height=height,
                           mipLevels=mips,codec={163:'ETC1S',166:'UASTC'}[data[dfd+12]],
                           colorSpace={1:'linear',2:'sRGB'}[data[dfd+14]],supercompression={1:'BasisLZ',2:'Zstandard'}[scheme]))
    return dict(path=rel(path),sha256=digest(path),bytes=len(raw),requiredExtensions=doc['extensionsRequired'],
                meshoptStreamBytes=sum(v.get('extensions',{}).get('EXT_meshopt_compression',{}).get('byteLength',0) for v in doc['bufferViews']),
                textures=images,materials=[m['name'] for m in doc['materials']])


def collect(config,stage,destination):
    baseline=json_ref(config['baseline'])['files']
    checked(TASK/'manifest.json',baseline[rel(TASK/'manifest.json')]['sha256'])
    provenance=read(TASK/'provenance-start.json')
    checked(TASK/'provenance-start.json')
    for p,h in provenance['protected'].items():checked(input_path(p),h)
    checked(ROOT/'packages/tools/blender/families.json')
    rules=read(ROOT/'packages/tools/blender/families.json')
    files=[];assets=[]
    inventories=[reference(r) for r in config['inventory']]
    require(len(inventories)==8 and set(inventories)==set((TASK/'inventory').glob('*.json')),'inventory coverage')
    for ip in sorted(inventories):
        inventory=read(ip);source=ROOT/inventory[0]['source'];export=ROOT/inventory[0]['glb']
        source_hash=checked(source);checked(export)
        require(all(a['source']==rel(source) and a['glb']==rel(export) and a['sourceSha256']==source_hash for a in inventory),'inventory sourceSha256 mismatch')
        meta=dict(group=ip.stem,source=dict(path=rel(source),sha256=digest(source),bytes=source.stat().st_size),export=artifact(export))
        if source_hash!=baseline[rel(source)]['sha256']:
            require(meta['export']['sha256']!=baseline[rel(export)]['sha256'],'changed source still has baseline GLB')
        files.append(meta)
        for a in inventory:
            a['exportSha256']=meta['export']['sha256'];a['textureResolution']=rules['classes'][a['assetClass']]['texture']
            a['triangleBudget']=rules['classes'][a['assetClass']]['tris'];a['lod3Ratio']=a['lodTriangles'][3]/a['lodTriangles'][0]
            if a['role'] in ('low','mid','tall'):
                a['plannerSelection']=dict(nominalClass={'low':0,'mid':1,'tall':2}[a['role']],variant=int(a['id'][-1]),
                                           footprintRule='planner.foot >= measured footprintRadius, preserve scale 1')
            assets.append(a)
    require(len(assets)==33 and len({a['id'] for a in assets})==33 and len(files)==8,'asset count/uniqueness')
    sources={f['source']['path'] for f in files};exports={f['export']['path'] for f in files}
    require(len(sources)==len(exports)==8,'source/export uniqueness')
    source_audit=audits(config['sourceAudit'],'source',sources,assets)
    export_audit=audits(config['exportAudit'],'export',exports,assets)
    validators=[];validated=set();summaries={}
    for index,batch in enumerate(config['stock']):
        reports=[json_ref(r) for r in batch['reports']]
        names={r['file'] for r in reports}
        require(names and len(names)==len(reports) and not names & validated,'duplicate stock coverage')
        require(names<=sources|exports,'unknown stock file')
        summaries[f'stock-{index}']=receipt(batch['receipt'],names)
        require(type(batch['reuseBaseline']) is bool,'stock reuseBaseline must be explicit')
        for ref,r in zip(batch['reports'],reports):
            require(r['status']=='PASS' and r['error'] is None and r['family']=='cities'
                    and r['summary']['warn']==r['summary']['fail']==0,'stock validation failed')
            require(r['mode']==('source' if r['file'] in sources else 'export'),'stock mode mismatch')
            if batch['reuseBaseline']:
                for path in (r['file'],ref['path'],batch['receipt']['process']['path'],batch['receipt']['log']['path']):
                    checked(input_path(path),baseline[path]['sha256'])
            else:
                require(ref['path'] not in baseline or ref['sha256']!=baseline[ref['path']]['sha256'],'old stock receipt requires reuseBaseline')
            validators.append(reference(ref))
        validated.update(names)
    require(validated==sources|exports and len(validators)==16,'stock coverage must be all 16 files')
    summaries['consumer']=receipt(config['consumer'],sources|exports|{rel(p) for p in inventories})
    consumer=json_ref(config['consumer']['result'])
    require(consumer['success'] is True and consumer['numTotalTests']==consumer['numPassedTests']==68
            and consumer['numFailedTests']==consumer['numPendingTests']==consumer.get('numTodoTests',0)==0,'consumer must pass all 68 tests')
    assertions=[a for suite in consumer['testResults'] for a in suite['assertionResults']]
    require(len(assertions)==68 and all(a['status']=='passed' for a in assertions),'missing/failed consumer assertions')
    controls=json_ref(config['resourceControls'])
    require(len(controls)==4 and all(c['status']=='PASS' for c in controls),'resource controls failed')
    summaries['meshValidity']=receipt(config['meshValidity'],sources)
    meshes=json_ref(config['meshValidity']['result'])
    require(len(meshes)==132 and all(m['changed'] is False and m['before']==m['after'] for m in meshes),'mesh validity failed')
    require({m['file'] for m in meshes}=={Path(p).name for p in sources}
            and len({(m['file'],m['object']) for m in meshes})==132,'mesh validity coverage')
    images,final_images,all_images=cpu_images(config,files)
    prior_images={p for p in baseline if p.startswith('assets/renders/cities/ixari/') and p.endswith('.png')}
    require(prior_images<={rel(p) for p in images},'historical image removed')
    for p in prior_images:checked(input_path(p),baseline[p]['sha256'])
    new_images=[p for p in images if rel(p) not in prior_images]
    require(len(new_images)<=12 and sum(p.stat().st_size for p in new_images)<=128*1024**2,'revision image cap')
    lfs=json_ref(config['localLfs']);objects=lfs['objects']
    require(lfs['status']=='PASS' and lfs['networkUsed'] is False and lfs['verifiedObjects']==len(objects),'local LFS summary')
    require(len({o['path'] for o in objects})==len(objects),'duplicate LFS objects')
    require(sources|exports|{rel(p) for p in images}<={o['path'] for o in objects},'LFS object coverage')
    for o in objects:
        p=input_path(o['path']);checked(p,o['sha256'])
        require(o['status']=='PASS' and p.stat().st_size==o['bytes'],'LFS object mismatch')
        local=Path(o['localObject'])
        require(local.is_absolute() and local.is_file() and local.stat().st_size==o['bytes']
                and digest(local)==o['sha256'],'local LFS storage object mismatch')
    for name in ('sourceAudit','exportAudit'):summaries[name]=json_ref(config[name]['process'])
    manifest=dict(task='P1.E10.T06',baseHEAD=provenance['baseHEAD'],worktree=str(ROOT),branch='task/P1-E10-T06-ixari-quavel',
                  authority='Editable saved .blend sources and packed maps; author.py is an initial sculpt-session record, never an export dependency.',
                  coordinateTransform='Blender metres (x,y,z) -> glTF metres (x,z,-y)',
                  budgetsAuthority=dict(path='packages/tools/blender/families.json',sha256=digest(ROOT/'packages/tools/blender/families.json')),
                  files=files,assets=assets,finalCpuImages=final_images,allCpuImages=all_images,
                  lodTarget='Stock 30%, 10%, 3.5%, followed by removal of duplicate degenerate faces. Final exact counts are recorded; every LOD3 remains below5%.',
                  sourceChangedByExport=False,protectedFilesUnchanged=True,
                  qualification=dict(source='PASS',stockSourcesAndExports='PASS',compressedArtifactGeometry='PASS',actualCpuConsumers='68 tests PASS',
                                     gpuReview='PENDING_PARENT',blindVisualGrade='PENDING_PARENT',performance='NOT_MEASURED',cityRuntimeIntegration='E10.T01_PENDING'),
                  placement=dict(preserveMetricScale=True,plannerFootIsRadius=True,allFourVariants=True,
                                 flatFiles='Stock exporter discovers assets/blend/cities/ixari_*.blend without recursion.',
                                 bridge='24m central span with approach aprons; local walking endpoints (0,+/-12,0.18); central deck reaches0.68m. Connect matching world elevations.',
                                 spireHall='Upper canopy landing at local z64.02m; the open south approach reaches y=-13.12m. T01 places bridges at matching world elevations.',
                                 summit='Four turns climb48m to floor z48.18; centre plaza is an independent anchor socket. Final radial exit is declared and CPU checked.',
                                 anchor='Independent52m basalt memory landmark, ground origin; place at the chosen plaza floor. Its hum/Recall/memory-dive game logic belongs to T01/T02/ActIII.',
                                 serviceFloor='Civic and residence floors z0.18m, one standard step from terrain. Preserve >=3x2m service openings, >=3x3.2m corridors,1.05m rails.'),
                  integrationBoundaries=[
                      'E10.T01 currently constructs three procedural models, applies variant%3, stretches height, and uses cylinder collision. Replace that path with these33 named assets; do not distort doors/pads to planner height.',
                      'Planner class thresholds34/95m differ from nominal art bands6-14/20-60/170-340m. Select appropriate authored buildings and reserve their measured footprints.',
                      'Planner cityPoint and walkers do not implement elevated spiral streets. T01 must connect elevations, bridge endpoints, terrain pads, streaming and LOD selection.',
                      'Real Structures.resolveBoxes proves straight doors/routes but its transformed AABBs are unsuitable for curved/sloped decks. BVH checks prove actual deck support and clearance; actual curved traversal and its approach markers are not runtime-qualified.',
                      'E10.T02 owns service interaction routing, vendors, ship ladder, salvage/quest/Recall/safe-zone behavior. SeveralInteract markers in one landmark must be dispatched by name, not the legacy last-Interact-wins behavior.',
                      'Light_ extras are validated source/artifact points attached to visible growths. Night renderer integration, real light response, LOD popping and60fps await the parent GPU gate.'
                  ])
    attempts=[json.loads(line) for ref in config['attempts'] for line in reference(ref).read_text().splitlines() if line.strip()]
    require(attempts,'empty command history')
    failures=[dict(attempt=a['attempt'],command=shlex.join(a['command']),exitCode=a['exitCode'],stoppedBy=a['stoppedBy'],
                   last20Lines=a.get('last20Lines',[]),fullLog=a.get('fullLog',f"assets/blend/cities/ixari/receipts/{a['attempt']}/output.txt"),
                   disposition='Expected negative control' if a['attempt'].startswith('control-') else 'Retained failed attempt; superseded by final proof')
              for a in attempts if a['exitCode']!=0 or a['stoppedBy']]
    require(set(config['commands'])=={'eslint','format','pythonSyntax'},'required command receipt coverage')
    for name,entry in config['commands'].items():
        summaries[name]=receipt(entry,[rel(Path(__file__).resolve())] if name=='pythonSyntax' else ())
    for a in attempts:
        log=input_path(a.get('fullLog',f"assets/blend/cities/ixari/receipts/{a['attempt']}/output.txt"))
        if log.is_file():checked(log)
    write_json(stage/'manifest.json',manifest)
    git_checks=[]
    for command in (['git','diff','--cached','--check'],
                    ['git','diff','--cached','--check','--','.',
                     ':(exclude)assets/blend/cities/ixari/**/output.txt',
                     ':(exclude)assets/blend/cities/ixari/revision-r1/publication-tests/**/*.log',
                     ':(exclude)assets/blend/cities/ixari/revision-r1/publication-tests/**/*.txt']):
        result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=120)
        git_checks.append(dict(command=shlex.join(command),exitCode=result.returncode,
                               last20Lines=(result.stdout+result.stderr).splitlines()[-20:]))
    require(git_checks[-1]['exitCode']==0,'git whitespace check failed')
    report={
      'TASK':'P1.E10.T06 (art) Ixari kit and Quavel landmarks · deps:E14.T02 · done:the crystal language kit. →[R].',
      'STATUS':'DONE — full authorized CPU/source stage; independent GPU review, visual grade and runtime integration remain pending parent',
      'SUMMARY':'33 editable Ixari/Quavel assets in8 flat source families and8 compressed exports:12 low/mid/tall residences,7 civic pieces,6 street pieces,5 props,2 spire/summit landmarks and the anchor. Saved-source edits resolved collider fit, passage width, spiral exit, end support and reduced-LOD topology. Full packed PBR atlases, metric references and4 LODs are present. All final CPU checks pass.',
      'BASE':provenance,
      'FINAL_GIT_PROVENANCE':'Exact committed HEAD and tree are reported in the implementation-agent final response, avoiding a self-referential committed hash.',
      'FILES CHANGED':{'sources':[f['source']['path'] for f in files],'exports':[f['export']['path'] for f in files],
                       'taskDocumentationAndReceipts':'assets/blend/cities/ixari/','taskTools':'packages/tools/blender/cities/ixari/',
                       'cpuIterationImages':'assets/renders/cities/ixari/'},
      'VERIFY':{'finalChecks':summaries,'stockValidation':dict(files=16,status='PASS',warnings=sum(read(p)['summary']['warn'] for p in validators)),
                'sourceAndExportAssetCount':33,'sourceNegativeControls':source_audit['negativeControls'],
                'localLfsObjects':dict(status=lfs['status'],verifiedObjects=lfs['verifiedObjects'],receipt=config['localLfs']['path']),
                'gitWhitespaceChecks':git_checks,
                'rawReceiptWhitespace':'Raw output.txt receipts, publication-test logs and failure tails retain exact bytes and are excluded from the source/documentation whitespace check.',
                'resourceNegativeControls':controls,
                'publicationInputs':config,'consumerResult':consumer,
                'allCommands':[dict(attempt=a['attempt'],command=shlex.join(a['command']),threadEnv=a['threadEnv'],exitCode=a['exitCode'],reaped=a['reaped'],seconds=a['elapsedSeconds'],peakRssKiB=a['peakGroupRssKiB']) for a in attempts],
                'retainedFailureTails':failures,'notRun':{'GPUReview':'COULD NOT RUN: CPU-only task scope; parent owns scheduling after readiness','blindGrade':'PENDING_PARENT fresh context','smokeAndE2E':'COULD NOT RUN: browser/GPU and services excluded by task brief','test:int':'COULD NOT RUN: services/DB excluded by task brief'}},
      'DECISIONS':[
          'Brief budget shorthand versus actual rules → families.json is authoritative: building8-60k, kit0.5-15k, prop2-10k, hero60-150k;2k/2k/1k/4k and4LODs.',
          'Crystal kit shorthand → full33-asset inventory matching DESIGN5.1 and19.3, with two additional Quavel-specific spire/summit landmarks and the anchor.',
          'Lighting versus conventional lamps → grown crystal/bioluminescent wayfinding pieces with localized fracture emissive maps andLight_ points.',
          'Quavel summit access → actual four-turn48m climbing street with3m corridor,1.05m rails, usable end aprons and open radial exit; T01 must integrate elevation-aware traversal.',
          'Saved source authority → the stock exporter reads flatixari_*.blend, validates both ends, and applies officialKTX/Meshopt. It never imports authoring code. Source editing records are retained separately.',
          'CPU iteration versus visual acceptance → compact labelledCyclesCPU sheets and geometry/consumer proof only. No GPU/native/browser capture or visualPASS claim.',
          'Source/source-LOD/export discrepancy → clean duplicate faces in saved reduced meshes, record resulting actual counts, and assert exact decodedGLB equality. No thresholds were waived.',
          'Legacy collision consumer → preserve accurate faceted/sloped geometry and prove geometric support; explicitly retain T01 AABB traversal limitations instead of claiming runtime readiness.',
          'Library reuse → saved sources reference locally hash-verified library materials and packed task maps. Alphabet glyphs are deferred to T08; decorative crystal markings must not claim the exclusive glyph-light alphabet.',
          'T06 versus T08 → remove the noncanonical GlyphStem/GlyphFork/RecordedStroke box ribbons; T06 provides violet/lilac crystal fault colonies and tactile pressure facets. Complete canonical alphabet application, 2–4cm V-cuts, stroke/orientation rules and exclusive cold-white-cyan network light remain E10.T08.',
          'Resource control race → ignore onlyFileNotFound from the reused scratch still during output enumeration; a churn control proves the fix. Timeouts useSIGINT thenTERM/KILL if needed and reap before lock release.'
      ],
      'OUT OF SCOPE FOUND':manifest['integrationBoundaries'],
      'ARTIFACTS':{'manifest':rel(destination/'manifest.json'),'manifestSha256':digest(stage/'manifest.json'),
                   'sourceExportHashes':rel(destination/'SHA256SUMS'),'cpuSheets':all_images,
                   'futureGpuInventory':'assets/blend/cities/ixari/GPU_HANDOFF.json','futureGpuExecution':'NOT_EXECUTED'},
      'RESOURCE BOUNDS':dict(blenderProcessesInLane=1,blenderThreads=2,threadEnv=attempts[-1]['threadEnv'],imageCount=len(images),
                             imageBytes=sum(p.stat().st_size for p in images),imageCap=48,imageByteCap=512*1024**2,
                             peakRecordedProcessGroupRssKiB=max(a['peakGroupRssKiB'] for a in attempts),
                             allOwnedProcessGroupsReaped=all(a['reaped'] for a in attempts),
                             detachedDescendantsCovered=False,
                             ownershipLimit='Synchronous Blender/codec/Node producers stay in the owned process group; deliberately detached setsid descendants are not covered.',
                             revisionImageCount=len(new_images),revisionImageBytes=sum(p.stat().st_size for p in new_images),
                             revisionImageCap=12,revisionImageByteCap=128*1024**2,
                             noBulkLfsFetch=True,offlineFrozenInstall=True,noPushPrMerge=True),
    }
    if 'revisionEvidence' in config:
        report['REVISION']=json_ref(config['revisionEvidence'])
        require(report['REVISION']['STATUS']=='PASS_CPU_SOURCE_REVISION','revision evidence is not ready')
        for ref in report['REVISION']['evidenceRefs']:reference(ref)
    write_json(stage/'APPENDIX-C2.json',report)
    return dict(assets=len(assets),sources=len(files),exports=len(files),images=len(images),
                imageBytes=sum(p.stat().st_size for p in images))


def write_json(path,value):
    with path.open('x') as f:
        json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())


def sync_directory(path):
    fd=os.open(path,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def current(value):
    temporary=REPORTS/f'.current-{uuid.uuid4().hex}.json'
    write_json(temporary,value)
    os.replace(temporary,REPORTS/'CURRENT.json')
    sync_directory(REPORTS)


def publish(argv):
    REPORTS.mkdir(exist_ok=True)
    invocation=uuid.uuid4().hex
    state=dict(status='IN_PROGRESS',invocation=invocation,command=[sys.executable,str(Path(__file__).resolve()),*argv],
               scriptSha256=digest(Path(__file__).resolve()),attempt=None)
    # A rejected concurrent caller cannot replace the active owner's pointer.
    with (REPORTS/'.publisher.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            state.update(status='REJECTED_BUSY',error='another publisher owns the lock')
            write_json(REPORTS/f'.rejected-{invocation}.json',state)
            print(json.dumps(state),file=sys.stderr);return 1
        stage=None
        try:
            current(state)
            parser=argparse.ArgumentParser(description=__doc__)
            parser.add_argument('--attempt',required=True)
            parser.add_argument('--inputs',required=True)
            args=parser.parse_args(argv)
            require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}',args.attempt),'invalid attempt name')
            state['attempt']=args.attempt
            claims=REPORTS/'.attempts';claims.mkdir(exist_ok=True)
            destination=REPORTS/args.attempt
            require(not destination.exists() and not destination.is_symlink(),'attempt output already exists')
            (claims/args.attempt).mkdir()
            stage=REPORTS/f'.{args.attempt}-{invocation}.staging';stage.mkdir()
            state['staging']=rel(stage)
            current(state)
            write_json(stage/'invocation.json',state)
            config_path=input_path(args.inputs);checked(config_path)
            config=read(config_path)
            require(config['schemaVersion']==1,'unsupported inputs schemaVersion')
            checked(Path(__file__).resolve())
            summary=collect(config,stage,destination)
            # Revalidate every input, including config, receipts, images and script,
            # after collection. No validation gate may run after the PASS pointer.
            for path,h in CHECKED.items():require(digest(path)==h,f'input changed before publication: {rel(path)}')
            sums={rel(p):h for p,h in CHECKED.items()}
            for name in ('manifest.json','APPENDIX-C2.json'):
                sums[rel(destination/name)]=digest(stage/name)
            with (stage/'SHA256SUMS').open('x') as f:
                f.write(''.join(f'{h}  {p}\n' for p,h in sorted(sums.items())))
                f.flush();os.fsync(f.fileno())
            hashes={name:digest(stage/name) for name in ('manifest.json','APPENDIX-C2.json','SHA256SUMS')}
            state.update(status='PASS',exitCode=0,directory=rel(destination),sha256=hashes,summary=summary)
            state.pop('staging')
            write_json(stage/'publication.json',state)
            sync_directory(stage)
            require(not destination.exists() and not destination.is_symlink(),'attempt output appeared during publication')
            stage.rename(destination)
            sync_directory(REPORTS)
            current(state)
            print(json.dumps(state));return 0
        except BaseException as exc:
            state={k:v for k,v in state.items() if k not in ('sha256','summary','directory')}
            state.update(status='FAILED',exitCode=1,error=f'{type(exc).__name__}: {exc}',traceback=traceback.format_exc())
            state['last20Lines']=state['traceback'].splitlines()[-20:]
            # The IN_PROGRESS pointer has already revoked previous PASS even if
            # disk exhaustion prevents this best-effort failure receipt.
            try:write_json(REPORTS/f'.failed-{invocation}.json',state)
            except OSError:pass
            try:current(state)
            except OSError:
                # If even the first pointer write failed, remove a stale PASS
                # where possible. Read-only filesystems cannot be repaired here.
                try:(REPORTS/'CURRENT.json').unlink(missing_ok=True)
                except OSError:pass
            print(state['traceback'],file=sys.stderr);return 1


if __name__=='__main__':sys.exit(publish(sys.argv[1:]))
