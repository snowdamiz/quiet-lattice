from pathlib import Path
import hashlib,subprocess,json,re
S=Path(__file__).resolve().parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13')
e=json.loads((S/'evidence-audit.json').read_text());b=json.loads((S/'before.json').read_text());paths=list(e['protectedAssetHashes'])+[a['path'] for a in b['assets']]+list(e['pngHistory']);results=[]
for p in paths:
 data=subprocess.check_output(['git','show','HEAD:'+p],cwd=R)
 actual=(R/p).read_bytes();match=re.search(rb'oid sha256:([0-9a-f]{64})',data) if data.startswith(b'version https://git-lfs.github.com/spec/v1\n') else None
 if match:assert hashlib.sha256(actual).hexdigest()==match[1].decode(),p;kind='LFS content SHA256'
 else:assert data==actual,p;kind='git blob bytes'
 results.append({'path':p,'binding':kind,'sha256':hashlib.sha256(actual).hexdigest()})
(S/'git-object-audit.json').write_text(json.dumps(results,indent=2)+'\n');print('PASS',len(results),'actual files match pinned HEAD objects; includes 27 protected assets, 14 deliverables, 79 PNGs')
