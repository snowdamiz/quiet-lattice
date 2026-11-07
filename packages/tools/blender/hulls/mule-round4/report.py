"""Seal this Mule delivery's receipts and Appendix C.2 handoff; never overwrite a report."""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

ROOT=Path(__file__).resolve().parents[5]
OUT=ROOT/'assets/renders/hulls/mule-round4-current'
p=argparse.ArgumentParser();p.add_argument('--export',dest='export_attempt',required=True);p.add_argument('--preview',required=True);args=p.parse_args()
def read(path):return json.loads(path.read_text())
def sha(path):return hashlib.file_digest(path.open('rb'),'sha256').hexdigest()
def write(name,data):
    with (OUT/name).open('x') as f:f.write(data if isinstance(data,str) else json.dumps(data,indent=2))
source=ROOT/'assets/blend/hulls/mule.blend';glb=ROOT/'packages/client/public/models/hulls/mule.glb'
export_receipt=read(OUT/args.export_attempt/'receipt.json')
assert export_receipt['status']=='FAIL' and export_receipt['reason']=='wall limit'
assert export_receipt['leader_reaped'] and export_receipt['remaining_group']==[]
assert not (OUT/args.export_attempt/'source-export-identity.json').exists()
assert sha(glb)=='677883bfb17813c8c7127cc41e8d766ba9ded18594fc7416f7a2d267e881eaef'
assert sha(source)=='3851566ad7f54a0105f8296a8f9cca9b3f2519e5c7cf171f2bdbe9b3adcaf376'
for attempt in [args.preview,'audit-source-final-current-b','receipt-budget-a','export-guards-b']:
    assert read(OUT/attempt/'receipt.json')['status']=='PASS',attempt
assert read(OUT/'controller-loss-test.json')['status']=='PASS'
assert read(OUT/'receipt-budget-a/receipt-boundary-tests.json')['status']=='PASS'
assert read(OUT/args.preview/'images.json')['sha256']==sha(source)
checks=read(OUT/args.export_attempt/'validation/hulls__mule.blend.json')
assert checks['status']=='PASS'
receipts=[];tails=[]
for attempt in sorted(p for p in OUT.iterdir() if p.is_dir()):
    if (attempt/'receipt.json').exists():
        r=read(attempt/'receipt.json')
        receipts.append({'attempt':attempt.name,**r})
        failed=r['status']!='PASS'
    elif (attempt/'interruption-recovery.json').exists():
        r=read(attempt/'interruption-recovery.json')
        receipts.append({'attempt':attempt.name,**read(attempt/'started.json'),'status':'FAIL','interruption':r})
        failed=True
    else:continue
    if failed:
        log=attempt/'output.log'
        tails.append(attempt.name+'\n'+('\n'.join(log.read_text(errors='replace').splitlines()[-20:]) if log.exists() else '(no output log)'))
write('commands-and-results.json',receipts)
write('failure-tails.txt','\n\n'.join(tails)+'\n')
audit=read(OUT/'audit-source-final-current-b/source-audit.json')
assets={str(f.relative_to(ROOT)):{'sha256':sha(f),'bytes':f.stat().st_size} for f in [source,glb]}
images=[]
for f in sorted(OUT.rglob('*.png')):
    if 'scratch' in f.relative_to(OUT).parts:continue
    rejected=(f.parent.name=='preview-details-a' and f.stem in ['cockpit_seated','cockpit_top']) or (f.parent.name=='preview-source-final' and f.stem.endswith(('_lod2','_lod3')))
    fixture=f.name.startswith('fixture')
    far_failure=(f.parent.name=='preview-source-final-b' and f.stem.endswith('_lod3')) or f.parent.name=='preview-far-final'
    origin=read(f.parent/'images.json') if (f.parent/'images.json').exists() else {}
    images.append({'path':str(f.relative_to(OUT)),'sha256':sha(f),'bytes':f.stat().st_size,'viewed':not fixture,'input_source_sha256':origin.get('sha256'),'input_source_path':origin.get('source'),'disposition':'guard fixture, not art' if fixture else 'unresolved/rejected far appearance; no promotion or grade' if far_failure else 'rejected camera/collection visibility, preserved' if rejected else 'CPU inspection only, not a visual grade'})
