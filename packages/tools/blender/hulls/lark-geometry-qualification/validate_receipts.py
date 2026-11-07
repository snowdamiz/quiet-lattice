"""Cross-check real receipts and byte/topology bindings, independent of execution exit codes."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys

ap=argparse.ArgumentParser();ap.add_argument('--receipts',required=True);ap.add_argument('--inventory',required=True)
a=ap.parse_args();r=Path(a.receipts)
def read(name):
    p=r/name
    if p.exists():return json.loads(p.read_text())
    return json.load(gzip.open(str(p)+'.gz','rt'))
d=read('decoded.json');g=read('glazing-v2.json');s=read('source-glazing-v2.json');c=read('source-comparison-v3.json')
inventory=json.loads(Path(a.inventory).read_text())
assert len(d['totals'])==12 and len(d['objects'])==151 and len(d['excluded'])==5
assert d['sha256']==g['asset_sha256']==c['glb_sha256']==inventory['binding']['glb_sha256']
assert c['source_sha256']==s['source_sha256']==inventory['binding']['source_sha256']
assert len(g['rows'])==len(s['rows'])==len(c['comparisons'])==12
assert all(len(row['loops'])==6 for row in g['rows'])
assert all(x['evaluated_geometry_identical'] for x in s['evaluated_checks'])
assert all(m['boundaryProof']['exactSourceIdentityMatch'] for m in c['mapping']if m['boundaryProof'])
assert all(x['gridTopologyVerified'] for x in c['paneSeats'])
assert all(ring['edgeCycleVerified']for x in c['construction']for ring in x['rings'])
assert len(inventory['plates'])==185 and inventory['denominator_complete']is False and not inventory['structural_members']
sys.path.insert(0,str(Path(__file__).resolve().parent))
from qualification import plate_count
assert plate_count(inventory,inventory['binding'])['status']=='UNQUALIFIED'
count=0;rays=0;ties=0
for variant in ('lark','lark_damaged','lark_husked'):
 for lod in range(4):
    name=f'{variant}_LOD{lod}'
    survey=json.load(gzip.open(r/f'survey-{name}.json.gz','rt'))
    resource=read(f'survey-{name}-resource.json')
    assert resource['exit_code']==0 and resource['termination_reason'] is None
    assert resource['wall_seconds']<600 and resource['sampled_peak_group_rss_bytes']<=2*1024**3
    assert survey['asset_sha256']==d['sha256'] and survey['target']['scene']==name
    assert len(survey['runs'])==len(survey['records'])==9
    assert {x['samplesPerTriangle']for x in survey['runs']}=={3,12,48}
    for p in survey['target']['primitives']:
        assert p['topologyHash']==inventory['binding']['decoded_topology'][p['id']]
    for run,record in zip(survey['runs'],survey['records']):
        assert run['referenceVisibleSamples']==sum(x[1]for x in record['referenceVisibleSampleCounts'])
        assert run['referenceVisibleSamples']==run['emptySamples']+sum(x[1]for x in record['targetFirstHitHistogram'])
        assert abs(run['referenceVisibleArea_m2']-run['emptyArea_m2']-sum(x[2]for x in record['targetFirstHitHistogram']))<1e-7
        assert all(0<=x[0]<survey['target']['triangles']for x in record['targetFirstHitHistogram'])
        assert run['classification']['structural_member']is None
        assert len(run['hitRecordSHA256'])==64
        rays+=run['rays'];ties+=run['targetCoincidentHitTies'];count+=1
for p in r.glob('*.seal.json'):
    seal=json.loads(p.read_text());assert seal['assets_unchanged']and not seal['remaining_blender_processes']
result=dict(status='PASS_RECEIPT_CONSISTENCY_ONLY',scenes=12,render_primitives=151,survey_runs=count,reference_rays=rays,target_coincident_hit_ties=ties,semantic_status='UNQUALIFIED',clearance_status='UNQUALIFIED',visual_runtime_performance='NOT_QUALIFIED')
(r/'receipt-validation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
