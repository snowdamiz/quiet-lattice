from common import *
import sys,io,struct,importlib.util,contextlib,signal
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0,str(A))
import native189_producer as producer,contract
root=O/'neighbors';root.mkdir();results=[]
def test(name,fn):
    result=fn();results.append(dict(name=name,**result))
    save('neighbor-'+name+'.json',results[-1])
def encoder_case(mode):
    m=producer.worker();out=root/mode;out.mkdir()
    config=dict(schema=m.SCHEMA,frameCount=189,maxVideoBytes=39354368,ffmpeg='/INERT/ffmpeg',video=str(out/'primary.mp4'),rawLog=str(out/'raw.log'),command=str(out/'command.json'),result=str(out/'result.json'))
    stream=producer.DiagnosticStream(read(A/'native189-plan.json')['diagnostic'],lambda i:producer.localized_diagnostic(i,2,2))
    error=OSError('INDEPENDENT_'+mode);error.unknown={'raw':b'\x00\xff','keep':[False,11]}
    calls=[];acks=[]
    class Pipe:
        def write(self,data):calls.append('write');return len(data)
        def flush(self):
            calls.append('flush')
            if mode=='stdin-flush':raise error
        def close(self):
            calls.append('close')
            if mode=='stdin-close':raise error
    class Child:
        stdin=Pipe()
        def poll(self):calls.append('poll');return -25 if 'error' in calls else None
        def wait(self):calls.append('wait');Path(config['video']).write_bytes(b'inert-only');return 0
    class Ack:
        def write(self,text):
            acks.append(text)
            if mode=='ack-first' or (mode=='ack-newline' and text=='\n'):
                calls.append('error');raise error
            return stream.write(text)
        def flush(self):
            if mode=='ack-flush':calls.append('error');raise error
    child=Child()
    def launch(*args,**kwargs):
        calls.append('Popen')
        if mode=='spawn':raise error
        return child
    def pixel(png):
        row={k:v for k,v in stream.pending.items() if k.endswith('Sha256')}
        return b'inert-rgb',{**row,'sourcePngBytes':len(png),'width':1920,'height':1080,'alphaPolicy':'verified-opaque255','sourcePngRetained':False}
    with patch.object(m.resource,'setrlimit',lambda *a:None),patch.object(m.subprocess,'Popen',launch),patch.object(m,'pixels',pixel),patch.object(sys,'stderr',io.StringIO()):
        try:m.encode(config,stream,Ack())
        except BaseException as observed:
            assert observed is error
            evidence=observed.mediaFailure
            assert evidence['accepted'] is False
            assert evidence['primaryFailure']['details']['unknown']['raw']=="b'\\x00\\xff'"
        else:raise AssertionError('Expected failure')
    terminal=evidence['encoderTerminal']
    if mode.startswith('ack-'):
        assert terminal['returncode']==-25 and calls.count('write')==1 and 'wait' not in calls
    if mode in ['ack-first','ack-newline']:
        assert stream.ordinal==0 and terminal['observations'][-1]['framesAcknowledged']==0
        status='PASS'
    else:status='PASS'
    if mode=='spawn':assert terminal['observations']==[] and not terminal['returncodeKnown']
    if mode=='stdin-flush':assert stream.ordinal==0 and calls.count('write')==1 and 'wait' not in calls
    if mode=='stdin-close':assert stream.ordinal==189 and 'wait' not in calls
    return dict(status=status,actualAcknowledged=stream.ordinal,framesAcceptedByWrite=calls.count('write'),calls=calls,ackWriteCalls=len(acks),evidence=evidence,qualification='Actual encode and DiagnosticStream; inert Popen/codec/pixel/rlimit ports. No native process.')
for mode in ['ack-first','ack-newline','ack-flush','stdin-flush','stdin-close','spawn']:test(mode,lambda mode=mode:encoder_case(mode))
def real_pixels():
    from PIL import Image
    m=producer.worker();png,h=producer.localized_diagnostic(188)
    rgb,row=m.pixels(png)
    assert all(row[k]==v for k,v in h.items()) and row['alphaPolicy']=='verified-opaque255'
    im=Image.open(io.BytesIO(png));im.load();im.putpixel((0,0),(*im.getpixel((0,0))[:3],254))
    output=io.BytesIO();im.save(output,format='PNG')
    try:m.pixels(output.getvalue())
    except AssertionError as error:assert str(error)=='Nonopaque alpha refused before encoder write'
    else:raise AssertionError('Nonopaque pixel accepted')
    return dict(status='PASS',frame=188,hashes=h,nonopaqueRefused=True)
test('actual-pixels',real_pixels)
save('neighbors.json',dict(cases=results,passing=sum(r['status']=='PASS' for r in results),defects=sum(r['status']=='DEFECT_REPRODUCED' for r in results),nativeProcesses=0))
print(json.dumps(dict(passing=7,defectReproductions=0,finding='ACK failure remains unconfirmed')))
