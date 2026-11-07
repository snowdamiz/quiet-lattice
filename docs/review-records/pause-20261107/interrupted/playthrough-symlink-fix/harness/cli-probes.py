from pathlib import Path
import subprocess, os, json, sys

out=Path(__file__).resolve().parent
root=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-08e12f47')
node='/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node'
tsx=root/'node_modules/tsx/dist/cli.mjs'
target=root/'packages/tools/src/capture/playthrough-run.ts'
baseline=out/'baseline.ts'
results=[]
serial=0

def run(name, scenario=None, args=None, source=target, entry=None, import_only=False):
    global serial
    serial+=1
    meta_path=out/f'cli-{serial:02d}.meta.json'
    trace_path=out/f'cli-{serial:02d}.trace'
    # Use the documented pnpm/tsx command and real repository file, redirecting only external ports.
    cmd=[node,str(tsx),'--import',str(out/'preload.mjs')]
    if import_only:
        cmd+=[str(out/'import-check.mjs')]
    else:
        cmd += [str(entry or source), *(args or [])]
    env=dict(os.environ,REVIEW_TARGET=str(source),REVIEW_CASE=json.dumps(scenario or {}),REVIEW_META=str(meta_path),REVIEW_TRACE=str(trace_path))
    # pnpm --filter @astra/tools exec runs tsx in the package directory.
    # Drop inherited color forcing so Node's aggregate diagnostics stay plain text.
    env.pop('FORCE_COLOR', None)
    env.pop('NO_COLOR', None)
    env['NO_COLOR'] = '1'
    p=subprocess.run(cmd,cwd=root/'packages/tools',env=env,capture_output=True,text=True,timeout=15)
    record={'id':serial,'name':name,'argv':cmd,'scenario':scenario or {},'source':str(source),'exitCode':p.returncode,'stdout':p.stdout,'stderr':p.stderr,'meta':json.loads(meta_path.read_text()) if meta_path.exists() else None}
    (out/f'cli-{serial:02d}.json').write_text(json.dumps(record,indent=2)+'\n')
    if record['meta'] is None:
        raise AssertionError('preload evidence absent for '+name)
    return record

def check(name, fn):
    try:
        evidence=fn()
        results.append({'name':name,'status':'PASS','runs':evidence})
    except Exception as e:
        results.append({'name':name,'status':'FAIL','error':str(e)})

def inert():
    rec=run('import is inert',import_only=True)
    assert rec['exitCode']==0, rec
    assert rec['stdout']=='import is inert\n', rec
    assert rec['meta']['trace']==[], rec
    assert rec['meta']['loaded'], 'target module was not loaded'
    return [rec['id']]
check('module import is inert and exports runPlaythrough',inert)

cases=[
 ('default',{},[]),
 ('custom phases and separators',{},['--','mine','--','board']),
 ('dock output',{},['leave','dock']),
 ('failed phase',{'phaseResults':{'leave':'fail'}},['leave','mine']),
 ('page and console errors',{'pageErrors':True},['leave']),
]
for name,scenario,args in cases:
    def compare(name=name,scenario=scenario,args=args):
        old=run('baseline '+name,scenario,args,source=baseline)
        new=run('candidate '+name,scenario,args,entry='src/capture/playthrough-run.ts')
        expected=1 if name in ['failed phase','page and console errors'] else 0
        assert old['exitCode']==new['exitCode']==expected, (old,new)
        assert old['stdout']==new['stdout'] and new['stdout'], (old,new)
        assert old['meta']['trace']==new['meta']['trace'], (old,new)
        assert new['meta']['trace'][-4:]==['close','close:done','stop','stop:done'], new
        return [old['id'],new['id']]
    check('CLI compatibility: '+name,compare)

for stage in ['startVite','glArgs','launch','goto','close','stop']:
    for raw in ['undefined','null','false','zero','abort']:
        def failure(stage=stage,raw=raw):
            rec=run('failure '+stage+'/'+raw,{'faults':{stage:raw}},['leave'])
            assert rec['exitCode']!=0, rec
            trace=rec['meta']['trace']
            if stage=='startVite':
                assert trace==['startVite'],rec
            else:
                assert trace.count('stop')==1,rec
                browser=stage not in ['glArgs','launch']
                assert trace.count('close')==(1 if browser else 0),rec
                if browser: assert trace.index('close')<trace.index('stop'),rec
            return [rec['id']]
        check('CLI nonzero with cleanup: '+stage+'/'+raw,failure)

def triple():
    rec=run('triple failure',{'faults':{'goto':'undefined','close':'null','stop':'zero'}},['leave'])
    assert rec['exitCode']!=0,rec
    assert 'AggregateError: Playthrough and/or cleanup failed' in rec['stderr'],rec
    assert '[cause]: undefined' in rec['stderr'] and '[errors]: [ undefined, null, 0 ]' in rec['stderr'],rec
    assert rec['meta']['trace'][-2:]==['close','stop'],rec
    return [rec['id']]
check('CLI retains aggregate diagnostics after cleanup',triple)

def symlink():
    old=run('baseline symlink',args=['leave'],source=baseline,entry=out/'baseline-alias.ts')
    new=run('candidate symlink',args=['leave'],entry=out/'entry-alias.ts')
    assert old['exitCode']==0 and old['stdout']=='[leave] (0s) leave ok\n',old
    assert old['meta']['trace'][-4:]==['close','close:done','stop','stop:done'],old
    assert new['meta']['loaded'],new
    assert new['exitCode']==0 and new['stdout']==old['stdout'] and new['meta']['trace']==old['meta']['trace'], {
        'baseline_run':old['id'],'candidate_run':new['id'],
        'expected_stdout':old['stdout'],'actual_stdout':new['stdout'],'actual_exitCode':new['exitCode'],
        'actual_loaded':new['meta']['loaded'],'actual_argv':new['meta']['argv'],'actual_trace':new['meta']['trace']
    }
    return [old['id'],new['id']]
check('symlink CLI entry executes phases instead of silently succeeding',symlink)
summary={'passed':sum(r['status']=='PASS' for r in results),'failed':sum(r['status']=='FAIL' for r in results),'checks':results,'subprocess_runs':serial}
(out/'cli-results.json').write_text(json.dumps(summary,indent=2)+'\n')
for r in results:
    print(r['status']+': '+r['name'])
    if r['status']=='FAIL':print(r['error'])
print(json.dumps({k:v for k,v in summary.items() if k!='checks'}))
sys.exit(1 if summary['failed'] else 0)
