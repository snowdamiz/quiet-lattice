"""Assemble the exact CPU/source handoff from retained artifacts and receipts."""
import hashlib
import json
from pathlib import Path
import shlex
import struct
import subprocess

ROOT=Path(__file__).resolve().parents[5]
TASK=ROOT/'assets/blend/cities/ixari'
RENDERS=ROOT/'assets/renders/cities/ixari'


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def rel(path):return str(path.relative_to(ROOT))
def read(path):return json.loads(path.read_text())


def artifact(path):
    raw=path.read_bytes();chunks={};offset=12
    assert struct.unpack_from('<III',raw)==(0x46546c67,2,len(raw))
    while offset<len(raw):
        length,kind=struct.unpack_from('<II',raw,offset);chunks[kind]=raw[offset+8:offset+8+length];offset+=8+length
    doc=json.loads(chunks[0x4E4F534A]);binary=chunks[0x004E4942];images=[]
    for image in doc['images']:
        view=doc['bufferViews'][image['bufferView']];start=view.get('byteOffset',0);data=binary[start:start+view['byteLength']]
        assert image['mimeType']=='image/ktx2' and data.startswith(b'\xabKTX 20\xbb\r\n\x1a\n')
        width,height=struct.unpack_from('<II',data,20);mips,scheme,dfd=struct.unpack_from('<III',data,40)
        images.append(dict(name=image.get('name'),sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),width=width,height=height,
                           mipLevels=mips,codec={163:'ETC1S',166:'UASTC'}[data[dfd+12]],
                           colorSpace={1:'linear',2:'sRGB'}[data[dfd+14]],supercompression={1:'BasisLZ',2:'Zstandard'}[scheme]))
    return dict(path=rel(path),sha256=digest(path),bytes=len(raw),requiredExtensions=doc['extensionsRequired'],
                meshoptStreamBytes=sum(v.get('extensions',{}).get('EXT_meshopt_compression',{}).get('byteLength',0) for v in doc['bufferViews']),
                textures=images,materials=[m['name'] for m in doc['materials']])


