from pathlib import Path
import os,json,hashlib,subprocess,stat
O=Path(__file__).resolve().parent
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406')
A=R/'packages/tools/blender/characters/animations/thalune-run-candidate'
D=A/'revision-10'
P=Path('/private/tmp/t02-native189-activation-independent-cd74hzde')
P5=Path('/private/tmp/t02-native189-r5-independent-znhry9ge')
W=Path('/private/tmp/t02-native189-diagnosis-ok6396d2')
HEAD='3503cd7d5187b78140bc22fbb5e418ee9f2c6798'
TREE='be67aeb7817b1af3b89a7a2a2c2093e6244c8b73'
BASE='654658363a0347b1f50a40f868c32140b90881db'
GIT='/opt/homebrew/Cellar/git/2.56.0/bin/git'
PY='/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12'
def read(p):return json.loads(Path(p).read_text())
def save(n,v):
    with (O/n).open('x') as f:json.dump(v,f,indent=2);f.write('\n')
def git(*args):return subprocess.check_output([GIT,'--no-optional-locks','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-C',str(R),*args],timeout=30)
cache={}
def sha(p):
    p=Path(p);s=p.stat();key=(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    if key not in cache:
        with p.open('rb') as f:cache[key]=hashlib.file_digest(f,'sha256').hexdigest()
    return cache[key]
def facts(p):
    p=Path(p);s=p.lstat();v=dict(mode=s.st_mode,bytes=s.st_size,dev=s.st_dev,ino=s.st_ino,mtime=s.st_mtime_ns)
    if stat.S_ISREG(s.st_mode):v['sha256']=sha(p)
    elif stat.S_ISLNK(s.st_mode):v['link']=os.readlink(p)
    return v
def pins():
    v={k:git(*args).decode().strip() for k,args in [('head',('rev-parse','HEAD')),('tree',('rev-parse','HEAD^{tree}')),('branch',('branch','--show-current')),('status',('status','--porcelain=v1','--untracked-files=all')),('index',('ls-files','-v'))]}
    assert v['head']==HEAD and v['tree']==TREE and v['branch']=='codex/task/P1-E05-T02-thalune-reel-candidate' and not v['status']
    return v
def absent():
    ps=read(D/'prospective-paths.json')['paths'];assert len(ps)==len(set(ps))==11
    v={p:os.path.lexists(p) for p in ps};assert not any(v.values()),v;return v
def rows(items,root=None):
    for row in items:
        p=Path(row['path']) if root is None else root/row['path']
        assert sha(p)==row['sha256'],str(p)
        if 'bytes' in row:assert p.stat().st_size==row['bytes'],str(p)
    return len(items)
