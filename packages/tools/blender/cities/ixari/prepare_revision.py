"""Freeze explicit R1 production evidence for the separate atomic publisher."""
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[5]
TASK=ROOT/'assets/blend/cities/ixari'
REV=TASK/'revision-r1'
TOOLS=ROOT/'packages/tools/blender/cities/ixari'


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def rel(path):return str(path.relative_to(ROOT))
def read(path):return json.loads(path.read_text())
def ref(path):return dict(path=rel(path),sha256=sha(path))
def write(path,value):
    with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n')


def receipt(name,result=None,inputs=None):
    directory=TASK/'receipts'/name;p=read(directory/'process.json')
    assert p['exitCode']==0 and p['reaped'] and not p['stoppedBy'],name
    bindings=inputs if inputs is not None else p['evaluatedInputsBefore']
    for path,h in bindings.items():
        assert sha(ROOT/path)==h,(name,path)
        if path in p.get('evaluatedInputsBefore',{}):
            assert p['evaluatedInputsAfter'][path]==h
    entry=dict(process=ref(directory/'process.json'),log=ref(directory/'output.txt'),inputs=bindings)
    if result:entry['result']=ref(directory/result)
    return entry


def main():
    suite=ROOT/sys.argv[1];assert read(suite)['status']=='PASS' and read(suite)['tests']==15
    out=REV/sys.argv[2];out.mkdir(exist_ok=False)
    commands={name:receipt(attempt,inputs=read(TASK/'receipts'/attempt/'process.json')['inputScriptSha256'])
              for name,attempt in [('eslint','revise-r1-eslint-r2'),('format','revise-r1-format-r2')]}
    commands['pythonSyntax']=receipt('revise-r1-python-r2',inputs=read(TASK/'receipts/revise-r1-python-r2/result.json')['inputs'])
    baseline=read(REV/'baseline.json');changed=[];preserved=[]
    for path,old in baseline['files'].items():
        p=ROOT/path
        keep=path.startswith('assets/renders/cities/ixari/') or path.startswith('assets/blend/cities/ixari/receipts/')
        keep|=path in ('assets/blend/cities/ixari/manifest.json','assets/blend/cities/ixari/APPENDIX-C2.json','assets/blend/cities/ixari/SHA256SUMS')
        if p.suffix in ('.blend','.glb'):
            if p.stem in ('ixari_anchor','ixari_props'):
                assert sha(p)!=old['sha256'];changed.append(dict(path=path,beforeSha256=old['sha256'],afterSha256=sha(p),bytes=p.stat().st_size))
            else:keep=True
        if keep:assert sha(p)==old['sha256'],path;preserved.append(path)
    old_history=baseline['files']['assets/blend/cities/ixari/attempts.jsonl']
    assert hashlib.sha256((TASK/'attempts.jsonl').read_bytes()[:old_history['bytes']]).hexdigest()==old_history['sha256']
    for path,old in baseline['dependencies'].items():
        p=ROOT/path;assert sha(p)==old['sha256'] and p.stat().st_mtime_ns==old['mtimeNs'],path
    protected=read(TASK/'provenance-start.json')['protected']
    assert all(sha(ROOT/p)==h for p,h in protected.items())
    pngs=sorted((ROOT/'assets/renders/cities/ixari').rglob('*.png'))
    new=[p for p in pngs if rel(p) not in baseline['files']]
    assert len(new)<=12 and sum(p.stat().st_size for p in new)<=128*1024**2
    assert not list((ROOT/'assets/renders/cities/ixari').rglob('scratch.png'))
    edits=read(TASK/'receipts/revise-r1-surfaces/edits.json')
    surface=read(TASK/'receipts/revise-r1-surface-audit/audit.json');assert surface['status']=='PASS'
    consumer=read(TASK/'receipts/revise-r1-consumer-r2/result.json');assert consumer['numPassedTests']==68 and consumer['success']
    history=out/'history-before-publication.jsonl'
    with history.open('xb') as f:f.write((TASK/'attempts.jsonl').read_bytes())
    reviewer=out/'reviewer-r1.md'
    with reviewer.open('xb') as f:f.write(Path('/tmp/p1-e10-t06-r1-2d23ecb3/REPORT.md').read_bytes())
    gpu=read(TASK/'GPU_HANDOFF.json')
    gpu['revisionBaseHEAD']=baseline['head'];gpu['revisionBaseTree']=baseline['tree']
    gpu['candidateArtifacts']=[dict(path=rel(p),sha256=sha(p)) for p in sorted((ROOT/'assets/blend/cities').glob('ixari_*.blend'))+sorted((ROOT/'packages/client/public/models/cities').glob('ixari_*.glb'))]
    write(out/'GPU_HANDOFF.json',gpu)
    evidence=[TASK/'receipts/revise-r1-surfaces/edits.json',TASK/'receipts/revise-r1-surface-audit/audit.json',
              REV/'resource-tests/report.json',suite,REV/'publication-tests/BASE_REPRO_DONE.json',reviewer,out/'GPU_HANDOFF.json',REV/'preparation-failed-r1.json']
    revision=dict(TASK='P1.E10.T06 revision R1',STATUS='PASS_CPU_SOURCE_REVISION',revisionBaseHEAD=baseline['head'],revisionBaseTree=baseline['tree'],
        SUMMARY='Remove noncanonical network-light ribbons; save nine localized crystal fault colonies on the anchor and three tactile pressure facets each on the terminal and board. Regenerate only affected saved LODs and export only anchor/props. Publish current qualification only through an atomic complete report set.',
        changedArtifacts=changed,unchangedBundles=['civic','kit','landmarks','low','mid','tall'],preservedHistoricalFiles=preserved,
        protectedHashesUnchanged=len(protected),dependencyLaunchersUnchanged=baseline['dependencies'],
        DECISIONS=['Per orchestrator art-bible 2.2/3.1-3.4 scope decision, complete canonical alphabet application belongs to E10.T08. T06 decorative growth/controls do not represent network writing and cannot use reserved #D8F6FF/#7FD8FF.',
                   'Remove actual GlyphStem/GlyphFork/RecordedStroke faces, not labels alone. New asymmetric stepped rhombic crystal geometry uses Ixari violet/lilac and localized #64E3FF fracture light. The anchor marker changes to #B9A6FF without moving.',
                   'Preserve every unaffected architecture vertex-group coordinate/face/UV hash, COL mesh, interaction pose, scale reference, opening and route. Unaffected six bundles remain byte-identical.',
                   'Canonical 2–4 cm V-cuts, 8% sign stroke weight, canonical seven-node alphabet and top orientation remain future T08 application on retained anchor architecture.',
                   'The stopped preview counted symlink aliases repeatedly. Output accounting now counts unique filesystem objects at the same 4GiB limit; the failed attempt remains retained. Fresh disk admission reserves 8GiB plus1GiB allowance.',
                   'The supervisor reaps its process group. Stock KTX/Meshopt producers use synchronous inherited-group subprocesses; intentionally detached setsid descendants remain outside the guarantee.'],
        VERIFY=dict(surface=surface,publicationTests=ref(suite),resourceControls=ref(REV/'resource-tests/report.json'),consumer68=True,
                    stock='Fresh changed4 plus original unchanged12 with byte/hash proof',nativeGeometry='Saved Blender source and decoded GLB; not runtime walking or GPU visual acceptance'),
        newCpuImages=[dict(path=rel(p),sha256=sha(p),bytes=p.stat().st_size) for p in new],retainedOriginalPngCount=23,newPngCount=len(new),newPngBytes=sum(p.stat().st_size for p in new),
        futureNativeInventory=ref(out/'GPU_HANDOFF.json'),futureNativeExecution='NOT_EXECUTED; parent T15 owns GPU; no browser/server/DB/grants',
        publicationCommand='python3 packages/tools/blender/cities/ixari/build_report.py --attempt revision-r1-publication-01 --inputs '+rel(out/'publication-inputs.json'),
        evidenceRefs=[ref(p) for p in evidence])
    write(out/'REVISION-C2.json',revision)
    inv=sorted((TASK/'inventory').glob('*.json'))
    config=dict(schemaVersion=1,baseline=ref(REV/'baseline.json'),inventory=[ref(p) for p in inv],
        sourceAudit=receipt('revise-r1-audit-source','audit.json'),exportAudit=receipt('revise-r1-audit-export','audit.json'),
        consumer=receipt('revise-r1-consumer-r2','result.json'),meshValidity=receipt('revise-r1-mesh','audit.json'),
        resourceControls=ref(REV/'resource-tests/resource-controls.json'),localLfs=ref(REV/'local-lfs-final.json'),
        attempts=[ref(history)],images=[],revisionEvidence=ref(out/'REVISION-C2.json'))
    config['commands']=commands
    fresh=sorted((TASK/'receipts/revise-r1-stock/validators').glob('*.json'))
    reused=[p for p in sorted((TASK/'receipts/stock-validate-final/validators').glob('*.json')) if 'ixari_anchor.' not in p.name and 'ixari_props.' not in p.name]
    assert len(fresh)==4 and len(reused)==12
    bindings={read(p)['file']:baseline['files'][read(p)['file']]['sha256'] for p in reused}
    config['stock']=[dict(reports=[ref(p) for p in fresh],receipt=receipt('revise-r1-stock'),reuseBaseline=False),
                     dict(reports=[ref(p) for p in reused],receipt=receipt('stock-validate-final',inputs=bindings),reuseBaseline=True)]
    for group in ('anchor','props','civic','kit','landmarks','low','mid','tall'):
        for kind in ('source','materials'):
            suffix='-r2' if (group,kind) in (('anchor','source'),('props','materials')) else ''
            name=f'revision-r1-{kind}-{group}{suffix}' if group in ('anchor','props') else f'{kind}-{group}-final'
            folder=ROOT/'assets/renders/cities/ixari'/name
            config['images'].append(dict(group=group,kind=kind,sheet=ref(folder/'sheet.png'),readout=ref(folder/'readout.json')))
    for group in ('anchor','props','low','landmarks'):
        name=f'revision-r1-export-{group}' if group in ('anchor','props') else f'export-{group}-final'
        folder=ROOT/'assets/renders/cities/ixari'/name
        config['images'].append(dict(group=group,kind='export',sheet=ref(folder/'sheet.png'),readout=ref(folder/'readout.json')))
    write(out/'publication-inputs.json',config)
    print('PREPARED:',len(changed),'changed artifacts,',len(new),'new CPU PNGs; publication is a separate guarded step')


if __name__=='__main__':main()
