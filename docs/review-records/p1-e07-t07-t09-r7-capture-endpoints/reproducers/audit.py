from pathlib import Path
import subprocess,json,hashlib,sys
s=Path(__file__).parent;r=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521');phase=sys.argv[1]
j=json.loads((r/'docs/review-records/p1-e07-t07-t09-visibility-fix/manifest.json').read_text())
def git(*a,inp=None):return subprocess.check_output(['git','--no-optional-locks',*a],cwd=r,input=inp)
def h(p):
 x=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1024*1024):x.update(b)
 return x.hexdigest()
assert git('rev-parse','HEAD').decode().strip()=='c57896661481836571a80e50ab6bbd657dbffe43'
assert git('rev-parse','HEAD^{tree}').decode().strip()=='8a317228ab2ce9ba8f24234020605019bfb186f3'
assert git('status','--porcelain').decode()==''
paths={};groups={}
for k in ['oldEvidenceSha256','inputPacketSha256','frozenScratchSha256','dependencySha256']:
 for p,expected in j[k].items():
  path=Path(p) if p.startswith('/') else r/p
  actual=h(path);assert actual==expected,(k,p,expected,actual);paths[str(path)]=actual
 groups[k]=len(j[k])
for p,x in j['sourceFiles'].items():
 assert h(r/p)==x['sha256'];assert git('rev-parse','HEAD:'+p).decode().strip()==x['blob'];paths[str(r/p)]=h(r/p)
objects={}
for k in ['reviewedProductFiles','protectedObjects']:
 for p,x in j[k].items():
  expected=x['reviewedObject']
  for ref in [j['baseHead'],'HEAD']:assert git('rev-parse',ref+':'+p).decode().strip()==expected,(p,ref)
  entries=[line.split('\t') for line in git('ls-tree','-r','HEAD','--',p).decode().splitlines()]
  for metadata,file in entries:
   obj=metadata.split()[2];b=(r/file).read_bytes();blob=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
   if blob!=obj:
    pointer=git('cat-file','blob',obj).decode();assert pointer.startswith('version https://git-lfs.github.com/spec/v1\n'),file
    lines=pointer.splitlines();assert len(b)==int(next(x[5:] for x in lines if x.startswith('size ')));assert hashlib.sha256(b).hexdigest()==next(x[11:] for x in lines if x.startswith('oid sha256:')),file
   paths[str(r/file)]=hashlib.sha256(b).hexdigest()
  objects[p]=expected
 groups[k]=len(j[k])
patches=[]
for p in j['integrationPatches']:
 vals=[git('patch-id','--stable',inp=git('show','--pretty=format:',p[key])).decode().split()[0] for key in ['reviewed','integrated']]
 assert vals[0]==vals[1]==p['reviewedPatchId'];patches.append(p)
report=r/'docs/review-records/p1-e07-t07-t09-visibility-fix'
for p in report.rglob('*'):
 if p.is_file():paths[str(p)]=h(p)
assert all(p.startswith('docs/review-records/p1-e07-t07-t09-visibility-fix/') for p in git('diff','--name-only',j['sourceHead'],'HEAD').decode().splitlines())
state={'head':git('rev-parse','HEAD').decode().strip(),'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'status':git('status','--porcelain').decode(),'groups':groups,'objects':objects,'patchPairs':patches,'sha256':paths}
if phase=='after':assert state==json.loads((s/'protected-before.json').read_text())
(s/('protected-'+phase+'.json')).write_text(json.dumps(state,indent=2)+'\n')
print(json.dumps({'phase':phase,'files':len(paths),'groups':groups,'patchPairs':len(patches),'head':state['head'],'tree':state['tree'],'status':state['status']}))