assert len(images)<=48
write('cpu-images-viewed.json',images)
next_gpu={'owner':'parent, serial explicit GPU grant','qualification':'NOT RUN in this lane; export correctness is still blocked before GPU grants; whole-scene performance unqualified, T13 owns diagnosis','variants':['mule','mule_damaged','mule_husked'],'remaining_cpu_gate':'Resolve LOD3 appearance, then produce a matched compressed GLB, stock export validation, complete decoded source/export identity and final GLB CPU previews do not exist. The 90-minute export bound stopped the attempt. Parent must plan a bounded resource strategy; no automatic export retry was launched.','inventory':['noon-lush / night-exotic / open-space each at LOD0 and LOD2','wireframe LOD0 and LOD2','far LOD2 at 100 m and hero 200 m','collider and marker overlay: 3 colliders, 4 bays, 1S+1M hardpoints, canopy, four gear, boarding, cockpit, screens; no husk lights','paired device-identified performance readout and whole-scene attribution by T13','turntable and material closeups for all three states','three liveries: Thalune, Compact, Working','cockpit seated/open top, boarding, grips/rungs, hardpoint joints, canopy fracture origins','shared lineup at 1.85 m reference scale, parent-owned assembly','fresh independent blind visual grade; retained R3 is third grade REVISE, not fifth disposition']}
write('next-gpu-inventory.json',next_gpu)
write('asset-identity.json',{'base':'73f51ba436e2a8c4e3828f60439c441db4f7ef38','recovery_commit':'acf6073aed9780665786fb48dd2b4409a54c6c27','branch':'task/P1-E12-T02-mule-r4','pre_commit_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'assets':assets,'source_export_match':False,'export_state':'unchanged recovered R3; no candidate accepted','final_commit_identity':'Exact final HEAD and tree are supplied in the final handoff; this avoids self-referential commit contents.'})
lines=['TASK: P1.E12.T02 — Mule ROUND4 CPU/source component',
'STATUS: FAILED — authored source and CPU audit are retained, but the bounded export did not finish and LOD3 appearance remains unresolved. No source/export pair, task, visual or performance acceptance is claimed.',
'SUMMARY: Recovered canonical R3 source/export in a separate commit, then authored localized contact wear, impact-origin canopy cracks, finished cockpit fascia/bezels/control legends, and rebuilt lower-LOD panels/structure. The saved editable blend is authoritative; export_saved.py invokes stock validation, baking, existing LOD consumption, KTX2 and meshopt without importing authoring code. A full oriented triangle identity checker is implemented and adversarially tested, but the R4 export never reached it.',
'FILES CHANGED: assets/blend/hulls/mule.blend; packages/client/public/models/hulls/mule.glb (recovery commit only, unchanged R3 export); packages/tools/blender/hulls/mule-round4/; assets/renders/hulls/mule-round4-current/. No other hull, shared artlib/library/families/exporter, runtime Ship/Cockpit/Review, capture/orchestration, service or DB changes.',
'VERIFY: commands-and-results.json records exact commands, exits, source/tool hashes, bounds, current free/RSS admission and peak observed group RSS for every retained attempt. failure-tails.txt retains the last 20 output lines of each failed attempt. Existing PASS artifacts were never overwritten by retries.',
'VERIFY: audit-source-final-current-b proves exact LOD0 geometry/UV/normals/transforms/engine roles and unchanged livery values against the recovered R3 bytes. Every protected LOD1/2 face is compared as a complete oriented multiset including material role, position, UV, normal, connectivity and multiplicity; actual slot-reassignment, lost-face, normal and transform negative controls reject. Canonical LOD3 retains panel IDs and records vertex-to-source distances, but its CPU appearance is unresolved. A separate far candidate passed complete visible-R3-face/UV/role identity after numerical-sliver cleanup, yet failed CPU inspection and was not promoted; it remains under repair-far-d/scratch/. Every LOD has finite coordinates/UV/normals. New R4 meshes and all three repaired far bodies require zero nonunit normals within .001 length tolerance; short, long and nonfinite negative controls reject. Older unchanged objects retain only their explicit baseline allowances. Inherited LOD0 degenerate faces remain unchanged and are disclosed in the audit.',
'VERIFY: '+args.export_attempt+' stock SOURCE validation PASS (5/5, zero warnings). Export attempt FAIL / child exit124 / wall limit after 5400.638 seconds, peak RSS 7,221,232 KiB (~6.89 GiB), owned leader reaped, remaining group empty. Base Hull, Dark and Nacre completed before the next material admissions at 32.23, 56.92 and 78.02 minutes respectively; wall limit arrived during base Accent. No exported GLB, export validation, or source-export identity report exists. New decoded texture budgets remain unmeasured. The source keeps hero LOD0 60–150k, 4 LODs and LOD3 under5%; no geometry reduction was made for whole-scene timing.',
'VERIFY: Actual harmless-child SIGKILL controller regression settles in 9.439 seconds, waits for its owned direct child and observes adopted descendants absent without claiming waitpid for them. SIGTERM/repeated SIGINT/timeout/probe-failure/completed-child wall-image-output tests reject and settle. Exact receipt-boundary tests include serialized metadata and persisted bytes. Tooling review round 4 closed its P1/P2; its nonblocking changed-byte count issue was fixed and tested by invalidating the stale count. The final far follow-up also passed after requiring unit repaired normals and correcting the distance label. These are tooling reviews, not visual grades.',
'VERIFY: '+args.preview+' is CPU Cycles, 16 samples, 1000x760, two threads, CPU denoising, and references the exact authored source SHA; it is not a decoded-GLB preview. All art previews listed as viewed in cpu-images-viewed.json were inspected. Two earlier unusable cockpit camera views and six blank lower-LOD views from a hidden-collection preview bug remain marked rejected. The corrected source preview explicitly enables authoring collections and isolates by object visibility. Three canonical LOD3 views and three alternative far-candidate views remain flagged as unresolved/rejected appearance. The candidate SHA542a35a7a429b4ff2e6d67fa2f4b53f253659bbedd3830acbd07e61fd2f94aa5 was NOT promoted; canonical source stays3851566ad7f54a0105f8296a8f9cca9b3f2519e5c7cf171f2bdbe9b3adcaf376. Fixture PNGs are not art evidence. Final GLB previews, standard engine captures and visual/performance qualification remain absent.',
'DECISIONS: Broad wear versus actual use points -> author packed UV contact masks at rung treads, grips, joints/latches/collars and selected exposed edges -> preserve the passing cultural palette and avoid white streak networks. Canopy cells versus impacts -> two damaged and three husk impact origins with branched radial cracks and interrupted near-impact rings. Cockpit finish -> preserve modeled geometry and add display/control/bezel material distinctions and readable legends. LOD artifacts -> preserve entire overlapping shell and damage-edge components at LOD1/2, simplify only remaining structure with UV-aware normal transfer, remove lower-LOD slivers and use sharp normal bases; retain source LOD0 exactly. LOD1/2 triangle counts intentionally increase to recover surfaces, not to chase unattributed whole-scene GPU timing.',
'DECISIONS: Controller loss -> isolated task-local supervisor owns workload and lock; sole-writer controller pipe EOF triggers bounded group teardown. A transient macOS probe error from a failed test remains preserved with explicit later group-absence hold resolution. export-b interruption killed its controller; the orphan group was terminated and verified absent by recovery, not falsely called waitpid-reaped. export-a/export-b/export-c were not accepted. After export-c reached its finite wall bound, no export retry or larger unbounded workload was launched. All partial bytes remain local under ignored scratch directories, indexed below.',
'OUT OF SCOPE FOUND: T13 owns whole-scene performance attribution. Parent owns serial standard GPU/engine captures, all-three-livery runtime sheets, shared lineup and fresh blind visual grade. The retained R3 REVISE was the third grade, not a fifth-grade disposition. No GPU/Metal/native/browser capture, full smoke, push, PR or merge was run.',
'ARTIFACTS: asset-identity.json; protected-inputs.json; protected-final.json; recovery-provenance.json; source audit; stock source validation and failed-export receipt; unexecuted final-export identity gate; controller-loss-test.json; runner-supervised-b-suite.json; runner-review-v2-suite.json; receipt-boundary-tests.json; tooling reviews; commands-and-results.json; failure-tails.txt; cpu-images-viewed.json; next-gpu-inventory.json; inventory.json. Receipt boundary tests also invalidate a stale byte count under an injected concurrent write while preserving the primary error. Original packet /tmp/hull-r3-packets/mule/INDEX.md was read in place (61 payloads verified); no reference images copied. Verbatim R3 notes at /Users/andreyyurlov/.t3/worktrees/space/t3-909360ab/docs/review-records/p1-e12-t02/mule-visual-round3.txt remain unchanged.',
'', 'Current geometry:']
for v in ['mule','mule_damaged','mule_husked']:
    counts=[audit['lods'][v+'_LOD'+str(n)]['triangles'] for n in range(4)]
    lines.append(v+': '+str(counts)+'; LOD3 '+str(round(100*counts[3]/counts[0],3))+'%')
lines.extend(['','Exact canonical asset bytes:']+[k+' '+json.dumps(v) for k,v in assets.items()])
write('REPORT.txt','\n\n'.join(lines)+'\n')
inventory=[]
for f in sorted(OUT.rglob('*')):
    if f.is_file():inventory.append({'path':str(f.relative_to(OUT)),'bytes':f.stat().st_size,'sha256':sha(f),'retention':'local-only attempt intermediates; selected promotions recorded by asset identity' if 'scratch' in f.relative_to(OUT).parts else 'committed evidence'})
retained=sum(row['bytes'] for row in inventory if row['retention']=='committed evidence')
write('inventory.json',{'excludes':'inventory.json itself','images_including_fixtures':len(images),'retained_evidence_bytes_before_inventory':retained,'files':inventory})
actual=sum(f.stat().st_size for f in OUT.rglob('*') if f.is_file() and 'scratch' not in f.relative_to(OUT).parts)
assert actual<=512*1024**2,actual
print(json.dumps({'assets':assets,'images':len(images),'retained_evidence_bytes':actual,'final_commit_pending':True},indent=2))
