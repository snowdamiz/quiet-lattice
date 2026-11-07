import os,sys,json,hashlib,subprocess,stat,time
from pathlib import Path
S=Path(__file__).resolve().parent
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13'); T=R/'packages/tools/blender/e08t08'; O=Path('/tmp/space-e08t08-independent-c2-iimrHP')
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1024*1024): h.update(b)
 return h.hexdigest()
def scan(root, hashes=False):
 rows={}
 for d,dirs,files in os.walk(root,followlinks=False):
  for n in sorted(dirs+files):
   p=Path(d)/n; z=p.lstat(); row=[z.st_mode,z.st_size,z.st_mtime_ns,z.st_ctime_ns,os.readlink(p) if p.is_symlink() else None]
   if hashes and stat.S_ISREG(z.st_mode):row.append(sha(p))
   rows[str(p.relative_to(root))]=row
 return rows
def git(*a):return subprocess.check_output(['git',*a],cwd=R,env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'},text=True)
def run():
 old=json.loads((O/'after.json').read_text()); before=json.loads((T/'revisions/f2-20261107-r1/preservation-before.json').read_text())
 assets=old['assets']; pngs=old['pngs']; pins={a['path']:a['sha256'] for a in assets}
 if isinstance(pngs,dict): pins.update(pngs)
 else:pins.update({a['path']:a['sha256'] for a in pngs})
 pins.update(old['protectedSHA256'])
 for p,h in pins.items(): assert sha(R/p)==h,p
 for p,h in before['reviewOriginals'].items():assert sha(O/p)==h,p
 deps={}
 for rel,expected in old['dependencyMetadata'].items():
  root=(R/rel).resolve(); rows=[[p,*v] for p,v in sorted(scan(root).items())]
  deps[rel]=dict(target=str(root),entries=len(rows),metadataSHA256=hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest())
  assert deps[rel]==expected,(rel,deps[rel],expected)
 snapshot=dict(head=git('rev-parse','HEAD').strip(),tree=git('rev-parse','HEAD^{tree}').strip(),base=git('rev-parse','f9294a466d6223f695f102dc1a13ed526f155e67^{tree}').strip(),branch=git('branch','--show-current').strip(),status=git('status','--porcelain=v1','--untracked-files=all'),repoMetadata=scan(R),taskHashes=scan(T,True),reviewOriginals=scan(O,True),dependencyMetadata=deps,pins=pins,python=str(Path(sys.executable).resolve()),pythonSHA256=sha(Path(sys.executable).resolve()))
 assert snapshot['head']=='ccdcb1b6079c4f6d6a64506e889f4a6e170464ba' and snapshot['tree']=='6cd252ce39721ba4355942ab967fe8148d562bc0'
 assert snapshot['base']=='5cea052761a4c037d28c2d09bd7d731885f09fda' and not snapshot['status']
 if sys.argv[1]=='after':
  earlier=json.loads((S/'before.json').read_text()); changes=[k for k,v in snapshot.items() if earlier[k]!=v]
  assert not changes,changes
 with (S/(sys.argv[1]+'.json')).open('x') as f:json.dump(snapshot,f,sort_keys=True,indent=2);f.write('\n')
 print(json.dumps(dict(status='preserved',head=snapshot['head'],tree=snapshot['tree'],assets=len(assets),pngs=len(pngs),repoEntries=len(snapshot['repoMetadata']),taskEntries=len(snapshot['taskHashes']),reviewOriginals=len(before['reviewOriginals']),dependencies=deps)))
if __name__=='__main__':run()