def main():
    provenance=read(TASK/'provenance-start.json')
    assert all(digest(ROOT/p)==h for p,h in provenance['protected'].items()),'protected file changed'
    rules=read(ROOT/'packages/tools/blender/families.json')
    files=[];assets=[]
    for ip in sorted((TASK/'inventory').glob('*.json')):
        inventory=read(ip);source=ROOT/inventory[0]['source'];export=ROOT/inventory[0]['glb']
        assert all(a['sourceSha256']==digest(source) for a in inventory)
        meta=dict(group=ip.stem,source=dict(path=rel(source),sha256=digest(source),bytes=source.stat().st_size),export=artifact(export))
        files.append(meta)
        for a in inventory:
            a['exportSha256']=meta['export']['sha256'];a['textureResolution']=rules['classes'][a['assetClass']]['texture']
            a['triangleBudget']=rules['classes'][a['assetClass']]['tris'];a['lod3Ratio']=a['lodTriangles'][3]/a['lodTriangles'][0]
            if a['role'] in ('low','mid','tall'):
                a['plannerSelection']=dict(nominalClass={'low':0,'mid':1,'tall':2}[a['role']],variant=int(a['id'][-1]),
                                           footprintRule='planner.foot >= measured footprintRadius, preserve scale 1')
            assets.append(a)
    assert len(assets)==33 and len(files)==8
    source_audit=read(TASK/'receipts/audit-source-final/audit.json')
    export_audit=read(TASK/'receipts/audit-export-final/audit.json')
    for audit in (source_audit,export_audit):
        assert audit['status']=='PASS'
        for f in audit['files']:assert digest(ROOT/f['path'])==f['sha256'],'stale audit'
    validators=sorted((TASK/'receipts/stock-validate-final/validators').glob('*.json'))
    assert len(validators)==16 and all(read(p)['status']=='PASS' and read(p)['summary']['warn']==0 for p in validators)
    assert read(TASK/'receipts/consumer-final-r2/process.json')['exitCode']==0
    controls=read(TASK/'receipts/resource-controls.json')
    assert len(controls)==4 and all(c['status']=='PASS' for c in controls)
    meshes=read(TASK/'receipts/mesh-validity-final/audit.json')
    assert len(meshes)==132 and not any(m['changed'] for m in meshes)
    lfs=read(TASK/'receipts/local-lfs-final.json')
    assert lfs['status']=='PASS' and lfs['verifiedObjects']==39 and not lfs['networkUsed']
    assert not list(RENDERS.rglob('scratch.png'))
    images=sorted(RENDERS.rglob('*.png'));assert len(images)<=48 and sum(p.stat().st_size for p in images)<=512*1024**2
    final_images=[]
    for group in ('low','mid','tall','civic','kit','props','landmarks','anchor'):
        for prefix in ('source','materials'):
            directory=RENDERS/f'{prefix}-{group}-final'
            r=read(directory/'readout.json');assert 'CPU' in r['claim'] and r['threads']==2
            assert digest(ROOT/r['source'])==r['sourceSha256'],'stale final CPU image'
            final_images.append(dict(path=rel(directory/'sheet.png'),sha256=digest(directory/'sheet.png'),
                                      readout=rel(directory/'readout.json'),views=len(r['cells']),kind=prefix))
    for p in sorted(RENDERS.glob('export-*-final/readout.json')):
        r=read(p);assert digest(ROOT/r['source'])==r['sourceSha256']
        final_images.append(dict(path=rel(p.parent/'sheet.png'),sha256=digest(p.parent/'sheet.png'),readout=rel(p),views=len(r['cells']),kind='compressed export CPU iteration'))
    manifest=dict(task='P1.E10.T06',baseHEAD=provenance['baseHEAD'],worktree=str(ROOT),branch='task/P1-E10-T06-ixari-quavel',
                  authority='Editable saved .blend sources and packed maps; author.py is an initial sculpt-session record, never an export dependency.',
                  coordinateTransform='Blender metres (x,y,z) -> glTF metres (x,z,-y)',
                  budgetsAuthority=dict(path='packages/tools/blender/families.json',sha256=digest(ROOT/'packages/tools/blender/families.json')),
                  files=files,assets=assets,finalCpuImages=final_images,
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
    (TASK/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    attempts=[json.loads(line) for line in (TASK/'attempts.jsonl').read_text().splitlines()]
    failures=[dict(attempt=a['attempt'],command=shlex.join(a['command']),exitCode=a['exitCode'],stoppedBy=a['stoppedBy'],
                   last20Lines=a.get('last20Lines',[]),fullLog=f"assets/blend/cities/ixari/receipts/{a['attempt']}/output.txt",
                   disposition='Expected negative control' if a['attempt'].startswith('control-') else 'Retained failed attempt; superseded by final proof')
              for a in attempts if a['exitCode']!=0 or a['stoppedBy']]
    final_checks=['stock-validate-final','consumer-final-r2','audit-source-final','audit-export-final',
                  'mesh-validity-final','eslint-final','format-final','python-syntax-final']
    summaries={name:read(TASK/'receipts'/name/'process.json') for name in final_checks}
    assert all(a['exitCode']==0 and a['reaped'] and not a['stoppedBy'] for a in summaries.values())
    git_checks=[]
    for command in (['git','diff','--cached','--check'],
                    ['git','diff','--cached','--check','--','.',':(exclude)assets/blend/cities/ixari/receipts/*/output.txt']):
        result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
        git_checks.append(dict(command=shlex.join(command),exitCode=result.returncode,
                               last20Lines=(result.stdout+result.stderr).splitlines()[-20:]))
    assert git_checks[-1]['exitCode']==0
    report={
      'TASK':'P1.E10.T06 (art) Ixari kit and Quavel landmarks · deps:E14.T02 · done:the crystal language kit. →[R].',
      'STATUS':'DONE — full authorized CPU/source stage; independent GPU review, visual grade and runtime integration remain pending parent',
      'SUMMARY':'33 editable Ixari/Quavel assets in8 flat source families and8 compressed exports:12 low/mid/tall residences,7 civic pieces,6 street pieces,5 props,2 spire/summit landmarks and the anchor. Saved-source edits resolved collider fit, passage width, spiral exit, end support and reduced-LOD topology. Full packed PBR atlases, metric references and4 LODs are present. All final CPU checks pass.',
      'BASE':provenance,
      'FINAL_GIT_PROVENANCE':'Exact committed HEAD and tree are reported in the implementation-agent final response, avoiding a self-referential committed hash. Commit message: P1.E10.T06: Ixari kit and Quavel landmarks',
      'FILES CHANGED':{'sources':[f['source']['path'] for f in files],'exports':[f['export']['path'] for f in files],
                       'taskDocumentationAndReceipts':'assets/blend/cities/ixari/','taskTools':'packages/tools/blender/cities/ixari/',
                       'cpuIterationImages':'assets/renders/cities/ixari/'},
      'VERIFY':{'finalChecks':summaries,'stockValidation':dict(files=16,status='PASS',warnings=sum(read(p)['summary']['warn'] for p in validators)),
                'sourceAndExportAssetCount':33,'sourceNegativeControls':source_audit['negativeControls'],
                'localLfsObjects':dict(status=lfs['status'],verifiedObjects=lfs['verifiedObjects'],receipt='assets/blend/cities/ixari/receipts/local-lfs-final.json'),
                'gitWhitespaceChecks':git_checks,
                'rawReceiptWhitespace':'Three retained Vitest stdout logs end with a blank line. Their exact bytes are preserved; the source/documentation diff check excludes only raw output.txt receipts and passes.',
                'resourceNegativeControls':read(TASK/'receipts/resource-controls.json'),
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
          'Library reuse → append existingLIB_GrownCrystal/LIB_SlateStone/LIB_Basalt/LIB_GlyphLight from locally hash-verified_library.blend; pack task-specific editable atlas maps. Shared library/rules/export/runtime remain unchanged.',
          'Resource control race → ignore onlyFileNotFound from the reused scratch still during output enumeration; a churn control proves the fix. Timeouts useSIGINT thenTERM/KILL if needed and reap before lock release.'
      ],
      'OUT OF SCOPE FOUND':manifest['integrationBoundaries'],
      'ARTIFACTS':{'manifest':'assets/blend/cities/ixari/manifest.json','manifestSha256':digest(TASK/'manifest.json'),
                   'sourceExportHashes':'assets/blend/cities/ixari/SHA256SUMS','cpuSheets':final_images,
                   'futureGpuInventory':'assets/blend/cities/ixari/GPU_HANDOFF.json','futureGpuExecution':'NOT_EXECUTED'},
      'RESOURCE BOUNDS':dict(blenderProcessesInLane=1,blenderThreads=2,threadEnv=attempts[-1]['threadEnv'],imageCount=len(images),
                             imageBytes=sum(p.stat().st_size for p in images),imageCap=48,imageByteCap=512*1024**2,
                             peakRecordedProcessGroupRssKiB=max(a['peakGroupRssKiB'] for a in attempts),
                             allSpawnedProcessesReaped=all(a['reaped'] for a in attempts),
                             noBulkLfsFetch=True,offlineFrozenInstall=True,noPushPrMerge=True),
    }
    (TASK/'APPENDIX-C2.json').write_text(json.dumps(report,indent=2)+'\n')
    paths=[ROOT/f['source']['path'] for f in files]+[ROOT/f['export']['path'] for f in files]
    paths += [ROOT/i['path'] for i in final_images]
    (TASK/'SHA256SUMS').write_text(''.join(f'{digest(p)}  {rel(p)}\n' for p in paths))
    print(json.dumps(dict(status='CPU_SOURCE_COMPLETE',assets=len(assets),sources=len(files),exports=len(files),
                          images=len(images),imageBytes=sum(p.stat().st_size for p in images),manifestSha256=digest(TASK/'manifest.json'))))


if __name__=='__main__':main()
