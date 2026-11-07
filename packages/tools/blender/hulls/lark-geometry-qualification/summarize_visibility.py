"""Classify recorded first-hit identities only as far as reviewed source evidence permits."""
import argparse
import bisect
from collections import defaultdict
import gzip
import json
from pathlib import Path

ap=argparse.ArgumentParser()
ap.add_argument('--receipts',required=True)
ap.add_argument('--inventory',required=True)
ap.add_argument('--output',required=True)
a=ap.parse_args();root=Path(a.receipts);inventory=json.loads(Path(a.inventory).read_text())
mapping=json.load(gzip.open(root/'body-mapping.json.gz','rt'))
known={p['pid']for p in inventory['plates']}
body={r['exportPrimitive']:{v[0]:(v[1],v[2])for v in r['identities']}for r in mapping['rows']}
scenes=[]
for file in sorted(root.glob('survey-*.json.gz')):
    d=json.load(gzip.open(file,'rt'));primitives=d['target']['primitives'];starts=[p['triangleStart']for p in primitives]
    assert d['asset_sha256']==inventory['binding']['glb_sha256']
    for p in primitives:assert p['topologyHash']==inventory['binding']['decoded_topology'][p['id']]
    runs=[]
    for record,run in zip(d['records'],d['runs']):
        categories=defaultdict(lambda:dict(samples=0,source_area_m2=0.0))
        unknown=defaultdict(set)
        for triangle,count,weight in record['targetFirstHitHistogram']:
            prim=primitives[bisect.bisect_right(starts,triangle)-1];local=triangle-prim['triangleStart']
            source=body.get(prim['id'],{}).get(local)
            if source:
                category='legacy_outer_plate_tag'if source[1] in known else 'other_positive_pid_surface'if source[1]>0 else 'pid0_unknown'
            elif prim['name'].startswith('CanopyGlass'):
                category='source_mapped_glazing'
            else:
                category='unmapped_or_unclassified_geometry'
            categories[category]['samples']+=count;categories[category]['source_area_m2']+=weight
            if category in ('pid0_unknown','unmapped_or_unclassified_geometry','other_positive_pid_surface'):
                unknown[prim['id']].add(local)
        assert sum(v['samples']for v in categories.values())+run['emptySamples']==run['referenceVisibleSamples']
        runs.append(dict(samples=record['samplesPerTriangle'],direction=record['direction'],
                         visible_reference_area_m2=run['referenceVisibleArea_m2'],categories=dict(categories),
                         empty_samples=run['emptySamples'],empty_source_area_m2=run['emptyArea_m2'],
                         unknown_hit_triangles={k:sorted(v)for k,v in unknown.items()},
                         structural_member_hits=None,frame_exposure_status='UNQUALIFIED'))
    scenes.append(dict(scene=d['target']['scene'],runs=runs))
assert len(scenes)==12,'All twelve sampled surveys required'
with gzip.open(a.output,'wt')as f:json.dump(dict(scenes=scenes,scope='Weights refer to sampled visible base-scene surfaces. These are not target surface areas, plate removal percentages or camera projections. Saved source pid/material construction evidence identifies a partial plate subset. No structural hull-member mapping exists; no frame exposure PASS.',semantic_denominator_complete=False),f,separators=(',',':'))
print(json.dumps(dict(scenes=len(scenes),runs=sum(len(s['runs'])for s in scenes),status='UNQUALIFIED')))
