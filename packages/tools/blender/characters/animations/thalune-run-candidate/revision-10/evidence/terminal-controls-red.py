"""CPU-only real encode boundary: inert child, framed input, actual failure persistence."""
from pathlib import Path
import argparse,ast,contextlib,hashlib,io,json,signal,struct,subprocess,sys,tempfile,time,types
from unittest.mock import patch
A=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(A));import native189_producer as producer
BASE='654658363a0347b1f50a40f868c32140b90881db'
p=argparse.ArgumentParser();p.add_argument('--report',type=Path,required=True);p.add_argument('--base',action='store_true');args=p.parse_args()
ROOT=Path(tempfile.mkdtemp(prefix='t02-encoder-terminal-cpu-',dir='/private/tmp'));results=[]
source=subprocess.check_output(['git','show',BASE+':packages/tools/blender/characters/animations/thalune-run-candidate/rgb-primary.py'],text=True) if args.base else (A/'rgb-primary.py').read_text()

def case(mode,code=-25,sinks='ok'):
    module=types.ModuleType('encode_cpu');exec(compile(source,str(A/'rgb-primary.py'),'exec'),module.__dict__)
    root=ROOT/(mode+'-'+str(code)+'-'+sinks);root.mkdir();config=dict(schema=module.SCHEMA,frameCount=189,maxVideoBytes=39354368,ffmpeg='/INERT/ffmpeg',video=str(root/'primary.mp4'),rawLog=str(root/'raw.log'),command=str(root/'command.json'),result=str(root/'result.json'))
    original=BrokenPipeError('WRITE_FAILED') if mode=='write' else subprocess.TimeoutExpired(['inert'],.05,output=b'partial\x00\xff',stderr=b'err\x80') if mode in ['source','poll','wait'] else KeyboardInterrupt() if mode=='cancel' else OSError('RESULT_PERSISTENCE')
    original.unknown={'preserve':[7,None,False]};calls=[];saved=[]
    class Input:
        def __init__(self):self.i=0;self.pending=b''
        def read(self,n):
            if mode in ['source','cancel']:raise original
            if not self.pending:
                if self.i==189:return b''
                h=json.dumps(dict(workId='fixture/'+str(self.i),mediaFrameOrdinal=self.i)).encode();self.pending=struct.pack('>II',len(h),1)+h+b'p';self.i+=1
            data,self.pending=self.pending[:n],self.pending[n:];return data
    class Pipe:
        def write(self,b):
            calls.append('write')
            if mode=='write':raise original
        def flush(self):pass
        def close(self):calls.append('close')
    class Child:
        pid=12345;stdin=Pipe();returncode=None
        def poll(self):
            calls.append('poll')
            if mode=='poll':raise original
            self.returncode=code if mode in ['early','write'] and (mode=='early' or 'write' in calls) else None
            return self.returncode
        def wait(self):
            calls.append('wait')
            if mode=='wait':raise original
            self.returncode=0 if mode=='success-write' else code
            Path(config['video']).write_bytes(b'inert')
            return self.returncode
    child=Child();actual_save=module.save
    def save(path,value):
        if str(path)==config['result']:
            saved.append(value.copy())
            if mode=='success-write' or sinks in ['file','all']:raise original if mode=='success-write' else OSError('PERSISTENCE_FAILED')
        actual_save(path,value)
    class BrokenStream:
        def write(self,t):raise OSError('STDERR_FAILED')
        def flush(self):pass
    with patch.object(module.resource,'setrlimit',lambda *a:None),patch.object(module.subprocess,'Popen',lambda *a,**k:child),patch.object(module,'pixels',lambda _: (b'rgb',{})),patch.object(module,'save',save),patch.object(sys,'stderr',BrokenStream() if sinks=='all' else io.StringIO()):
        try:module.encode(config,Input(),io.StringIO())
        except BaseException as error:
            if mode in ['write','source','poll','wait','cancel','success-write']:assert error is original
            evidence=error.mediaFailure
        else:raise AssertionError('Expected refusal')
    if args.base:
        assert 'encoderTerminal' not in evidence and 'encoderTerminal' not in vars(error) if False else 'encoderTerminal' not in evidence
        return dict(status='RED_REPRODUCED',mode=mode,code=code,sinks=sinks,evidence=evidence,calls=calls,sourceSha256=hashlib.sha256(source.encode()).hexdigest())
    terminal=evidence['encoderTerminal'];known=terminal['returncodeKnown']
    if mode in ['early','write','finish','success-write']:
        expected=0 if mode=='success-write' else code
        assert known and terminal['returncode']==expected
        assert terminal['signalNumber']==(-expected if expected<0 else None)
        assert terminal['exitStatus']==(expected if expected>=0 else None)
    else:assert not known
    if mode=='poll':assert len(terminal['observationFailures'])==1
    if mode in ['early','source','cancel','poll']:assert 'write' not in calls and 'wait' not in calls
    if mode=='write':assert calls.count('write')==1 and 'wait' not in calls
    if sinks=='all':assert len(evidence['persistenceFailures'])==2
    if mode in ['source','poll','wait','cancel','success-write','write']:assert evidence['primaryFailure']['details']['unknown']==original.unknown
    assert evidence['accepted'] is False
    return dict(status='PASS',mode=mode,code=code,sinks=sinks,evidence=evidence,calls=calls)
try:
    for code in [-25,-9,17,0]:
        for sinks in ['ok','file','all']:results.append(case('early',code,sinks))
    if not args.base:
        for mode in ['write','source','poll','wait','cancel','finish','success-write']:
            for sinks in ['ok','all']:results.append(case(mode,sinks=sinks))
finally:
    with args.report.open('x') as f:json.dump(dict(base=BASE,sourceSha256=hashlib.sha256(source.encode()).hexdigest(),scratch=str(ROOT),status='RED_REPRODUCED' if args.base else 'PASS',count=len(results),cases=results),f,indent=2)
print(json.dumps(dict(count=len(results),status='RED_REPRODUCED' if args.base else 'PASS')))
