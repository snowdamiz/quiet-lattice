"""Build a non-circular final integration manifest from fresh evidence."""
import json, hashlib, shutil, subprocess
from pathlib import Path
P=Path(__file__).resolve().parent
R=P.parents[4]
def read(n):return json.loads((P/n).read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def record(p):return dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))
r=read('FINAL-CANDIDATE-RECEIPT.json')
(P/'historical-FINAL-CANDIDATE-RECEIPT.json').write_text(json.dumps({'historical':True,'superseded_by':'FINAL-CANDIDATE-RECEIPT.json','receipt':r},indent=2)+'\n')
d=read('export-evidence/integration-decoded.json');s=read('integration-final-revise-density.json');v=read('export-evidence/integration-final-revise-export/hulls__lark.glb.json')
assert s['summary']['pass'] and d['density']['min_median']>=512
assert v['summary']['fail']==0
assert {'EXT_meshopt_compression','KHR_texture_basisu'}<=set(d['extensions'])
assert all(i['size']['width']==4096 and i['size']['height']==4096 and i['mime']=='image/ktx2' for i in d['images'])
a=read('frame-propagation-applied.json')['after'];lods={k:[x['triangles'] for x in rows] for k,rows in a.items()}
for counts in lods.values():assert 60000<=counts[0]<=150000 and all(x>y for x,y in zip(counts,counts[1:])) and counts[3]<counts[0]*.05
names=[m['name'] for m in d['markers']];assert any(n.startswith('BAY') for n in names) and any(n.startswith('HP') for n in names) and 'Canopy' in names and any(n.startswith('Gear') for n in names)
assert 12<=max(b-a for a,b in zip(d['worldAabb']['min'],d['worldAabb']['max']))<=14
r.update(status='VALIDATED_SOURCE_AND_EXPORT_CANDIDATE_PARENT_REVIEW_REQUIRED',source_commit_anchor='1331891dcaba3e8438c6a62b2b698a1d054c0e79',source=record(R/'assets/blend/hulls/lark.blend'),canonical_export=dict(record(R/'packages/client/public/models/hulls/lark.glb'),installed=True,status='VALIDATED_MATCHING_SOURCE'),source_validation=read('candidate-source-validation.json')['summary'],export_validation=v['summary'],source_density=s['summary'],decoded_density=d['density'],lods=lods,markers=d['markers'],uv_audit=d['uvAudit'],images=d['images'],extensions=d['extensions'])
r['validation_paths']=['candidate-source-validation.json','integration-final-revise-density.json','export-evidence/integration-final-revise-export/hulls__lark.glb.json','export-evidence/integration-decoded.json']
r['source_changes_this_unit']=['No blend edits; exported committed backing repair: LOD0 16 faces previously removed, LOD1/2 two each removed; LOD3 preserved after ray check.']
r['frame_knownfix']={'historical_receipts':['frame-knownfix.json','frame-propagation-applied.json'],'current_lods':lods,'qualification':'CPU source candidate only; no blind/runtime grade'}
r['atlas_contract']={'layout_pixels':4096,'uv_layer':'UVMap','single_uv':True,'force_fit_scale':s['force_fit_scale'],'density_metric':'minimum of 23 LOD0 material-role edge medians, not every edge'}
files=list((P/'previews').glob('*.png'));size=sum(f.stat().st_size for f in files);assert size<=512*1024**2
r['preview_ledger']={'conservative_before':46,'conservative_used':47,'limit':48,'new':1,'bytes':size,'files':[record(f) for f in sorted(files)],'inspection_this_unit':'Final matching CPU overview: openings and thin internal ribs visible; broad dark surfaces remain. Backing repair is a source candidate, not whole visual PASS or frame-exposure grade.'}
r['resource']={n:read(n) for n in ['integration-source-resource.json','integration-export-resource.json','integration-preview-resource.json']}
scratch=P/'integration-scratch';size=sum(f.stat().st_size for f in scratch.rglob('*') if f.is_file());shutil.rmtree(scratch)
r['cleanup']={'deleted':[str(scratch.relative_to(R))],'bytes':size,'scope':'only this integration scratch','free_bytes_after':shutil.disk_usage(P).free}
r['next_capture_inventory']=['Parent independent source review required before any runtime capture','1 conservative CPU preview slot remains; none requested here']
r['pending']=['Whole-shell 15–30% exposure unqualified; dorsal subset is not whole-shell proof','Final wear, glyph readability and frame visibility require independent grade','Parent independent source review before runtime captures','Runtime performance, production body/colliders, flicker, blind round 5 remain open']
r['evidence_hashes']={str((P/n).relative_to(R)):sha(P/n) for n in r['validation_paths']+['frame-propagation-applied.json','integration-source-resource.json','integration-export-resource.json','integration-preview-resource.json','previews/integration-final-overview.png']}
(P/'FINAL-CANDIDATE-RECEIPT.json').write_text(json.dumps(r,indent=2)+'\n')
text='''# Lark final integration candidate

Canonical GLB regenerated from committed source anchor 1331891dcaba3e8438c6a62b2b698a1d054c0e79. Stock source and export checks pass 5/5; independent UVMap and normalized decoded meshopt density exceed 512 px/m by minimum material-role median. See FINAL-CANDIDATE-RECEIPT.json for current hashes, LOD counts, markers, resources and evidence.

One final matching CPU overview inspected (47/48 conservative ledger). Openings and thin ribs are visible, but frame visibility remains a source candidate, not a grade. No whole visual PASS. Whole-shell exposure, wear/glyph appearance, runtime performance, production body/colliders, flicker and blind round 5 remain open. Parent independent source review must precede runtime captures.

Historical receipts, including FINAL-RECEIPT.json and historical-* files, describe earlier source/export states and are not current qualification. No push, PR, merge, runtime capture or service work performed.
'''
(P/'README.md').write_text(text);(P/'FINISH-REMAINING.md').write_text(text)
