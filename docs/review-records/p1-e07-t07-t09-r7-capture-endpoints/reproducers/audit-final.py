from pathlib import Path
import subprocess,json,hashlib,re
s=Path(__file__).parent;r=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521');base='c57896661481836571a80e50ab6bbd657dbffe43'
allowed=['packages/tools/src/smoke/symbiotic-online.spec.ts','packages/tools/src/smoke/symbiotic-visibility.test.ts']
before=json.loads((s/'protected-before.json').read_text())
def git(*args,inp=None):return subprocess.check_output(['git','--no-optional-locks',*args],cwd=r,input=inp)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1024*1024):h.update(b)
 return h.hexdigest()
assert git('rev-parse','HEAD').decode().strip()==base
assert sorted(git('diff','--name-only',base).decode().splitlines())==allowed
assert git('ls-files','--others','--exclude-standard').decode()==''
protected={}
for path,expected in before['sha256'].items():
 if path in [str(r/p) for p in allowed]:continue
 actual=sha(Path(path));assert actual==expected,path;protected[path]=actual
for p,obj in before['objects'].items():assert git('rev-parse','HEAD:'+p).decode().strip()==obj,p
for p in before['patchPairs']:
 ids=[git('patch-id','--stable',inp=git('show','--pretty=format:',p[k])).decode().split()[0] for k in ['reviewed','integrated']]
 assert ids[0]==ids[1]==p['reviewedPatchId']
review=Path('/private/tmp/symbiotic-source-review-c5789666-gseoebo8');review_hashes={}
seal=json.loads((review/'SEAL.json').read_text());assert sha(review/'SHA256SUMS')==seal['manifestSha256']
for line in (review/'SHA256SUMS').read_text().splitlines():
 h,p=line.split(maxsplit=1);assert sha(review/p)==h,p;review_hashes[p]=h
review_hashes['SHA256SUMS']=sha(review/'SHA256SUMS');review_hashes['SEAL.json']=sha(review/'SEAL.json')
assert sha(s/'review.test.ts')==sha(review/'review.test.ts')
source={p:{'baseBlob':git('rev-parse',base+':'+p).decode().strip(),'sha256':sha(r/p),'blob':git('hash-object','--no-filters',p).decode().strip()} for p in allowed}
prior=json.loads((review/'test-accounting.json').read_text())
for p,h in prior['unchangedTestFiles'].items():assert sha(r/p)==h,p
old=json.loads((review/'focused-cpu.json').read_text());new=json.loads((s/'focused-final.json').read_text())
def identities(j):return {(str(Path(f['name']).relative_to(r)),t['fullName']) for f in j['testResults'] for t in f['assertionResults'] if t['status']=='passed'}
oldids=identities(old);newids=identities(new);assert oldids<=newids
accounting={'fresh':len(newids),'priorFreshIdentitiesRetained':len(oldids),'new':len(newids-oldids),'historicalUnchangedNotRerun':prior['unchangedHistorical'],'catalogTotal':len(newids)+prior['unchangedHistorical'],'unchangedTestFiles':prior['unchangedTestFiles'],'newIdentities':sorted(newids-oldids)}
(s/'test-accounting.json').write_text(json.dumps(accounting,indent=2)+'\n')
state={'baseHead':base,'baseTree':before['tree'],'sourceFiles':source,'protectedFileCount':len(protected),'protectedSha256':protected,'groups':before['groups'],'objects':before['objects'],'patchPairs':before['patchPairs'],'reviewSeal':seal,'r7ReviewSha256':review_hashes,'oldVisibilityReportFiles':len(list((r/'docs/review-records/p1-e07-t07-t09-visibility-fix').rglob('*'))),'conflictResolutions':[]}
(s/'protected-after.json').write_text(json.dumps(state,indent=2)+'\n')
print(json.dumps({'preserved':len(protected),'r7ReviewFiles':len(review_hashes),'patchPairs':5,'objects':len(before['objects']),'changedSource':allowed,'accounting':{k:v for k,v in accounting.items() if k not in ['newIdentities','unchangedTestFiles']}}))
