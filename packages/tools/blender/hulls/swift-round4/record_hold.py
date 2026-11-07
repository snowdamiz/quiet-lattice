"""Light-only checkpoint after the current bounded stage has naturally exited."""
import json, os, subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[5]
evidence = root / 'assets/renders/hulls/swift-round4-current'
job = Path(os.environ['SWIFT_JOB'])
last = json.loads((evidence / '72-current-rear-lod0/receipt.json').read_text())
guardian = json.loads((evidence / '72-current-rear-lod0/guardian.json').read_text())
rows = [line.split(None,4) for line in subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,stat=,command='],text=True).splitlines()]
remaining = [r for r in rows if int(r[0]) in [last['pid'],last['guardianPid']] or int(r[2])==last['pid']]
assert not remaining and last['exit']==0 and last['childGroupEmpty'] and guardian['childGroupEmpty']
state = {
    'state':'HEAVY_ADMISSIONS_HELD',
    'reason':'Parent T13 controlled native trace comparison; explicit parent release required. No timer-based automatic resumption.',
    'lastStage':'72-current-rear-lod0',
    'commandPID':last['pid'],'commandPGID':last['pid'],'guardianPID':last['guardianPid'],
    'exit':last['exit'],'seconds':last['seconds'],'childGroupEmpty':True,'liveMembers':remaining,
    'sourceSha256':'7627b0c32db665890273a93ed251321aec12dff03a1f0f7f0bd59c9005be1480',
    'validatedCandidate':'70-corrected-stock-validation/models/hulls/swift.glb',
    'candidateSha256':'5873c5caa4cb3be67e6715462fdeae0c112d32544ee202e08f5190c7761d4a3d',
    'sourceAudit':'66-final-source-world-audit/audit.json','displayFit':'67-final-display-fit/display-fit.json',
    'stockValidation':'70-corrected-stock-validation/validation','sourceExportIdentity':'71-corrected-source-export-identity/identity.json',
    'canonicalGLB':'Still recovered R3; candidate not promoted',
    'head':'82c3d50ff79a60b9dac38f0bdfbe421381c8dd73',
    'remaining':['Current-candidate LOD2 rear pair, LOD0/2 gear, cockpit pilot/top, damaged close-up, compact/working livery CPU views and variant/material sheets','Inspect those images, promote the matching validated candidate, finalize Appendix C.2 and commit','Parent engine captures, full smoke, T13 performance qualification, fresh blind grade and review'],
    'screenshotCleanup':'STOPPED; no images removed',
    'resume':'After explicit parent release, archive/remove only the tool HEAVY_HOLD.json sentinel, retain this immutable checkpoint, verify no owned processes and fresh capacity, continue from saved source and candidate; do not rerun recovery or authoring.'
}
for path in [job/'hold.json',Path(__file__).with_name('HEAVY_HOLD.json')]:
    with path.open('x') as f:json.dump(state,f,indent=2)
handoff=Path(__file__).with_name('handoff.json');h=json.loads(handoff.read_text())
h['status']='BLOCKED'
h['summary']='Parent resource hold on new heavy admissions after stage72 exited normally. Authoritative Swift source and matching candidate pass refreshed source/world audit, display fit, stock source/export validation and decoded identity. Final CPU image inspection, canonical GLB promotion and clean revision commit remain pending parent release. Canonical GLB is still recovered R3; no source recovery or authoring should be restarted.'
h['resourceHold']=state
h['viewedCurrent'].append('72-current-rear-lod0/swift-rear-lod0.png (current corrected-source decoded GLB, CPU; viewed before resource hold)')
handoff.write_text(json.dumps(h,indent=2)+'\n')
print(json.dumps({'state':state['state'],'lastStage':state['lastStage'],'commandPID':last['pid'],'guardianPID':last['guardianPid'],'liveMembers':remaining,'sourceSha256':state['sourceSha256'],'candidateSha256':state['candidateSha256']}))
