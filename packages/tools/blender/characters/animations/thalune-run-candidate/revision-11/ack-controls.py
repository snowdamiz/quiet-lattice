"""Actual framed encoder/DiagnosticStream boundary, inert codec; no native launch."""
from pathlib import Path
import contextlib,importlib.util,io,json,signal,sys,tempfile,time
from unittest.mock import patch
A=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(A));import native189_producer as producer
spec=importlib.util.spec_from_file_location('prior_cpu',A/'native189-controls.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)
O=Path(sys.argv[1]);O.mkdir();results=[];serial=0;dispatcher_error=None

def run(mode,frame=0,sinks='ok',full=False):
    global serial,dispatcher_error
    serial+=1;m=producer.worker();root=O/f'{serial:02}-{mode}-{frame}-{sinks}';root.mkdir()
    config=dict(schema=m.SCHEMA,frameCount=189,maxVideoBytes=39354368,ffmpeg='/INERT/ffmpeg',video=str(root/'primary.mp4'),rawLog=str(root/'raw.log'),command=str(root/'command.json'),result=str(root/'result.json'))
    generated=[]
    def generate(i):
        generated.append(i)
        return producer.localized_diagnostic(i) if full else producer.localized_diagnostic(i,2,2)
    stream=producer.DiagnosticStream(prior.PLAN['diagnostic'],generate)
    original=KeyboardInterrupt() if mode=='cancel' else BrokenPipeError('ACK_BOUNDARY_'+mode)
    original.unknown={'keep':77};original.output=b'partial\x00\xff';original.stderr=b'raw\x80';original.extra={'future':[False,None,5]}
    calls=[];faults=[];inflight=0;data_lengths=[]
    def fail():faults.append(mode);raise original
    class Pipe:
        def write(self,data):data_lengths.append(len(data));calls.append('rgb-write');return len(data)
        def flush(self):
            calls.append('rgb-flush')
            if mode=='stdin-flush':fail()
        def close(self):calls.append('rgb-close')
    class Child:
        stdin=Pipe()
        def poll(self):calls.append('poll');return -25 if faults else None
        def wait(self):calls.append('wait');Path(config['video']).write_bytes(b'INERT');return 0
    class Ack:
        def write(self,text):
            current=stream.pending['mediaFrameOrdinal'] if stream.pending else stream.ordinal-1
            active=current==frame
            if active:
                if mode in ['first','cancel'] or (mode=='newline' and text=='\n'):fail()
                if (mode=='body-after' and text!='\n') or (mode=='newline-after' and text=='\n'):
                    stream.write(text);fail()
                if mode=='alarm':
                    faults.append(mode);time.sleep(1)
                if mode in ['body-short','body-none','body-bool'] and text!='\n':
                    stream.write(text[:len(text)//2]);faults.append(mode);return {'body-short':len(text)//2,'body-none':None,'body-bool':True}[mode]
                if mode in ['newline-short','newline-none','newline-bool'] and text=='\n':
                    stream.write(text);faults.append(mode);return {'newline-short':0,'newline-none':None,'newline-bool':True}[mode]
            return stream.write(text)
        def flush(self):
            if mode=='flush' and stream.ordinal==frame+1:fail()
    actual_save=m.save
    def save(path,value):
        if str(path)==config['result'] and sinks in ['file','all']:raise OSError('RESULT_WRITE_FAILED')
        actual_save(path,value)
    class BrokenStream:
        def write(self,text):raise OSError('FAILURE_STREAM_FAILED')
        def flush(self):raise AssertionError('unreachable')
    def pixels(png):
        hashes={k:v for k,v in stream.pending.items() if k.endswith('Sha256')}
        return b'inert-rgb',{**hashes,'sourcePngBytes':len(png),'width':1920,'height':1080,'alphaPolicy':'verified-opaque255','sourcePngRetained':False}
    with contextlib.ExitStack() as stack:
        for port in [patch.object(m.resource,'setrlimit',lambda *a:None),patch.object(m.subprocess,'Popen',lambda *a,**kw:Child()),patch.object(m,'save',save),patch.object(sys,'stderr',BrokenStream() if sinks=='all' else io.StringIO())]:stack.enter_context(port)
        if not full:stack.enter_context(patch.object(m,'pixels',pixels))
        try:
            with prior.CORE['deadline'](.03 if mode=='alarm' else 10):m.encode(config,stream,Ack())
        except BaseException as error:
            assert mode!='success';evidence=error.mediaFailure
            if mode in ['first','newline','body-after','newline-after','flush','cancel','stdin-flush']:
                assert error is original and evidence['primaryFailure']['details']['unknown']==original.unknown
                assert evidence['primaryFailure']['details']['output']=="b'partial\\x00\\xff'"
            elif mode=='alarm':assert type(error).__name__=='DeadlineExpired'
            else:assert type(error) is AssertionError
            if mode=='first' and sinks=='all' and frame==0 and not full:dispatcher_error=error
        else:
            assert mode=='success';evidence=json.loads(Path(config['result']).read_text())
    assert signal.getitimer(signal.ITIMER_REAL)[0]==0
    terminal=evidence['encoderTerminal'];written=189 if mode=='success' else 0 if mode=='stdin-flush' else frame+1
    emitted=189 if mode=='success' else 0 if mode=='stdin-flush' else frame
    assert evidence['frames']==written==terminal['framesWrittenToEncoder']
    assert terminal['framesAcknowledged']==emitted
    assert terminal['observations'][-1]['framesWrittenToEncoder']==written
    assert terminal['observations'][-1]['framesAcknowledged']==emitted
    assert emitted<=stream.ordinal<=written
    if mode=='success':
        assert evidence['accepted'] is True and terminal['returncode']==0 and stream.ordinal==189 and calls.count('wait')==1
        assert terminal['ackDelivery']['status']=='completed'
    else:
        assert evidence['accepted'] is False and terminal['returncode']==-25 and 'wait' not in calls and 'rgb-close' not in calls
        assert len(generated)==(1 if mode=='stdin-flush' else frame+1)
        if mode=='stdin-flush':assert terminal['ackDelivery'] is None
        else:
            delivery=terminal['ackDelivery'];assert delivery['status']=='unconfirmed' and delivery['mediaFrameOrdinal']==frame
            expected='newline-write' if mode in ['newline','newline-after','newline-short','newline-none','newline-bool'] else 'flush' if mode=='flush' else 'body-write'
            assert delivery['phase']==expected
    if full:assert data_lengths==[6220800]
    if sinks!='ok':assert len(evidence['persistenceFailures'])==(2 if sinks=='all' else 1)
    return dict(mode=mode,frame=frame,sinks=sinks,actualFullPixels=full,generated=generated,producerOrdinal=stream.ordinal,evidence=evidence,calls=calls,qualification='Completed local ACK emission is distinct from consumer observation; any failed attempt remains unconfirmed.')

def case(name,fn):
    result=fn();results.append(dict(name=name,status='PASS',facts=result))
    (O/'results.json').write_text(json.dumps(dict(status='PASS',count=len(results),cases=results,nativeProcesses=0),indent=2)+'\n')
for mode in ['first','newline','flush']:case('actual pixels '+mode,lambda mode=mode:run(mode,full=True))
for mode in ['first','newline','flush']:
    for sinks in ['file','all']:case(mode+' persistence '+sinks,lambda mode=mode,sinks=sinks:run(mode,sinks=sinks))
for frame in [1,188]:
    for mode in ['first','newline','flush']:case(mode+' ordinal '+str(frame),lambda mode=mode,frame=frame:run(mode,frame))
for mode in ['body-short','body-none','body-bool','newline-short','newline-none','newline-bool','stdin-flush','success','cancel','alarm']:case(mode,lambda mode=mode:run(mode))
for mode in ['body-after','newline-after']:
    for sinks in ['ok','all']:case(mode+' '+sinks,lambda mode=mode,sinks=sinks:run(mode,sinks=sinks))
assert dispatcher_error is not None
prior.RuntimeError=lambda *a:dispatcher_error
for mode in ['primary','all-sinks','all-files','cli-all-sinks']:
    def dispatch(mode=mode):
        facts=prior.sequence(mode);r=facts['result'];t=r['primaryFailure']['details']['encoderTerminal']
        assert r['nativeJobs']==1 and r['status']=='HOLD' and t['framesWrittenToEncoder']==1 and t['framesAcknowledged']==0 and t['returncode']==-25
        return facts
    case('actual dispatcher '+mode,dispatch)
print(json.dumps(dict(status='PASS',controls=len(results),nativeProcesses=0)))
