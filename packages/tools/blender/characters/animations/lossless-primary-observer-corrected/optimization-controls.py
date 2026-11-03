"""Pinned-interpreter admission controls; only short Python processes are permitted."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import hashlib,json,os,subprocess,sys,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
PYTHON='/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
TARGETS=['caller.py','integration.py','rgb-primary.py','freeze.py','controls.py','observer-controls.py','packet-budget-controls.py','packet_budget.py','optimization-controls.py','release-controls.py']
BOOTSTRAP=r'''
import sys,json,builtins
source=sys.argv[1];target=sys.argv[2];level=int(sys.argv[3]);mode=sys.argv[4]
sys.path.insert(0,sys.argv[5]);code=compile(source,target,'exec',optimize=level)
imports=[];activity=[];original=builtins.__import__
def guarded_import(name,*a,**k):
 imports.append(name)
 if mode!='normal' and name not in ('assertion_guard','sys','_io'):raise RuntimeError('UNEXPECTED_IMPORT:'+name)
 if name in ('round4_job_boundary','round4_capture_children','run_round4_browser_proof','run_round4_remaining8','PIL'):
  activity.append('helper-import:'+name);raise RuntimeError('HELPER_IMPORT_REFUSED')
 return original(name,*a,**k)
builtins.__import__=guarded_import
def audit(event,args):
 if event in ('os.mkdir','subprocess.Popen','os.system','os.exec','os.fork','os.posix_spawn','socket.__new__'):
  activity.append(event);raise RuntimeError('ACTIVITY_REFUSED:'+event)
 if event=='open':
  mode=args[1];flags=args[2]
  if (isinstance(mode,str) and any(x in mode for x in 'wax+')) or (isinstance(flags,int) and flags&0x601):
   activity.append('write-open');raise RuntimeError('ALLOCATION_REFUSED')
sys.addaudithook(audit)
namespace={'__name__':'t02_optimization_probe','__file__':target};outcome=None
try:
 exec(code,namespace)
 if mode=='normal':
  if target.endswith('integration.py'):namespace['main']()
  elif target.endswith('caller.py'):namespace['consume']({'runtimeAuthorization':False},None)
except BaseException as error:outcome={'type':type(error).__name__,'message':str(error)}
print(json.dumps({'optimize':sys.flags.optimize,'compiledLevel':level,'outcome':outcome,'imports':imports,'activity':activity}))
'''
def require(condition,message):
    if not condition:raise RuntimeError(message)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
    root=Path(tempfile.mkdtemp(prefix='t02-assertion-guard-controls-'));rows=[];sequence=0
    before_files={str(p):sha(p) for p in HERE.rglob('*') if p.is_file() and p.name!='optimization-controls.json'}
    env0={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'};env0.pop('PYTHONOPTIMIZE',None)
    def run(label,args,env,bytecode_disabled=True):
        nonlocal sequence
        sequence+=1
        p=subprocess.run([PYTHON,*(['-B'] if bytecode_disabled else []),*args],env=env,text=True,capture_output=True,timeout=10)
        (root/f'{sequence:03}.stdout').write_text(p.stdout);(root/f'{sequence:03}.stderr').write_text(p.stderr)
        return p
    for name in TARGETS:
        target=HERE/name;source=target.read_text()
        for level in [1,2]:
            env={**env0,'PYTHONOPTIMIZE':str(level)}
            direct_env=dict(env);direct_env.pop('PYTHONDONTWRITEBYTECODE',None)
            direct=run(name+'-env'+str(level),[str(target),'--execute','--grant','DO_NOT_CREATE'],direct_env,bytecode_disabled=False)
            require(direct.returncode!=0 and 'T02_ASSERTIONS_REQUIRED' in direct.stderr,'Direct optimized entry did not refuse '+name)
            rows.append({'target':str(target),'case':'direct-env-'+str(level),'passed':True,'exit':direct.returncode})
            probe=run(name+'-probe-env'+str(level),['-c',BOOTSTRAP,source,str(target),'-1','optimized',str(HERE)],env)
            require(probe.returncode==0,'Probe failed '+probe.stderr);r=json.loads(probe.stdout)
            require(r['optimize']==level and r['outcome']['type']=='SystemExit' and r['outcome']['message'].startswith('T02_ASSERTIONS_REQUIRED'),'Wrong optimized probe result')
            require(not r['activity'] and set(r['imports'])<=set(['assertion_guard','sys','_io']),'Activity before optimized refusal')
            rows.append({'target':str(target),'case':'instrumented-env-'+str(level),'passed':True,**r})
            probe=run(name+'-compiled'+str(level),['-c',BOOTSTRAP,source,str(target),str(level),'optimized',str(HERE)],env0)
            require(probe.returncode==0,'Compiled probe failed '+probe.stderr);r=json.loads(probe.stdout)
            require(r['optimize']==0 and r['outcome']['type']=='SystemExit' and r['outcome']['message'].startswith('T02_ASSERTIONS_REQUIRED'),'Compiled optimized target bypassed guard')
            require(not r['activity'] and set(r['imports'])<=set(['assertion_guard','sys','_io']),'Activity before compiled refusal')
            rows.append({'target':str(target),'case':'compiled-optimized-'+str(level),'passed':True,**r})
    # Guard source compiled under optimization must itself refuse in a normal interpreter.
    target=HERE/'assertion_guard.py'
    for level in [1,2]:
        probe=run('guard-compiled'+str(level),['-c',BOOTSTRAP,target.read_text(),str(target),str(level),'optimized',str(HERE)],env0);r=json.loads(probe.stdout)
        require(r['outcome']['type']=='SystemExit' and r['outcome']['message'].startswith('T02_ASSERTIONS_REQUIRED') and not r['activity'],'Compiled guard did not refuse')
        rows.append({'target':str(target),'case':'guard-compiled-'+str(level),'passed':True,**r})
    for name in ['caller.py','integration.py']:
        target=HERE/name;probe=run('normal-disabled-'+name,['-c',BOOTSTRAP,target.read_text(),str(target),'0','normal',str(HERE)],env0)
        require(probe.returncode==0,'Normal probe failed '+probe.stderr);r=json.loads(probe.stdout)
        require(r['optimize']==0 and r['outcome']['type']=='AssertionError' and ('disabled' in r['outcome']['message'].lower() or 'no new native' in r['outcome']['message']),'Normal disabled admission changed')
        require(not r['activity'],'Normal disabled admission had runtime side effects')
        rows.append({'target':str(target),'case':'normal-disabled','passed':True,**r})
    # A real pre-fix source under the same optimized compiler reaches its first unguarded import.
    for name in ['caller.py','integration.py']:
        previous=subprocess.check_output(['/usr/bin/git','show','f6fbef82de592829da7d5b217e08caf9f8feb026:'+str((HERE/name).relative_to(Path(json.loads((HERE/'readiness.json').read_text())['root'])))],text=True)
        probe=run('pre-fix-negative-'+name,['-c',BOOTSTRAP,previous,str(HERE/name),'1','optimized',str(HERE)],env0);r=json.loads(probe.stdout)
        require(r['outcome']['type']=='RuntimeError' and r['outcome']['message'].startswith('UNEXPECTED_IMPORT:'),'Pre-fix source did not reach forbidden import')
        rows.append({'target':str(HERE/name),'case':'actual-f6-pre-fix-negative-control','passed':True,**r})
    ready=json.loads((HERE/'readiness.json').read_text())
    require(not Path(ready['packetRoot']).exists() and not Path(ready['cpuProofRoot']).exists(),'Future output was allocated')
    after_files={str(p):sha(p) for p in HERE.rglob('*') if p.is_file() and p.name!='optimization-controls.json'}
    require(after_files==before_files,'A control changed or allocated a candidate input/cache before its report')
    report={'candidateFilesUnchangedBeforeReport':True,'directOptimizedCasesUnsetExternalBytecodeSuppression':True,'status':'PASS_PINNED_PYTHON_OPTIMIZATION_ADMISSION','cases':len(rows),'rows':rows,'rawProcessEvidence':str(root),'processCount':sequence,'stationJobs':0,'encoderDecoderBrowserLaunches':0,'futureNamespacesAbsent':True,'sourceSha256':{n:sha(HERE/n) for n in [*TARGETS,'assertion_guard.py']}}
    (HERE/'release-accounting-correction'/'optimization-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':'PASS','cases':len(rows),'shortInterpreterProcesses':sequence,'rawEvidence':str(root),'runtimeActivity':0}))
if __name__=='__main__':main()
