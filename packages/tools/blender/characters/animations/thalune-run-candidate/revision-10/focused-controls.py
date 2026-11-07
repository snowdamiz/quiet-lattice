"""CPU controls; no codecs. Retained inert lifecycle ports and exact timed guard."""
from pathlib import Path
import ast,hashlib,importlib.util,io,json,os,signal,subprocess,sys,tempfile,time
from types import SimpleNamespace
from unittest.mock import patch
A=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(A));import native189_producer as producer
O=Path(sys.argv[1]);O.mkdir();results=[]
spec=importlib.util.spec_from_file_location('prior_native_cpu',A/'native189-controls.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)
def case(name,fn):
    facts=fn();results.append(dict(name=name,status='PASS',facts=facts))
    with (O/'results.json').open('w') as f:json.dump(dict(status='PASS',count=len(results),cases=results),f,indent=2)
def media_error(timed=False):
    root=O/('timed-media' if timed else 'terminal-media');root.mkdir();m=producer.worker();config=dict(schema=m.SCHEMA,frameCount=189,maxVideoBytes=39354368,video=str(root/'primary.mp4'),rawLog=str(root/'raw.log'),command=str(root/'command.json'),result=str(root/'result.json'),ffmpeg='/INERT/ffmpeg')
    calls=[]
    class Source:
        def read(self,n):
            if timed:time.sleep(.3)
            raise AssertionError('unexpected read')
    if not timed:
        import struct
        h=json.dumps(dict(workId='terminal',mediaFrameOrdinal=0)).encode();source=io.BytesIO(struct.pack('>II',len(h),1)+h+b'p')
    else:source=Source()
    child=SimpleNamespace(poll=lambda:-25 if not timed else None,stdin=SimpleNamespace(write=lambda _:calls.append('write')))
    with patch.object(m.resource,'setrlimit',lambda *a:None),patch.object(m.subprocess,'Popen',lambda *a,**k:child),patch.object(m,'pixels',lambda _: (b'rgb',{})),patch.object(sys,'stderr',io.StringIO()):
        try:
            with prior.CORE['deadline'](.03 if timed else 3):m.encode(config,source,io.StringIO())
        except BaseException as error:
            assert not calls and signal.getitimer(signal.ITIMER_REAL)[0]==0
            assert error.mediaFailure['accepted'] is False
            if timed:assert type(error).__name__=='DeadlineExpired' and error.encoderTerminal['returncodeKnown'] is False
            else:assert error.encoderTerminal['returncode']==-25
            return error
    raise AssertionError('Expected encoder failure')
error=media_error();error.unknown={'keep':77}
# Substitute only the inert start-error fixture; production adapter/dispatcher and
# exact retained helper bodies execute unchanged in prior.sequence.
prior.RuntimeError=lambda *args:error
for mode in ['primary','all-sinks','all-files','cli-all-sinks']:
    def run(mode=mode):
        facts=prior.sequence(mode);r=facts['result'];assert r['nativeJobs']==1 and r['status']=='HOLD'
        assert r['primaryFailure']['details']['encoderTerminal']['returncode']==-25
        return facts
    case('actual adapter dispatcher '+mode,run)
case('real one-shot SIGALRM media boundary',lambda:prior.caller.error_receipt(media_error(True)))
case('original entropy exact small pixels',prior.png_case)
for mode in ['happy','backpressure','bad-ack']:case('189 stream '+mode,lambda mode=mode:prior.stream_case(mode))
for old in [True,False]:case('prior primary persistence '+str(old),lambda old=old:prior.worker_error_case(old))
for count in [189,190]:case('prior RGB surplus '+str(count),lambda count=count:prior.surplus_case(count))
for mode in ['boundary','copies','archives','retained-excess','capacity']:case('reserve '+mode,lambda mode=mode:prior.reserve_case(mode))

def fixture():
    from PIL import Image
    old=subprocess.check_output(['git','show','654658363a0347b1f50a40f868c32140b90881db:'+str((A/'native189_producer.py').relative_to(prior.contract.ROOT))],text=True)
    oldfn=next(n for n in ast.parse(old).body if isinstance(n,ast.FunctionDef) and n.name=='diagnostic')
    newfn=next(n for n in ast.parse((A/'native189_producer.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='diagnostic')
    assert ast.dump(oldfn)==ast.dump(newfn)
    probe=json.loads(Path('/private/tmp/t02-native189-diagnosis-ok6396d2/localized-motion-candidate/result.json').read_text())
    rows=[]
    for i in [*range(16),60,120,180,188]:
        png,h=producer.localized_diagnostic(i);im=Image.open(io.BytesIO(png));im.load();assert im.mode=='RGBA' and im.size==(1920,1080) and im.getchannel('A').getextrema()==(255,255)
        assert h['rgbaSha256']==hashlib.sha256(im.tobytes()).hexdigest()
        x0,y0=640+4*(i%61),220+i%31
        for x,y in [(0,0),(1919,1079),(x0,y0),(x0+383,y0+575)]:
            inside=x0<=x<x0+384 and y0<=y<y0+576;u,v,j=(x-x0,y-y0,i) if inside else (x,y,0)
            assert im.getpixel((x,y))==((u+3*j)%256,(v+5*j)%256,((u//32)^(v//32)^j)&255,255)
        if i<16:assert h['rgbSha256']==probe['frames'][i]['rgbSha256']
        rows.append(dict(frame=i,**h,pngBytes=len(png)))
    assert len({r['rgbSha256'] for r in rows})==len(rows)
    try:producer.DiagnosticStream(dict(frames=189,width=1920,height=1080,fps=60,alpha=255,pattern=producer.PATTERN))
    except AssertionError:pass
    else:raise AssertionError('Old diagnostic accepted by new positive route')
    return dict(frames=rows,entropyAlgorithmUnchanged=True,probeFrameHashesMatch=16,full189CodecQualification=False)
case('localized full dimensions exact pixels hashes and original entropy unchanged',fixture)
for mode in ['happy','backpressure','bad-ack']:
    def localized_stream(mode=mode):
        calls=[]
        def small(i):calls.append(i);return producer.localized_diagnostic(i,2,2)
        s=producer.DiagnosticStream(prior.PLAN['diagnostic'],small)
        import struct
        for i in range(189):
            h,p=struct.unpack('>II',s.read(8));s.read(h);s.read(p)
            if i==0 and mode=='backpressure':
                failure=prior.refused(lambda:s.read(8));assert calls==[0];return failure
            ack=dict(schema=prior.contract.SCHEMA,**s.pending,width=1920,height=1080,alphaPolicy='verified-opaque255',sourcePngRetained=False)
            if i==0 and mode=='bad-ack':ack['rgbaSha256']='0'*64;return prior.refused(lambda:s.write(json.dumps(ack)+'\n'))
            s.write(json.dumps(ack)+'\n')
        assert s.read(1)==b'' and len(s.rows)==189
        assert [r['mediaPts'] for r in s.rows]==list(range(0,189000,1000))
        return dict(frames=189,oneAck=True)
    case('localized ACK transport '+mode,localized_stream)
print(json.dumps(dict(status='PASS',count=len(results),root=str(O))))
