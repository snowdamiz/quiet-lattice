"""Real runner filesystem/process controls; no Blender, codec, or dependency writes.

The four R1 reviewer cases execute the pinned reviewer functions with an adapter
that changes only the child executable and scratch output root. EPERM is injected
at the OS signal boundary; the runner, filesystem, and child processes are real.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent

BOOT = '''import importlib.util, os, sys
from pathlib import Path
p=Path(__file__).parent/'packages/tools/blender/flora_trees/run.py'
s=importlib.util.spec_from_file_location('runner',p)
m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
m.BLENDER=str(Path(__file__).parent/'producer')
if os.environ.get('DENY_SIGNAL'):
 def deny(*args): raise PermissionError(1,'controlled killpg denial')
 m.os.killpg=deny
if os.environ.get('FIXED_ATTEMPT'):
 m.time.strftime=lambda *_:'20000101T000000'
 class Fixed: hex='aaaaaaaa'
 m.uuid.uuid4=lambda:Fixed()
if os.environ.get('FAIL_RECEIPT_FSYNC'):
 real_fsync=m.os.fsync
 def fail_fsync(fd):
  # Fail at the real receipt I/O boundary, after the JSON bytes were written.
  target=m.subprocess.check_output(['lsof','-a','-p',str(os.getpid()),'-d',str(fd),'-Fn'],text=True)
  if '.receipt.json.pending' in target: raise OSError(5,'controlled receipt fsync failure')
  return real_fsync(fd)
 m.os.fsync=fail_fsync
sys.exit(m.main())
'''
PRODUCER = '''#!PYTHON
import runpy, sys
p=sys.argv[sys.argv.index('--python')+1]
sys.argv=[p,*sys.argv[sys.argv.index('--') :]]
runpy.run_path(p,run_name='__main__')
'''


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Harness:
    def __init__(self, runner, evidence, reviewer):
        self.out = evidence
        self.out.mkdir(parents=True, exist_ok=False)
        self.life = load(reviewer, 'reviewer_lifecycle')
        self.life.OUT = self.out/'scratch'
        self.life.OUT.mkdir()
        self.life.RUN_PY = runner.read_bytes()
        self.life.run = self.run
        self.children = []
        self.records = []
        self.calls = {}

    def run(self, root, args, deadline_watch=None, sig=None, sig_after=None, *, env=None):
        (root/'boot.py').write_text(BOOT)
        (root/'producer').write_text(PRODUCER.replace('PYTHON', sys.executable))
        (root/'producer').chmod(0o755)
        command = [sys.executable, '-B', str(root/'boot.py'), *args]
        count=self.calls.get(root.name,0)
        self.calls[root.name]=count+1
        log = self.out/(root.name+f'-{count}.log')
        started = time.monotonic()
        with log.open('xb') as stream:
            child = subprocess.Popen(command, cwd=root, env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1', **(env or {})}, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            self.children.append(child)
            if sig is not None:
                until = time.monotonic()+5
                while time.monotonic()<until:
                    logs = list((root/'assets/blend/flora/trees/evidence').glob('*/process.log'))
                    if logs and b'child-ready' in logs[0].read_bytes():
                        break
                    if child.poll() is not None:
                        break
                    time.sleep(.02)
                if child.poll() is None:
                    os.kill(child.pid, sig)
            try:
                rc = child.wait(timeout=deadline_watch or 25)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=3)
                raise AssertionError('runner exceeded harness deadline')
        # Producer PID recorded in its own ready marker or in the real receipt.
        pids = []
        for p in (root/'assets/blend/flora/trees/evidence').glob('*/receipt.json'):
            if not p.is_file():
                continue
            r=json.loads(p.read_text())
            if r.get('pid'): pids.append(r['pid'])
        marker=root/'child.pid'
        if marker.exists(): pids.append(int(marker.read_text()))
        survivors=[]
        for pid in set(pids):
            rows=subprocess.check_output(['ps','-axo','pid=,pgid=,stat='],text=True)
            survivors += [line.strip() for line in rows.splitlines() if line.split()[1]==str(pid) and not line.split()[2].startswith('Z')]
        result={'exit':rc,'command':command,'elapsed_s':round(time.monotonic()-started,3),'log':log.read_text()[-5000:],'survivors':survivors,'pid':child.pid}
        self.records.append(result)
        return result

    def cleanup(self):
        # Only our explicitly recorded scratch child groups. Never Blender or peers.
        for marker in self.life.OUT.glob('*/child.pid'):
            pid=int(marker.read_text())
            try: os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError: pass
        for child in self.children:
            if child.poll() is None:
                os.killpg(child.pid,signal.SIGKILL)
                child.wait(timeout=3)

    def signal_case(self, name='signal-permission', deny=True, delay=12):
        root=self.life.make_root(name)
        src,dst,cand=self.life.place_pair(root,b'ORIGINAL-SOURCE',b'CURRENT-GLB',{'status':'PASS'})
        script=root/'packages/tools/blender/flora_trees/export_saved.py'
        script.write_text("import os,time\nfrom pathlib import Path\nr=Path(__file__).resolve().parents[4]\n(r/'child.pid').write_text(str(os.getpid()))\nprint('child-ready',flush=True)\ntime.sleep("+str(delay)+")\n")
        result=self.run(root,['export','round','--deadline','20'],sig=signal.SIGINT,env={'DENY_SIGNAL':'1'} if deny else {})
        recs=self.life.receipts(root)
        body=json.loads(recs[0].read_text()) if recs else None
        return {'name':name,'defect_reproduced':body is None,'receipt':body,'canonical_export_exists':dst.exists(),'candidate_exists':cand.exists(),'run':result}

    def reviewed(self):
        cases=[self.life.case_unreadable(),self.life.case_directory_source(),self.life.case_symlink_archive(),self.life.case_publish_then_source_mutation(),self.signal_case()]
        # Reviewer report F-C says receipt exit 0; its script mistakenly tests 1.
        mutation=cases[3]
        mutation['reviewer_predicate_result']=mutation['defect_reproduced']
        mutation['defect_reproduced']=(mutation['export_bytes']=='PUBLISHED-GLB' and mutation['receipt']['exit']==0 and mutation['receipt'].get('source_mutation') is True)
        names=['unreadable-source','directory-source','symlink-archive','source-mutation','signal-permission']
        for index,(case,name) in enumerate(zip(cases,names)):
            root=self.life.OUT/name
            recs=self.life.receipts(root)
            body=json.loads(recs[0].read_text()) if recs else None
            dst=root/'packages/client/public/models/flora/tree_round_t04.glb'
            cand=root/'assets/blend/flora/trees/candidate.json'
            safe=bool(body and body['exit']!=0 and not os.path.lexists(dst) and not os.path.lexists(cand))
            if index<2:
                safe=bool(safe and body['source_before'] is None and not body['child_started'] and body['errors'])
            elif index==2:
                archive=recs[0].parent/'previous-historical.glb' if recs else None
                safe=bool(safe and archive and not archive.is_symlink() and archive.stat().st_nlink==1 and case['sha_before']==case['sha_after'] and archive.read_bytes()==b'ARCHIVED-BYTES')
            elif index==3:
                archive=recs[0].parent/'failed-historical.glb' if recs else None
                safe=bool(safe and body['child_exit']==0 and body['source_mutation'] and archive and archive.read_bytes()==b'PUBLISHED-GLB' and body['export_sha256'] is None)
            else:
                safe=bool(safe and body['exit']==130 and body['reason']=='interrupted' and any(e['type']=='PermissionError' for e in body['cleanup']['errors']) and not body['cleanup']['terminal'] and not body['child_reaped'] and body['remaining_owned_children'] and (root/'assets/blend/flora/trees/evidence/.lane.blocked.json').is_file())
            case['safe_boundary']=safe
            case['receipt']=body
        return cases

    def controls(self):
        cases=[]
        def record(name, passed, **facts):
            cases.append({'name':name,'expectation_met':bool(passed),**facts})
        def setup(name,script=''):
            root=self.life.make_root(name)
            src,dst,cand=self.life.place_pair(root,b'ORIGINAL-SOURCE',b'CURRENT-GLB',{'status':'PASS'})
            prefix="import os,sys,time,subprocess\nfrom pathlib import Path\nr=Path(__file__).resolve().parents[4]\n(r/'child.pid').write_text(str(os.getpid()))\ndst=r/'packages/client/public/models/flora/tree_round_t04.glb'\nsrc=r/'assets/blend/flora/tree_round_t04.blend'\nprint('child-ready',flush=True)\n"
            if name in {'normal-success','exited-leader','receipt-write-failure','receipt-fsync-failure','reused-attempt'}:
                # These harmless success fixtures implement the new private producer
                # protocol. Negative fixtures still exercise rejection/retirement of
                # unauthorized canonical writes. Exact exporter coverage is separate.
                prefix += '''import atexit,hashlib,json
attempt=Path(sys.argv[-1]); private=attempt/'producer'; dst=private/'tree_round_t04.glb'
def binding(p):
 data=p.read_bytes()
 return {'path':str(p),'resolved_path':str(p.resolve()),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
def ready():
 raw=private/'stock/flora/tree_round_t04.glb';raw.parent.mkdir(parents=True);raw.write_bytes(dst.read_bytes())
 report=private/'final-stock-validation.json';report.write_text('{"status":"PASS","fixture":true}')
 precision=private/'precision.json';precision.write_text('fixture')
 (private/'ready.json').write_text(json.dumps({'schema':1,'attempt':str(attempt.resolve()),'kind':'round','source':binding(src),'output':binding(dst),'validation':binding(report),'stock':binding(raw),'precision':binding(precision)}))
atexit.register(ready)
'''
            (root/'packages/tools/blender/flora_trees/export_saved.py').write_text(prefix+script)
            return root,src,dst,cand
        def execute(root,**kw):
            result=self.run(root,['export','round','--deadline','2'],**kw)
            recs=self.life.receipts(root)
            body=json.loads(recs[0].read_text()) if recs else None
            return result,body,recs[0].parent if recs else None
        def absent(dst,cand):
            return not os.path.lexists(dst) and not os.path.lexists(cand)

        for name,code in [('normal-success',0),('producer-fails',7)]:
            root,src,dst,cand=setup(name,"dst.write_bytes(b'NEW-GLB')\nsys.exit("+str(code)+")\n")
            result,body,run=execute(root)
            good=body['child_exit']==code and body['exit']==code and result['exit']==code and body['child_reaped'] and body['cleanup']['terminal'] and body['remaining_owned_children']==[]
            good=good and ((dst.read_bytes()==b'NEW-GLB' and body['export_sha256']==digest(dst)) if code==0 else (absent(dst,cand) and (run/'failed-historical.glb').read_bytes()==b'NEW-GLB'))
            record(name,good,receipt=body)

        for name,mode in [('unreadable-output','unreadable'),('broken-export-link','broken'),('directory-output','directory'),('fifo-output','fifo')]:
            root,src,dst,cand=setup(name)
            if mode=='unreadable': dst.chmod(0)
            else:
                dst.unlink()
                if mode=='broken': dst.symlink_to(root/'missing')
                elif mode=='directory': dst.mkdir()
                else: os.mkfifo(dst)
            result,body,run=execute(root)
            row=body['archives'][0]['entries'][1]
            good=result['exit']!=0 and absent(dst,cand) and not body['child_started'] and row['invalidated'] and row['errors'] and 'payload' not in row
            if mode=='broken': good=good and not list(run.rglob('*.glb'))
            record(name,good,receipt=body)

        # A read failure on candidate must not prevent retiring the later GLB.
        root,src,dst,cand=setup('unreadable-candidate')
        cand.chmod(0)
        result,body,run=execute(root)
        row=body['archives'][0]['entries'][0]
        record('unreadable-candidate',result['exit']!=0 and absent(dst,cand) and row['errors'] and 'payload' not in row and (run/'previous-historical.glb').read_bytes()==b'CURRENT-GLB',receipt=body)

        for name,kind in [('hardlink-archive','hard'),('relative-link-archive','relative'),('chain-owned-alias','chain')]:
            root,src,dst,cand=setup(name,'sys.exit(9)\n')
            backing=root/'backing.glb'; backing.write_bytes(b'BACKING')
            dst.unlink()
            if kind=='hard': os.link(backing,dst)
            elif kind=='relative': dst.symlink_to(os.path.relpath(backing,dst.parent))
            else:
                dst.symlink_to(cand)
                cand.unlink(); cand.symlink_to(backing)
            result,body,run=execute(root)
            archived=run/'previous-historical.glb'
            before=digest(archived)
            backing.write_bytes(b'CHANGED')
            record(name,result['exit']==9 and absent(dst,cand) and not archived.is_symlink() and archived.stat().st_nlink==1 and archived.stat().st_ino!=backing.stat().st_ino and digest(archived)==before and archived.read_bytes()==b'BACKING',receipt=body)

        # Actual signal and timeout controls, plus a descendant after leader exit.
        for name,sig,script in [('sigint',signal.SIGINT,'time.sleep(20)\n'),('sigterm',signal.SIGTERM,'time.sleep(20)\n'),('timeout',None,'time.sleep(20)\n'),('exited-leader',None,"subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'])\ndst.write_bytes(b'NEW-GLB')\n")]:
            root,src,dst,cand=setup(name,script)
            result,body,run=execute(root,sig=sig)
            wanted=128+sig if sig else (124 if name=='timeout' else 0)
            record(name,result['exit']==wanted and body['exit']==wanted and body['child_reaped'] and body['cleanup']['terminal'] and body['remaining_owned_children']==[] and not result['survivors'],receipt=body)

        terminal=self.signal_case('denied-but-exited',deny=True,delay=.5)
        body=terminal['receipt']
        record('denied-but-exited',body and body['exit']==130 and body['child_exit']==0 and body['child_reaped'] and body['cleanup']['terminal'] and body['cleanup']['errors'] and not terminal['run']['survivors'],facts=terminal)

        # EPERM after the leader's exit must preserve its primary exit 7.
        root,src,dst,cand=setup('primary-preserved',"subprocess.Popen([sys.executable,'-c','import time; time.sleep(12)'])\ntime.sleep(.1)\nsys.exit(7)\n")
        result,body,run=execute(root,env={'DENY_SIGNAL':'1'})
        record('primary-preserved',result['exit']==7 and body['exit']==7 and body['reason']=='child exit' and body['child_exit']==7 and not body['cleanup']['terminal'] and body['cleanup']['errors'],receipt=body)

        # File identity failure after a successful child: unreadable source.
        root,src,dst,cand=setup('source-unreadable-after',"dst.write_bytes(b'NEW-GLB')\nsrc.chmod(0)\n")
        result,body,run=execute(root)
        record('source-unreadable-after',result['exit']!=0 and body['child_exit']==0 and body['source_after'] is None and body['export_sha256'] is None and absent(dst,cand),receipt=body)

        root,src,dst,cand=setup('missing-published-output')
        result,body,run=execute(root)
        record('missing-published-output',result['exit']!=0 and body['child_exit']==0 and body['reason']=='export after' and body['export_sha256'] is None and absent(dst,cand),receipt=body)

        root,src,dst,cand=setup('receipt-write-failure',"dst.write_bytes(b'NEW-GLB')\n(Path(sys.argv[-1])/'receipt.json').mkdir()\n")
        result=self.run(root,['export','round','--deadline','2'])
        fallback=list((root/'assets/blend/flora/trees/evidence').glob('*/receipt-failure.json'))
        body=json.loads(fallback[0].read_text()) if fallback else None
        record('receipt-write-failure',result['exit']!=0 and body and body['exit']!=0 and body['reason']=='receipt write' and absent(dst,cand) and (fallback[0].parent/'unsealed-historical.glb').read_bytes()==b'NEW-GLB',receipt=body)

        root,src,dst,cand=setup('receipt-fsync-failure',"dst.write_bytes(b'NEW-GLB')\n")
        result=self.run(root,['export','round','--deadline','2'],env={'FAIL_RECEIPT_FSYNC':'1'})
        fallback=list((root/'assets/blend/flora/trees/evidence').glob('*/receipt-failure.json'))
        body=json.loads(fallback[0].read_text()) if fallback else None
        record('receipt-fsync-failure',result['exit']!=0 and body and body['exit']!=0 and body['export_sha256'] is None and absent(dst,cand) and not list((root/'assets/blend/flora/trees/evidence').glob('*/receipt.json')),receipt=body)

        control=self.life.case_lock()
        record('lock-held',control['control_passed'],facts=control)
        root,src,dst,cand=setup('reused-attempt',"dst.write_bytes(b'NEW-GLB')\n")
        first,body,run=execute(root,env={'FIXED_ATTEMPT':'1'})
        before={str(p): (p.read_bytes(),p.stat().st_mtime_ns) for p in [src,dst,*run.rglob('*')] if p.is_file()}
        second=self.run(root,['export','round','--deadline','2'],env={'FIXED_ATTEMPT':'1'})
        after={str(p): (p.read_bytes(),p.stat().st_mtime_ns) for p in [src,dst,*run.rglob('*')] if p.is_file()}
        record('reused-attempt',first['exit']==0 and second['exit']==73 and before==after and len(self.life.receipts(root))==1)
        # Guard survives the unresolved child, and refuses a new attempt without effects.
        root=self.life.OUT/'signal-permission'
        self.cleanup()
        time.sleep(.1)
        evidence=root/'assets/blend/flora/trees/evidence'
        before={str(p):p.read_bytes() for p in evidence.rglob('*') if p.is_file()}
        result=self.run(root,['export','round','--deadline','2'])
        after={str(p):p.read_bytes() for p in evidence.rglob('*') if p.is_file()}
        record('blocked-lane',result['exit']==75 and before==after)
        return cases


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--runner',type=Path,default=HERE/'run.py')
    ap.add_argument('--evidence',type=Path,required=True)
    ap.add_argument('--reviewer',type=Path,required=True)
    ap.add_argument('--expect',choices=('red','green'),required=True)
    args=ap.parse_args()
    harness=Harness(args.runner,args.evidence,args.reviewer)
    try:
        cases=harness.reviewed()
        for case in cases:
            case['expectation_met']=bool(case['defect_reproduced']) if args.expect=='red' else case['safe_boundary']
        if args.expect=='green':
            cases.extend(harness.controls())
        result={'runner_sha256':digest(args.runner),'reviewer_sha256':digest(args.reviewer),'expected':args.expect,'cases':cases,'commands':harness.records}
        passed=all(c['expectation_met'] for c in cases)
        result['status']='PASS' if passed else 'FAIL'
        (args.evidence/'results.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'status':result['status'],'cases':[(c['name'],c['expectation_met']) for c in cases]}))
        return 0 if passed else 1
    finally:
        harness.cleanup()


if __name__=='__main__': sys.exit(main())
