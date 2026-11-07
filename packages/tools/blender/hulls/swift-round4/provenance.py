"""Read-only proof of the exact recovery and unchanged round-3 grader input; no fetch/hydration."""
import hashlib,json,os,re,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[5];job=Path(os.environ['SWIFT_JOB'])
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
commits=['75ea700462c17d63a69b570e2ca710c5eb1e055d','66221bae6da140a9dcee127490a817863c1ed069','d584a1d386a1a5cd76911b314a7f9c5293aa23a3']
common=Path(git('rev-parse','--git-common-dir'));common=(root/common).resolve()
assets={}
for path in ['assets/blend/hulls/swift.blend','packages/client/public/models/hulls/swift.glb']:
 blobs={c:git('rev-parse',c+':'+path) for c in commits};assert len(set(blobs.values()))==1
 pointer=git('show',commits[0]+':'+path);oid=re.search(r'oid sha256:([0-9a-f]{64})',pointer)[1];size=int(re.search(r'size (\d+)',pointer)[1]);obj=common/'lfs/objects'/oid[:2]/oid[2:4]/oid
 assert obj.stat().st_size==size and sha(obj)==oid
 assert git('show','82c3d50ff79a60b9dac38f0bdfbe421381c8dd73:'+path)==pointer
 assets[path]={'blobs':blobs,'originalSha256':oid,'originalBytes':size,'localLFSObject':str(obj),'localLFSHashSizeVerified':True,'recoveryCommitPointerIdentical':True}
packet=Path('/tmp/hull-r3-packets/swift');index=packet/'INDEX.md';rows=[]
for line in index.read_text().splitlines():
 match=re.match(r'\| `([^`]+)` \| [^|]+ \| [^|]+ \| (\d+) \| `([0-9a-f]{64})`',line)
 if not match:continue
 name,size,digest=match.groups();p=Path(name) if name.startswith('/') else packet/name
 assert p.stat().st_size==int(size) and sha(p)==digest
 rows.append({'path':str(p),'bytes':int(size),'sha256':digest})
assert len(rows)==61
verdict=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab/docs/review-records/p1-e12-t02/swift-visual-round3.txt')
assert sha(index)=='5c2e85988bfa37e03a60ab91f3b5de815630680d8d3ef07cc9ba6a795f34fd66'
assert sha(verdict)=='b4a17d43addfd966770c0712e7e255f1a01eabdaf0f958856969db8dc219666e'
result={'status':'PASS','base':'73f51ba436e2a8c4e3828f60439c441db4f7ef38','recoveryCommit':'82c3d50ff79a60b9dac38f0bdfbe421381c8dd73','recoveryTree':git('rev-parse','82c3d50ff79a60b9dac38f0bdfbe421381c8dd73^{tree}'),'assets':assets,'packetIndex':{'path':str(index),'sha256':sha(index)},'grade':{'path':str(verdict),'sha256':sha(verdict),'verdict':'REVISE','round':3,'disposition':'ordinary revision, not fifth-grade waiver'},'packetPayloads':rows,'copiedReferences':0}
(job/'provenance.json').write_text(json.dumps(result,indent=2));print('PASS: identical recovery blobs/local LFS; 61 retained payload hashes; original grade and index unchanged')
