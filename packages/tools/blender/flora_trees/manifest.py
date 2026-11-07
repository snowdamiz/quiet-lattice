"""Bind the candidate to current bytes and the successful receipts that inspected them."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[4]
META=ROOT/'assets/blend/flora/trees'
EVIDENCE=META/'evidence'
COUNTS={'round':3,'conifer':3,'palm':2,'mushroom':3,'spiral':2,'coral':2,'blob':2,'cactus':2}


def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def relative(p): return str(p.relative_to(ROOT))


def latest(action,kind):
    candidates=sorted(EVIDENCE.glob(f'*_{action}_{kind}_*/receipt.json'))
    assert candidates,(action,kind)
    p=candidates[-1]; receipt=json.loads(p.read_text())
    assert receipt['exit']==0 and not receipt['remaining_owned_children'],p
    return p.parent,receipt


def main():
    bundles=[]; inventory=[]; native=[]
    for kind,count in COUNTS.items():
        src=ROOT/'assets/blend/flora'/f'tree_{kind}_t04.blend'
        glb=ROOT/'packages/client/public/models/flora'/f'tree_{kind}_t04.glb'
        ad,ar=latest('audit',kind); audit=json.loads((ad/'audit.json').read_text())
        vd,vr=latest('validate',kind)
        ed,er=latest('export',kind)
        source_report=vd/'reports'/f'flora__{src.name}.json'
        export_report=vd/'reports'/f'flora__{glb.name}.json'
        for report in (source_report,export_report): assert json.loads(report.read_text())['status']=='PASS'
        assert sha(src)==audit['source_sha256']==er['source_before']==er['source_after']==vr['source_before']==vr['source_after']
        assert sha(glb)==audit['export_sha256']==er['export_sha256']==vr['export_sha256']
        prefix='cactus' if kind=='cactus' else 'tree_'+kind
        names=[f'{prefix}_{v}' for v in range(count)]
        expected={name+(f'_lod{lod}' if lod else '') for name in names for lod in range(4)}
        assert set(audit['source_meshes'])==expected
        bundles.append({'kind':kind,'source':relative(src),'source_sha256':sha(src),'source_bytes':src.stat().st_size,
                        'export':relative(glb),'export_sha256':sha(glb),'export_bytes':glb.stat().st_size,
                        'stock_source_report':relative(source_report),'stock_export_report':relative(export_report),
                        'export_receipt':relative(ed/'receipt.json'),'audit':relative(ad/'audit.json'),
                        'source_unchanged_across_export':True,'stock_status':'PASS','payload_status':'FLOAT position, normals, UV and RGBA masks; Meshopt; KTX2 full mips; exact source position/mask cloud verified by consumer tests'})
        for v,name in enumerate(names):
            variant=f'{prefix}_form_{v}'
            meshes=[name+(f'_lod{lod}' if lod else '') for lod in range(4)]
            counts=[audit['source_meshes'][n]['triangles'] for n in meshes]
            inventory.append({'consumer':name,'asset':prefix,'variant':variant,'class':'flora' if kind=='cactus' else 'flora_tree',
                              'mesh_names':meshes,'lod_triangles':counts,'lod3_fraction':counts[3]/counts[0],
                              'bounds_yup':audit['source_meshes'][name]['bounds_yup']})
            native.append({'consumer':name,'file':f'flora/tree_{kind}_t04','asset':prefix,'variant':variant,
                           'command':['pnpm','capture','--','--review',f'flora/tree_{kind}_t04','--asset',prefix,'--variant',variant],
                           'required_images':[f'{light}_lod{lod}.png' for light in ('noon-lush','night-exotic','open-space') for lod in (0,2)]+['wireframe_lod0.png','wireframe_lod2.png','overlay.png','far_lod2.png','sheet.png'],
                           'required_data':['perf.json'],'perf_pairs_per_light':120,'native_status':'NOT RUN'})
    assert len(inventory)==19 and sum(len(x['mesh_names']) for x in inventory)==76
    packet=sorted(EVIDENCE.glob('*_packet_*/preview-manifest.json'))[-1]
    result={'task':'P1.E14.T04','status':'CPU_CANDIDATE_ONLY_NATIVE_GATES_PENDING',
            'base':'55a8d58c27db35782b89142fc8a4f8d25f52f379','reviewed_shared_pin':'515ba1f00810a50b499970b5468ef7bf0af84c32',
            'integrated_pin_commit':'60aa8bfb5a771e14944b6a130c96cd9a2cb83228','workspace':str(ROOT),
            'branch':subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),
            'bundles':bundles,'inventory':inventory,'preview_manifest':relative(packet),'preview_manifest_sha256':sha(packet),
            'native_capture_inventory':native,
            'parent_capture_budget':{'native_pngs':209,'standard_turntable_pngs':38,'standard_sibling_pngs':8,'total_new_pngs':255,
                'perf_jsons':19,'perf_pairs':6840,'minimum_paired_frames':13680,'native_viewport':[1920,1080],
                'suggested_max_output_bytes':1073741824,'suggested_variant_deadline_s':300,'gpu_lanes':1,
                'notes':'Proposed parent admission ceiling, not permission or measured GPU timing. Keep at least12GiB free. No video/raw-frame directory. Parent must authorize native GPU/browser lane. Standard turntable.py forces Metal on this host; it was not run.'},
            'unrun_gates':['standard native review captures','standard eight-angle and material sheets','blind independent visual grading','independent code/source review of this candidate','native smoke/performance','live T07 adoption']}
    with (META/'candidate.json').open('x') as f: json.dump(result,f,indent=2); f.write('\n')
    print('Bound',len(bundles),'source/export pairs;',len(inventory),'variants;',sum(len(x['mesh_names']) for x in inventory),'LOD meshes')


if __name__=='__main__': main()
