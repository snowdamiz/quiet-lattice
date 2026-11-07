"""Archive the bounded lane evidence and emit the Appendix C.2 handoff without changing source/export."""
import ast,hashlib,json,os,shlex,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[5];ev=root/'assets/renders/hulls/swift-round4-current';job=Path(os.environ['SWIFT_JOB'])
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
# The continuing cleanup hold takes precedence: retain interrupted renderer
# scratch byte-for-byte, document it, and never remove images during finalization.
retained_scratch=[]
for attempt in sorted(p for p in ev.iterdir() if p.is_dir() and p!=job):
 proof=next((attempt/name for name in ['receipt.json','interruption.json','guardian.json'] if (attempt/name).exists()),None)
 assert proof is not None,str(attempt)
 r=json.loads(proof.read_text());assert r['childGroupEmpty'],str(proof)
 scratch=attempt/'scratch'
 for p in sorted(scratch.rglob('*')) if scratch.exists() else []:
  if p.is_file() and p.suffix=='.exr' and p.name.startswith('cycles-tile-buffer-'):
   retained_scratch.append({'path':str(p.relative_to(root)),'sha256':sha(p),'bytes':p.stat().st_size,'reason':'interrupted Cycles internal tile buffer; retained under explicit cleanup hold, not a final preview'})
(job/'retained-scratch.json').write_text(json.dumps(retained_scratch,indent=2))
for p in (root/'packages/tools/blender/hulls/swift-round4').glob('*.py'):ast.parse(p.read_text(),filename=str(p))
subprocess.run(['git','diff','--check'],cwd=root,check=True)
assert len(list(ev.rglob('*.exr')))==len(retained_scratch),'unexpected raw render frame; only documented interrupted scratch is allowed'
files=[]
paths=[root/'assets/blend/hulls/swift.blend',root/'packages/client/public/models/hulls/swift.glb']+sorted(p for p in (root/'packages/tools/blender/hulls/swift-round4').iterdir() if p.is_file())+sorted(p for p in ev.rglob('*') if p.is_file() and job not in p.parents)
for p in paths:files.append({'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':sha(p)})
images=[x for x in files if Path(x['path']).suffix.lower() in ['.png','.jpg','.jpeg','.webp']]
scene_images=[x for x in images if 'scratch' not in Path(x['path']).parts]
assert len(images)<=48 and sum(x['bytes'] for x in images)<=512*1024**2
assert len(images)+len(retained_scratch)<=48 and sum(x['bytes'] for x in images+retained_scratch)<=512*1024**2
inventory={'files':files,'CPUImageCount':len(images),'CPUImageBytes':sum(x['bytes'] for x in images),'sceneImageCount':len(scene_images),'textureProbeImages':len(images)-len(scene_images),'interruptedRendererScratch':retained_scratch,'combinedImageAndScratchBytes':sum(x['bytes'] for x in images+retained_scratch),'imageBudgetCountsAllPNGConservatively':True,'copiedReferenceImages':0,'excludes':'this finalizer attempt (self-reference); its immutable receipt is adjacent'}
(job/'inventory.json').write_text(json.dumps(inventory,indent=2))
inputs=json.loads((Path(__file__).with_name('handoff.json')).read_text())
lines=['TASK: P1.E12.T02/swift ROUND4 CPU/source revision',
 'STATUS: '+inputs['status']+' (bounded Swift CPU/source scope only; whole P1.E12.T02 and performance not declared PASS)',
 'SUMMARY: '+inputs['summary'],
 'Original task: P1.E12.T02(art) Lark, Swift, Kestrel, Mule · deps: E14.T02 · done: four hulls with gear, canopy, cockpit interior, hardpoint mounts, damage state, husked variant, three liveries each; Lark rebuilds today\'s ship at new bar · verify: validate; review.',
 'Checkout: '+str(root),'Branch: '+git('branch','--show-current'),
 'Base: 73f51ba436e2a8c4e3828f60439c441db4f7ef38',
 'Separate recovery commit: 82c3d50ff79a60b9dac38f0bdfbe421381c8dd73; tree ea744377e186a0ee48bdf40b48e891b1d7db78a2',
 'Final revision HEAD and tree are supplied in the accompanying final handoff after committing this report; self-referential commit hashes cannot be embedded in their own committed content.',
 'FILES CHANGED:',*['  '+x['path'] for x in files],
 '  '+str(job.relative_to(root))+'/{REPORT.txt,inventory.json,retained-scratch.json,receipt.json,process.log}',
 'VERIFY:',
 '  Lane environment: OMP_NUM_THREADS=OPENBLAS_NUM_THREADS=MKL_NUM_THREADS=VECLIB_MAXIMUM_THREADS=NUMEXPR_NUM_THREADS=BLENDER_THREADS=ART_KTX_THREADS=2; ART_KTX_JOBS=1; PYTHONDONTWRITEBYTECODE=1; each job has its own SWIFT_JOB and TMPDIR. Factory Blender -t 2, CPU only.']
