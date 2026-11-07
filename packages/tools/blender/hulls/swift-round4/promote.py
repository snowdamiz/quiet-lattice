"""Promote only the stock-validated GLB whose decoded surfaces and markers match the current source."""
import json,hashlib,os,shutil,sys
from pathlib import Path
root=Path(__file__).resolve().parents[5];ev=root/'assets/renders/hulls/swift-round4-current'
export_job,identity_job,audit_job,fit_job=sys.argv[1:]
source=root/'assets/blend/hulls/swift.blend';candidate=ev/export_job/'models/hulls/swift.glb';dest=root/'packages/client/public/models/hulls/swift.glb'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
source_sha=sha(source);new=sha(candidate)
identity=json.loads((ev/identity_job/'identity.json').read_text());audit=json.loads((ev/audit_job/'audit.json').read_text());fit=json.loads((ev/fit_job/'display-fit.json').read_text());pin=json.loads((ev/export_job/'source-pin.json').read_text())
assert identity['status']==audit['status']==fit['status']=='PASS'
assert identity['sourceSha256']==audit['sourceSha256']==fit['sourceSha256']==pin['sha256']==source_sha
assert identity['glbSha256']==new and pin['stockExit']==0
for name in ['hulls__swift.blend.json','hulls__swift.glb.json']:
 assert json.loads((ev/export_job/'validation'/name).read_text())['status']=='PASS'
old=sha(dest);assert old in ['88cf76bb5c50d53c9b83e72875bbd0b114cc41fd1f28158b945c5d35c78943c6',new]
job=Path(os.environ['SWIFT_JOB']);pending=job/'promote-copy.glb';assert not pending.exists();shutil.copyfile(candidate,pending);assert sha(pending)==new;os.replace(pending,dest)
with (job/'promotion.json').open('x') as f:json.dump({'sourceSha256':source_sha,'previousGLBSha256':old,'glbSha256':new,'bytes':dest.stat().st_size,'inputs':[export_job,identity_job,audit_job,fit_job]},f,indent=2)
print('PROMOTED',new,dest.stat().st_size)
