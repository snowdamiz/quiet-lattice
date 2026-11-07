import hashlib,json,subprocess
from pathlib import Path
root=Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41');out=Path('/tmp/characters-whole-review2-sol-20261102');v=root/'assets/renders/characters/validate'
names=['ulgani-review5-code-review-scope.json','ulgani-review5-inventory.json','ulgani-review5-grader-packet.json','thalune-review5-inventory.json','ixari-review5-inventory.json','shared-rig-contract/REPORT.json','shared-rig-contract/review-preservation.json']
paths={};bindings=[];fail=[]
def walk(obj,label):
 if isinstance(obj,dict):
  if 'sha256' in obj:
   key='retained_copy' if 'retained_copy' in obj else 'path' if 'path' in obj else None
   if key:
    path=Path(obj[key]);path=path if path.is_absolute() else (root/'.claude/pause/characters-resume/shared-rig-contract/independent-review'/path if label.startswith('shared-rig-contract/review-preservation.json') else root/path)
    expect=obj['sha256'];digest=hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    bindings.append({'from':label,'path':str(path),'expected':expect,'actual':digest});paths[str(path)]=digest
    if digest!=expect:fail.append(bindings[-1])
  for key,value in obj.items():walk(value,label+'.'+key)
 elif isinstance(obj,list):
  for i,value in enumerate(obj):walk(value,f'{label}[{i}]')
for name in names:
 path=v/name;data=json.loads(path.read_text());walk(data,name)
 if name=='ulgani-review5-grader-packet.json':
  actual=hashlib.sha256(path.read_bytes()).hexdigest();assert actual=='80ad60aa81e0700f1bdd1423073ba833dd267dbf68d69a2f98c09bed39efd40e'
  print('Ulgani frozen packet PASS179required+32supporting',actual)
changed=subprocess.check_output(['git','diff','--name-only','00eed30402686fd717d8dd84d09e409dfd093ec9..HEAD'],cwd=root,text=True).splitlines()
result={'binding_count':len(bindings),'unique_paths':len(paths),'failures':fail,'bindings':bindings,'full_diff_path_count':len(changed)}
(out/'bindings.json').write_text(json.dumps(result,indent=2)+'\n');(out/'preservation-start.json').write_text(json.dumps(paths,indent=2)+'\n');(out/'whole-diff-paths.txt').write_text('\n'.join(changed)+'\n')
assert not fail,[(f['from'],f['path']) for f in fail]
print('BINDINGS_PASS',len(bindings),'checks',len(paths),'paths;whole diff',len(changed))
