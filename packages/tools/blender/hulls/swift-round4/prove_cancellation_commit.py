"""Real signals and real promotion at the task-local publication transition; light only."""
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
REL = Path('packages/tools/blender/hulls/swift-round4')
OUTER = ROOT / 'assets/renders/hulls/swift-round4-current/89-cancellation-commit'

HOOK = '''import os,sys,errno,json,time,signal
from pathlib import Path
done=False
def trace(frame,event,arg):
 global done
 if done or event!='line':return trace
 path=Path(frame.f_code.co_filename)
 if path.name!='lane.py':return trace
 v=frame.f_locals;line=path.read_text().splitlines()[frame.f_lineno-1].strip();point=os.environ['POINT']
 hit=(point=='before-mask' and line.startswith('previous_mask = signal.pthread_sigmask'))
 hit=hit or (point=='pending-at-entry' and line=='pending = signal.sigpending() & cancellation_signals')
 hit=hit or (point=='inside-transition' and line=='publication.unlink()')
 hit=hit or (point=='after-unlink' and line=='committed = True')
 hit=hit or (point=='after-transition' and line=='if job is not None and signal_events and not committed:')
 hit=hit or (point=='provisional' and line.startswith('print(json.dumps({k: receipt[k]'))
 if hit:
  done=True;p=Path(os.environ['EVENT'])
  def facts():
   return {'actualPID':os.getpid(),'point':point,'line':frame.f_lineno,'reason':frame.f_locals.get('reason'),'committed':frame.f_locals.get('committed'),'gateExists':frame.f_locals['publication'].exists(),'phase':frame.f_locals.get('publication_phase'),'pending':[int(x) for x in signal.sigpending()],'events':list(frame.f_locals.get('signal_events',[]))}
  data={'before':facts()};p.write_text(json.dumps(data));deadline=time.monotonic()+18
  while not Path(os.environ['RESUME']).exists() and time.monotonic()<deadline:time.sleep(.01)
  if not Path(os.environ['RESUME']).exists():raise TimeoutError('bounded transition barrier expired')
  data['after']=facts();p.write_text(json.dumps(data))
  if os.environ.get('FAIL_UNLINK')=='1':raise OSError(errno.EIO,'controlled commit unlink failure with queued cancellation')
 return trace
sys.settrace(trace)
'''


def main():
    label = sys.argv[1]
    assert label and Path(label).name == label
    lock = ROOT / REL / '.light-proof-lock'
    # The bootstrap/red run already acquired this task's root ownership.
    owner = json.loads((lock / 'owner.json').read_text())
    try:
        os.kill(owner['pid'], 0)
    except ProcessLookupError:
        pass
    else:
        raise RuntimeError('previous light proof owner is still alive')
    (lock / 'owner.json').write_text(json.dumps({'pid': os.getpid(), 'phase': label}))
    out = OUTER / label
    out.mkdir()
    shutil.copyfile(__file__, out / 'driver.py')
    sys.path.insert(0, str(OUTER / 'scripts'))
    import run_review as q
    r = q.r
    r.OUT = out
    r.RESULTS = []
    r.HANDLES = []
    r.FIXTURES = []
    original_launch, original_fixture = r.launch, r.fixture
    stopping = []
    def stop(sig, frame):
        stopping.append(int(sig))
    for sig in [signal.SIGTERM, signal.SIGINT]:
        signal.signal(sig, stop)
    def launch(cmd, root, log, env=None):
        assert not stopping, ('driver cancelled; no more admissions', stopping)
        free = shutil.disk_usage(ROOT).free
        rows = subprocess.check_output(['/bin/ps','-axo','pid=,rss=,command='],text=True,timeout=5)
        with (out / 'admissions.jsonl').open('a') as f:
            f.write(json.dumps({'command':list(map(str,cmd)), 'freeBytes':free,
                               'allRssKiB':sum(int(line.split()[1]) for line in rows.splitlines()),
                               'timeNs':time.time_ns()})+'\n')
        assert free >= 8 * 1024**3
        return original_launch(cmd, root, log, env)
    def fixture(*args, **kwargs):
        root, code = original_fixture(*args, **kwargs)
        pins = r.read(root / 'code-pins.json')
        pins['revision'] = 'working candidate; exact hashes below'
        r.write(root / 'code-pins.json', pins)
        return root, code
    r.launch, r.fixture = launch, fixture
    try:
        if len(sys.argv) > 2 and sys.argv[2] == 'neighbors':
            neighbors(q)
        else:
            publications(q)
            for mode in ['exit','timeout','both']:
                q.observation('observer-'+mode, mode)
            for case in ['before-handshake','before-dispatch','after-dispatch']:
                r.startup(case)
        r.write(out / 'complete.json', {'result':'PASS focused boundaries only','rows':len(r.RESULTS)})
    finally:
        for p in r.HANDLES:
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=20)
                except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
        r.write(out / 'actual-exits.json', [{'pid':p.pid,'exit':p.returncode} for p in r.HANDLES])
        for root in r.FIXTURES:r.cleanup(root)
        r.write(out / 'final-processes.json', {'allControllersWaited':all(p.returncode is not None for p in r.HANDLES),
                 'fixtures':[str(root) for root in r.FIXTURES], 'stopSignals':stopping})
        # Leave the ownership record for the task's report/verified final release.


