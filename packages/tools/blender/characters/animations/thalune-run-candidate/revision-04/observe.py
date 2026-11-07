import datetime,hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');sys.path.insert(0,str(A));sys.dont_write_bytecode=True
import resource_admission as resources
plan=json.loads((A/'native189-plan.json').read_text());root=A.parents[5]
rows=[]
for argv in [['/bin/ps','-axo','pid=,ppid=,uid=,lstart=,command='],['/usr/sbin/lsof','-nP','-a','-u',str(os.getuid()),'-d','cwd','-Fpcn'],['/bin/df','-k','/System/Volumes/Data']]:
    p=subprocess.run(argv,capture_output=True,text=True,timeout=15,cwd='/private/tmp')
    rows.append(dict(argv=argv,exitCode=p.returncode,stdout=p.stdout,stderr=p.stderr))
cache=[]
for path in plan['viteCachePaths']:
    item=dict(path=path,tree=resources.tree(path))
    if Path(path).is_dir():
        argv=['/usr/sbin/lsof','-nP','+D',path,'-Fpcn'];p=subprocess.run(argv,capture_output=True,text=True,timeout=15,cwd='/private/tmp')
        item['openFiles']=dict(argv=argv,exitCode=p.returncode,stdout=p.stdout,stderr=p.stderr)
    else:item['openFiles']=dict(status='Path absent; no directory allocated')
    cache.append(item)
prospective=[plan[k] for k in ['runRoot','grantPath','consumedPath','cancelPath','cacheLeasePath']]+plan['storage']['copySlots'][1:]+[str(A/p) for p in ['future-attempt','grant.json','consumed-attempt.json']]
free=shutil.disk_usage('/private/tmp').free
report=dict(observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),admission=False,qualification='Read-only current observations. ps lstart is not exact libproc birth identity; current cwd owners are unresolved, not admitted. No cache ownership or GPU permission claimed.',freeBytes=free,combinedReserve=resources.COMBINED_RESERVE,marginBytes=free-resources.COMBINED_RESERVE,caches=cache,commands=rows,prospective=[dict(path=p,exists=Path(p).exists(),symlink=Path(p).is_symlink()) for p in prospective])
assert all(not p['exists'] and not p['symlink'] for p in report['prospective'])
with (A/'revision-04/current-resources.json').open('x') as f:json.dump(report,f,indent=2)
print(json.dumps(dict(freeBytes=free,marginBytes=free-resources.COMBINED_RESERVE,prospectiveAbsent=len(prospective),admission=False)))
