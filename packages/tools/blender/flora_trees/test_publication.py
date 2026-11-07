"""Actual exporter/supervisor boundary with harmless CPU dependencies and file barriers.

These fixtures do not validate art. Production run.py/export_saved.py execute
unchanged, including source binding, stock argv, readiness, and publication.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

import test_runner as t

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]

STOCK = '''import json,os,tempfile,time
from pathlib import Path
def main(family,args):
 root=Path.cwd(); case=os.environ['PUBLICATION_CASE']
 (root/'child.pid').write_text(str(os.getpid()))
 output=Path(args[args.index('--out-dir')+1])
 private=output.parent
 assert output.is_relative_to(private) and private.name=='producer'
 temporary=Path(tempfile.gettempdir()).resolve()
 assert temporary==private/'tmp'
 (root/'stock-call.json').write_text(json.dumps({'argv':args,'output':str(output),'tmpdir':str(temporary)}))
 if case=='late-stock':
  (root/'barrier-entered').write_text('stock');print('child-ready',flush=True)
  until=time.monotonic()+20
  while not (root/'release-publish').exists() and time.monotonic()<until:time.sleep(.02)
  if not (root/'release-publish').exists():raise TimeoutError('stock barrier')
 if case=='stock-failure':return 7
 dst=output/'flora/tree_round_t04.glb';dst.parent.mkdir(parents=True);dst.write_bytes(b'VALIDATED-FIXTURE-GLB')
 return 0
'''
CORE = '''import atexit,json,os,time
from pathlib import Path
from types import SimpleNamespace
root=Path.cwd(); case=os.environ['PUBLICATION_CASE']; output=None
def validate_path(rules,candidate,**kw):
 global output
 output=candidate
 assert candidate.parent.name=='producer'
 if case=='late-validation':
  (root/'barrier-entered').write_text('validation');print('child-ready',flush=True)
  until=time.monotonic()+20
  while not (root/'release-publish').exists() and time.monotonic()<until:time.sleep(.02)
  if not (root/'release-publish').exists():raise TimeoutError('validation barrier')
 return SimpleNamespace(status='FAIL' if case=='validation-failure' else 'PASS')
def write_and_print(check,path):
 path.write_text(json.dumps({'status':check.status,'fixture':True}))
 if case=='mutate-during-validation':output.write_bytes(b'CHANGED-DURING-VALIDATION')
 if case=='source-during-validation':(root/'assets/blend/flora/tree_round_t04.blend').write_bytes(b'CHANGED-SOURCE')
def adverse():
 if output is None:return
 private=output.parent; ready=private/'ready.json'
 if not ready.exists():return
 if case=='output-after-ready':output.write_bytes(b'CHANGED-AFTER-READY')
 if case=='report-after-ready':(private/'final-stock-validation.json').write_text('{"status":"FAIL"}')
 if case=='source-after-ready':(root/'assets/blend/flora/tree_round_t04.blend').write_bytes(b'CHANGED-SOURCE')
 if case=='missing-ready':ready.unlink()
 if case in ('wrong-source','wrong-attempt','wrong-kind'):
  value=json.loads(ready.read_text())
  if case=='wrong-source':value['source']['sha256']='0'*64
  elif case=='wrong-kind':value['kind']='cactus'
  else:value['attempt']=str(root/'other-attempt')
  ready.write_text(json.dumps(value))
 if case=='symlink-output':
  backing=private/'backing.glb';output.rename(backing);output.symlink_to(backing)
 if case=='hardlink-output':os.link(output,private/'another-link.glb')
atexit.register(adverse)
'''
CLI = '''import sys
from pathlib import Path
Path(sys.argv[3]).write_bytes(Path(sys.argv[2]).read_bytes())
Path(sys.argv[4]).write_text('fixture mask promotion')
'''
INJECT = '''
original_link=m.os.link
def publication_link(src,dst,*args,**kw):
 canonical=Path(dst).suffix=='.glb' and '/public/models/' in str(dst)
 case=os.environ.get('PUBLICATION_CASE')
 if canonical and case=='promotion-denied':raise PermissionError(13,'controlled canonical promotion denial')
 result=original_link(src,dst,*args,**kw)
 if canonical:
  if case=='signal-during-promotion':os.kill(os.getpid(),2)
  if case=='source-during-promotion':(m.ROOT/'assets/blend/flora/tree_round_t04.blend').write_bytes(b'CHANGED-SOURCE')
  if case=='corrupt-canonical':Path(dst).write_bytes(b'CORRUPTED-CANONICAL')
  if case=='private-changes-after-copy':(Path(src).parent/'producer/tree_round_t04.glb').write_bytes(b'CHANGED-PRIVATE-ONLY')
 return result
m.os.link=publication_link
original_unlink=Path.unlink
def publication_unlink(p,*args,**kw):
 if os.environ.get('PUBLICATION_CASE')=='receipt-postlink-unlink-fails' and p.name=='.receipt.json.pending':raise PermissionError(13,'controlled postlink unlink failure')
 return original_unlink(p,*args,**kw)
Path.unlink=publication_unlink
original_fsync=m.os.fsync
def publication_fsync(fd):
 if os.environ.get('PUBLICATION_CASE')=='promotion-copy-fsync-fails':
  found=m.subprocess.check_output(['lsof','-a','-p',str(os.getpid()),'-d',str(fd),'-Fn'],text=True,timeout=2)
  if 'supervisor-publication.glb' in found:raise OSError(5,'controlled publication-copy fsync failure')
 return original_fsync(fd)
m.os.fsync=publication_fsync
'''


def active_group(pid):
    rows = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,stat='], text=True, timeout=2)
    return [line.strip() for line in rows.splitlines() if line.split()[1] == str(pid) and not line.split()[2].startswith('Z')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--evidence', type=Path, required=True)
    args = ap.parse_args()
    t.BOOT = t.BOOT.replace('sys.exit(m.main())', INJECT+'\nsys.exit(m.main())')
    harness = t.Harness(HERE/'run.py', args.evidence, ROOT/'assets/blend/flora/trees/revision1_20261107/reviewer/lifecycle.py')
    cases = []
    names = ['late-validation','late-stock','success','stock-failure','validation-failure',
             'mutate-during-validation','source-during-validation','output-after-ready',
             'report-after-ready','source-after-ready','wrong-source','wrong-attempt','wrong-kind',
             'missing-ready','symlink-output','hardlink-output','promotion-denied',
             'signal-during-promotion','source-during-promotion','corrupt-canonical','private-changes-after-copy',
             'receipt-postlink-unlink-fails','promotion-copy-fsync-fails']
    try:
        for name in names:
            root = harness.life.make_root(name)
            src, dst, cand = harness.life.place_pair(root, b'ORIGINAL-SOURCE', b'CURRENT-GLB', {'status':'PASS'})
            here = root/'packages/tools/blender/flora_trees'
            (here/'export_saved.py').write_bytes((HERE/'export_saved.py').read_bytes())
            art = here.parent/'artlib'; art.mkdir()
            for filename, body in [('__init__.py',''),('rules.py','def load(): return {}\n'),('export.py',STOCK),('core.py',CORE)]:
                (art/filename).write_text(body)
            cli = root/'node_modules/tsx/dist/cli.mjs'; cli.parent.mkdir(parents=True); cli.write_text(CLI)
            late = name.startswith('late-')
            env = {'ART_NODE':sys.executable, 'PUBLICATION_CASE':name}
            if late: env['DENY_SIGNAL'] = '1'
            result = harness.run(root, ['export','round','--deadline','8'], sig=signal.SIGINT if late else None, env=env)
            recs = harness.life.receipts(root)
            if not recs:
                recs = list((root/'assets/blend/flora/trees/evidence').glob('*/receipt-failure.json'))
            receipt_path = recs[0]
            body = json.loads(receipt_path.read_text())
            run = receipt_path.parent
            fact = {'name':name, 'command_result':result, 'receipt':body,
                    'runner_exact':(here/'run.py').read_bytes()==(HERE/'run.py').read_bytes(),
                    'exporter_exact':(here/'export_saved.py').read_bytes()==(HERE/'export_saved.py').read_bytes()}
            if late:
                before = {'absent':not os.path.lexists(dst),'receipt_sha256':t.digest(receipt_path)}
                assert result['exit'] == body['exit'] == 130 and before['absent'] and (root/'barrier-entered').exists()
                assert not body['cleanup']['terminal'] and not body['producer_history']['sealed']
                (root/'release-publish').write_text('go')  # Strictly AFTER supervisor returns.
                pid = int((root/'child.pid').read_text())
                until = time.monotonic()+6
                while active_group(pid) and time.monotonic()<until: time.sleep(.02)
                after = {'absent':not os.path.lexists(dst),'receipt_sha256':t.digest(receipt_path),
                         'group':active_group(pid),'private_ready':(run/'producer/ready.json').is_file(),
                         'private_output_sha256':t.digest(run/'producer/tree_round_t04.glb')}
                retry = harness.run(root, ['export','round','--deadline','8'])
                good = after['absent'] and after['private_ready'] and not after['group'] and before['receipt_sha256']==after['receipt_sha256'] and retry['exit']==75 and not os.path.lexists(dst)
                fact.update(before=before, after=after, retry=retry)
            elif name in ('success','private-changes-after-copy'):
                good = result['exit']==body['exit']==0 and body['cleanup']['terminal'] and body['child_exit']==0 and body['publication']['promoted'] and dst.read_bytes()==b'VALIDATED-FIXTURE-GLB' and body['export_sha256']==t.digest(dst) and not cand.exists()
                ready = json.loads((run/'producer/ready.json').read_text())
                good = good and ready['output']['sha256']==t.digest(dst) and dst.stat().st_nlink==1 and dst.stat().st_ino!=(run/'producer/tree_round_t04.glb').stat().st_ino
                if name=='private-changes-after-copy':good = good and (run/'producer/tree_round_t04.glb').read_bytes()==b'CHANGED-PRIVATE-ONLY'
            else:
                wanted = 7 if name=='stock-failure' else 130 if name=='signal-during-promotion' else 1
                good = result['exit']==body['exit']==wanted and not os.path.lexists(dst) and not cand.exists() and body['export_sha256'] is None and body['cleanup']['terminal'] and body['producer_history']['sealed']
                if name in ('signal-during-promotion','source-during-promotion','corrupt-canonical'):
                    good = good and (run/'failed-historical.glb').is_file() and (run/'producer/tree_round_t04.glb').read_bytes()==b'VALIDATED-FIXTURE-GLB'
                if name=='source-during-promotion':
                    good = good and body['source_mutation'] and not body['source_unchanged'] and body['source_after']==t.digest(src)
                if name=='receipt-postlink-unlink-fails':
                    good = good and body['reason']=='receipt write' and (run/'unsealed-historical.glb').is_file() and not (run/'receipt.json').exists()
                if name=='promotion-copy-fsync-fails':
                    good = good and body['unpublished_supervisor_copy']['binding']['sha256']==t.digest(run/'producer/tree_round_t04.glb')
            fact['passed'] = bool(good and fact['runner_exact'] and fact['exporter_exact'])
            cases.append(fact)
            print(name, fact['passed'], flush=True)
    finally:
        harness.cleanup()
        # Observe cleanup of all explicitly recorded groups, not just delivery of a signal.
        pids = [int(p.read_text()) for p in harness.life.OUT.glob('*/child.pid')]
        until = time.monotonic()+3
        while any(active_group(pid) for pid in pids) and time.monotonic()<until: time.sleep(.05)
        groups = {str(pid):active_group(pid) for pid in pids}
        complete = len(cases)==len(names) and all(c['passed'] for c in cases) and not any(groups.values())
        result = {'status':'PASS' if complete else 'FAIL','cases':cases,'terminal_groups':groups,
                  'runner_sha256':t.digest(HERE/'run.py'),'exporter_sha256':t.digest(HERE/'export_saved.py'),
                  'note':'CPU fixtures only; no stock art validation/Blender/codec execution.'}
        with (args.evidence/'results.json').open('x') as stream:json.dump(result,stream,indent=2);stream.write('\n')
        print(json.dumps({'status':result['status'],'passed':sum(c['passed'] for c in cases),'total':len(names)}))
    return 0 if complete else 1


if __name__ == '__main__':sys.exit(main())