for p in sorted(ev.glob('*/receipt.json')):
 r=json.loads(p.read_text());lines.extend(['  Attempt '+p.parent.name,'  Command: '+shlex.join(r['command']),f"  Exit {r['exit']}; reason {r['reason']}; wall {r['seconds']} s; peak group RSS {r['peakRssKiB']} KiB; child group empty {r['childGroupEmpty']}",f"  Preflight free+inactive {r['preflight']['memoryFreeInactive']} bytes; disk free {r['preflight']['diskFree']} bytes; process RSS total {r['preflight']['allRssKiB']} KiB."])
 if r['exit']:
  log=p.parent/'process.log';tail=log.read_text(errors='replace').splitlines()[-20:] if log.exists() else ['No child log created.']
  lines.append('  Last 20 failure/cancellation log lines:');lines.extend('    '+x for x in tail)
  for validation in sorted((p.parent/'validation').glob('*.json')):
   check_report=json.loads(validation.read_text())
   if check_report.get('status')=='FAIL':
    lines.append('  Stock validation failures from '+str(validation.relative_to(root))+':')
    for check in check_report.get('checks',[]):
     for finding in check.get('findings',[]):
      if finding.get('level')=='fail':lines.append('    '+finding.get('subject','')+': '+finding['message'])

lines.extend(['  27-stock-export-bounded interrupted command: /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --factory-startup --python-exit-code 1 -P packages/tools/blender/hulls/swift-round4/export_saved.py (lane wall 3000s; RSS 10000MiB)', '  Last 20 interrupted bake log lines:'])
lines.extend('    '+x for x in (ev/'27-stock-export-bounded/process.log').read_text(errors='replace').splitlines()[-20:])
lines+=['  27-stock-export-bounded: interrupted by user/harness; runner exit unavailable; guardian absent in that version; Blender group 3668 was manually SIGTERM terminated and verified empty. See interruption.json; no GLB promotion.',
 '  28-runner-loss-proof: python3 packages/tools/blender/hulls/swift-round4/check_guardian.py exited 0; deliberate runner SIGKILL exit -9; independent guardian terminated the ignoring command and observed empty group.',
 '  29-cancellation-guardian-proof: python3 packages/tools/blender/hulls/swift-round4/check_lane.py 29-cancellation-guardian-proof exited 0; repeated SIGINT/SIGTERM cleanup and competing-owner rejection passed.',
 '  35-runner-loss-short-path-proof: python3 packages/tools/blender/hulls/swift-round4/check_guardian.py 35-runner-loss-short-path-proof exited 0; runner deliberately killed, guardian terminated the group and removed only its owned short TMPDIR alias.',
 '  git diff --check: exit 0','  All scoped Python files parsed with ast.parse: exit 0',
 '  Detailed numeric audits and SHA pins: see inventory.json and each immutable attempt JSON.',
 '  Final verification summary: '+json.dumps(inputs.get('verificationSummary',{})),
 '  Heavy CPU lane completion: '+json.dumps(inputs.get('resourceCompletion',{})),
 'DECISIONS:',*['  '+x for x in inputs['decisions']],
 'OUT OF SCOPE FOUND:',*['  '+x for x in inputs['outOfScope']],
 'ARTIFACTS:',f"  {len(images)} retained PNGs ({len(scene_images)} compact CPU scene images plus {len(images)-len(scene_images)} texture probes); {inventory['CPUImageBytes']} bytes. No copied references. {len(retained_scratch)} old interrupted Cycles EXR tile buffers remain under the later explicit cleanup hold; see retained-scratch.json. Combined image/scratch bytes: {inventory['combinedImageAndScratchBytes']}, still within 48 files / 512 MiB. No cleanup performed.",
 '  Final source: '+json.dumps(files[0]),'  Final GLB: '+json.dumps(files[1]),
 '  CPU images actually viewed:',*['    '+x for x in inputs['viewedCurrent']],
 '  Implementation CPU observations (not an independent grade):',*['    '+x for x in inputs.get('CPUObservations',[])],
 '  Retained R3 images read in place:',*['    '+str((Path('/tmp/hull-r3-packets/swift')/x).resolve()) for x in inputs['viewedR3']],
 '  Failed/pre-refinement artifacts remain immutable. A directory name containing green/final is not an acceptance claim; consult its JSON status and source hash.',
 'NEXT GPU INVENTORY / REMAINING GATES:',*['  '+x for x in inputs['remaining']],
 '  No GPU/Metal discovery or rendering, browser/native capture, service/database/grants, push, PR, or merge was performed.']
(job/'REPORT.txt').write_text('\n'.join(lines)+'\n')
print(json.dumps({'status':'PASS','inventoryFiles':len(files),'CPUImages':len(images),'CPUImageBytes':inventory['CPUImageBytes'],'retainedInterruptedScratch':len(retained_scratch),'report':str(job/'REPORT.txt')}))