def publications(q):
    r=q.r
    root,code=r.fixture('publication',assets=True)
    (root/'publish.py').write_text(r.PUBLISH)
    hook=root/'hook';hook.mkdir()
    (hook/'sitecustomize.py').write_text(HOOK)
    failure_hook=root/'failure-hook';failure_hook.mkdir()
    # Exact retained reviewer I/O injections, unmodified.
    (failure_hook/'sitecustomize.py').write_text(q.HOOK)
    good={}
    def producer(kind,label,mode='ok',env=None):
        return r.run(r.lane(root,label,[r.PY,'-B',root/'publish.py',r.ROOT/r.EV/r.ORIGINS[kind],kind,mode]),root,root/(label+'.log'),env)
    def consumer(label,stages,expect):
        dest=root/r.DST;output=root/label;output.mkdir()
        before={'inode':dest.stat().st_ino,'sha256':r.sha(dest)}
        rc=r.run([r.PY,'-B',code/'promote.py',*stages],root,output/'command.log',{**r.ENV,'SWIFT_JOB':str(output)})
        after={'inode':dest.stat().st_ino,'sha256':r.sha(dest)}
        result={'case':label,'consumerExit':rc,'before':before,'after':after,'replaced':before['inode']!=after['inode'],
                'promotionReceiptExists':(output/'promotion.json').exists()}
        r.write(output/'result.json',result);r.record(result)
        assert rc==(0 if expect else 1) and result['replaced']==expect and result['promotionReceiptExists']==expect
        assert before['sha256']==after['sha256']
    def stages(audit):return [good['stock'],good['identity'],audit,good['fit']]
    try:
        for kind in ['stock','identity','fit']:
            good[kind]=kind+'-ok';assert producer(kind,good[kind])==0
        cases=[(point,[sig],False) for point in ['provisional','before-mask','pending-at-entry','inside-transition','after-unlink','after-transition'] for sig in [signal.SIGTERM,signal.SIGINT]]
        cases += [('before-mask',[signal.SIGINT,signal.SIGTERM,signal.SIGINT],False),
                  ('inside-transition',[signal.SIGINT,signal.SIGTERM,signal.SIGINT],False),
                  ('inside-transition',[],False),('inside-transition',[signal.SIGTERM],True)]
        for i,(point,signals,fail_unlink) in enumerate(cases):
            label=f'audit-{i:02d}-{point}';event=root/(label+'-event.json');resume=root/(label+'-resume')
            env={**r.ENV,'PYTHONPATH':str(hook),'POINT':point,'EVENT':str(event),'RESUME':str(resume),'FAIL_UNLINK':str(int(fail_unlink))}
            p=r.launch(r.lane(root,label,[r.PY,'-B',root/'publish.py',r.ROOT/r.EV/r.ORIGINS['audit'],'audit','ok']),root,root/(label+'.log'),env)
            r.wait(event.exists,12)
            assert p.poll() is None
            # Publication is visible only after the unlink, including before the
            # runner assigns its Python bookkeeping flag or returns to its caller.
            visible=point in ['after-unlink','after-transition']
            consumer('while-'+label,stages(label),visible)
            for sig in signals:
                p.send_signal(sig);time.sleep(.04)
            resume.write_text('resume');rc=p.wait(timeout=18)
            accepted=not fail_unlink and (not signals or point in ['inside-transition','after-unlink','after-transition'])
            facts=r.read(event);stage=root/r.EV/label
            text=(root/(label+'.log')).read_text()
            actual_events=[json.loads(line.removeprefix('SWIFT_SIGNAL ')) for line in text.splitlines() if line.startswith('SWIFT_SIGNAL ')]
            result={'case':label,'controllerExit':rc,'signalsSent':list(map(int,signals)),'event':facts,
                    'signalDiagnostics':actual_events,'refusalExists':(stage/'.publication-open').exists(),
                    'cancellation':r.read(stage/'cancellation.json') if (stage/'cancellation.json').exists() else None,
                    'expectedAccepted':accepted,'queuedCancellationWithUnlinkFailure':fail_unlink}
            r.write(root/(label+'-result.json'),result);r.record(result)
            assert rc==(0 if accepted else 1)
            assert result['refusalExists']==(not accepted)
            assert set(map(int,signals)) <= {e['signal'] for e in actual_events}
            if signals and accepted:
                assert all(e['committed'] and e['publicationPhase']=='committed' for e in actual_events)
                assert r.read(stage/'receipt.json')['reason'] is None
            if signals and not accepted:
                assert any(not e['committed'] for e in actual_events)
                if not fail_unlink:assert result['cancellation']['reason'].startswith('cancelled signal')
            if point=='pending-at-entry':assert any(e['observation']=='pending-at-decision' for e in actual_events)
            consumer('after-'+label,stages(label),accepted)
        for fault in ['fsync','receipt-link','receipt-close','manifest-sync','unlink-error','kill-before-commit']:
            label='audit-'+fault;env={**r.ENV,'PYTHONPATH':str(failure_hook),'FAULT':fault,'EVENT':str(root/(label+'-event.json'))}
            rc=producer('audit',label,env=env)
            assert rc==(-9 if fault=='kill-before-commit' else 1)
            consumer('reject-'+fault,stages(label),False)
            r.cleanup(root)
            lock=code/'.lane-lock'
            if lock.exists():lock.rename(root/('retained-lock-'+fault))
        for kind in ['stock','identity','audit','fit']:
            label=kind+'-exit23';assert producer(kind,label,mode='fail')==23
            if 'audit' not in good:good['audit']='audit-ok';assert producer('audit','audit-ok')==0
            chain=[good[k] if k!=kind else label for k in ['stock','identity','audit','fit']]
            consumer('reject-'+label,chain,False)
        consumer('accept-normal',[good[k] for k in ['stock','identity','audit','fit']],True)
    finally:r.cleanup(root)


