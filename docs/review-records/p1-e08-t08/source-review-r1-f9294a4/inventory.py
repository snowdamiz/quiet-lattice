import os,sys,json,hashlib,subprocess
from pathlib import Path
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13'); S=Path(__file__).resolve().parent
B='5731dc4c92954dd995c4a8ed5975bdbd2f7fdb45'
def git(*a): return subprocess.check_output(['git',*a],cwd=R).decode().strip()
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
manifest=json.loads((R/'packages/tools/blender/e08t08/reports/asset-hash-inventory.json').read_text())
changed=git('diff','--name-only',B,'HEAD').splitlines()
assert all(p.startswith(('assets/blend/creatures/','assets/blend/constructs/','assets/renders/creatures/e08t08/','assets/renders/constructs/e08t08/','packages/client/public/models/creatures/','packages/client/public/models/constructs/','packages/tools/blender/e08t08/')) for p in changed)
files={p:dict(bytes=(R/p).stat().st_size,sha256=sha(R/p)) for p in changed}
for a in manifest['assets']:assert files[a['path']]['sha256']==a['sha256'],a
for p,h in manifest['protectedUnchanged'].items():assert sha(R/p)==h,p
protected=[p for p in git('ls-files').splitlines() if p.startswith(('packages/tools/blender/artlib/','packages/server/src/fauna/','packages/server/src/abilities/','packages/tools/src/art/','packages/client/src/dev/review.js','packages/tools/src/capture/','blender/build_creatures.py','packages/client/src/gameplay/Fauna.js','packages/client/src/gameplay/modelLibrary.js','packages/client/src/Game.js','packages/tools/blender/export_','packages/tools/blender/families.json','packages/tools/blender/validate.py')) or p in manifest['protectedUnchanged']]
protected={p:sha(R/p) for p in protected}
trees={p:{ref:git('rev-parse',ref+':'+p) for ref in [B,'HEAD']} for p in ['assets/blend/characters','assets/blend/bosses','assets/blend/props','assets/blend/sites','assets/blend/cities','assets/blend/hulls','assets/blend/flora','assets/blend/stations','packages/client/public/models','packages/server','packages/shared','packages/tools/blender/artlib','packages/client/src']}
deps={}
for rel in ['node_modules','packages/client/node_modules','packages/tools/node_modules']:
 root=(R/rel).resolve(); rows=[]
 for d,ds,fs in os.walk(root,followlinks=False):
  for n in sorted(ds+fs):
   p=Path(d)/n; st=p.lstat(); rows.append([str(p.relative_to(root)),st.st_mode,st.st_size,st.st_mtime_ns,st.st_ctime_ns,os.readlink(p) if p.is_symlink() else None])
 rows.sort(); deps[rel]={'target':str(root),'entries':len(rows),'metadataSHA256':hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest()}
result={'head':git('rev-parse','HEAD'),'tree':git('rev-parse','HEAD^{tree}'),'base':B,'branch':git('branch','--show-current'),'status':git('status','--porcelain=v1'),'assets':manifest['assets'],'changedFiles':files,'protectedSHA256':protected,'protectedTrees':trees,'dependencyMetadata':deps,'pngs':[p for p in files if p.endswith('.png')]}
name=sys.argv[1]; (S/(name+'.json')).write_text(json.dumps(result,indent=2)+'\n')
if name=='after':
 before=json.loads((S/'before.json').read_text()); assert result==before,'STATE CHANGED'
print(json.dumps({'snapshot':name,'head':result['head'],'tree':result['tree'],'changed':len(files),'protectedHashes':len(protected),'pngs':len(result['pngs']),'assetPins':'PASS','dependencyMetadata':deps,'status':result['status']}))