def neighbors(q):
    r=q.r
    for name in ['check_lane.py','check_guardian.py']:
        root,code=r.fixture('protected-'+name.removesuffix('.py'))
        shutil.copyfile(ROOT/REL/name,code/name)
        assert r.sha(code/name)==r.sha(ROOT/REL/name)
        rc=r.run([r.PY,'-B',code/name,'probe'],root,root/'command.log',timeout=35)
        r.record({'case':name,'actualExit':rc,'helperSHA256':r.sha(code/name)})
        assert rc==0
        r.cleanup(root)
    root,code=r.fixture('extra-publication',assets=True)
    (root/'publish.py').write_text(r.PUBLISH)
    hook=root/'hook';hook.mkdir()
    extra=q.HOOK.replace(" if hit:\n", """ hit=hit or (frame.f_code.co_name=='durable_json' and target=='receipt.json' and fault=='receipt-flush' and line=='f.flush()')
 hit=hit or (frame.f_code.co_name=='durable_json' and target=='publication.json' and ((fault=='manifest-fsync' and line=='os.fsync(f.fileno())') or (fault=='manifest-link' and line=='os.link(private, path)') or (fault=='manifest-close' and line=="with private.open('x') as f:" and 'f' in v)))
 if frame.f_code.co_name=='sync_directory' and line=='os.fsync(fd)':
  parent=frame.f_back
  hit=hit or (fault=='receipt-directory-sync' and parent and parent.f_code.co_name=='durable_json' and parent.f_locals['path'].name=='receipt.json')
 if hit:
""")
    (hook/'sitecustomize.py').write_text(extra)
    good={}
    def produce(kind,label,env=None):
        return r.run(r.lane(root,label,[r.PY,'-B',root/'publish.py',ROOT/r.EV/r.ORIGINS[kind],kind,'ok']),root,root/(label+'.log'),env)
    for kind in ['stock','identity','fit']:
        good[kind]=kind+'-ok';assert produce(kind,good[kind])==0
    for fault in ['receipt-flush','receipt-directory-sync','manifest-fsync','manifest-link','manifest-close']:
        label='audit-'+fault
        env={**r.ENV,'PYTHONPATH':str(hook),'FAULT':fault,'EVENT':str(root/(label+'-event.json'))}
        rc=produce('audit',label,env)
        event=r.read(root/(label+'-event.json'))
        assert rc==1
        out=root/('reject-'+fault);out.mkdir();dest=root/r.DST
        before={'inode':dest.stat().st_ino,'sha':r.sha(dest)}
        consume=r.run([r.PY,'-B',code/'promote.py',good['stock'],good['identity'],label,good['fit']],root,out/'command.log',{**r.ENV,'SWIFT_JOB':str(out)})
        after={'inode':dest.stat().st_ino,'sha':r.sha(dest)}
        result={'case':fault,'actualProducerLaneExit':rc,'actualConsumerExit':consume,'before':before,'after':after,'event':event}
        r.write(out/'result.json',result);r.record(result)
        assert consume==1 and before==after and not (out/'promotion.json').exists()
        r.cleanup(root)
        lock=code/'.lane-lock'
        if lock.exists():lock.rename(root/('retained-lock-'+fault))
    hold=r.run([r.PY,'-B',ROOT/REL/'lane.py','--label','89-held-admission-check','--timeout','1','--',r.PY,'-B','-c','raise SystemExit(99)'],ROOT,r.OUT/'held-admission.log')
    assert hold==1 and not (ROOT/REL/'.lane-lock').exists() and not (ROOT/r.EV/'89-held-admission-check').exists()
    r.record({'case':'actual canonical hold','exit':hold,'jobAbsent':True,'lockAbsent':True})


if __name__=='__main__':main()
