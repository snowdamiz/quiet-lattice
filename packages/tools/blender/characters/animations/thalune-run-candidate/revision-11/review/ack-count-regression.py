from common import *
import sys,io
from unittest.mock import patch
sys.path.insert(0,str(A))
import native189_producer as producer
m=producer.worker();out=O/'ack-count-real-pixels';out.mkdir()
stream=producer.DiagnosticStream(read(A/'native189-plan.json')['diagnostic'])
config=dict(schema=m.SCHEMA,frameCount=189,maxVideoBytes=39354368,ffmpeg='/INERT/ffmpeg',video=str(out/'primary.mp4'),rawLog=str(out/'raw.log'),command=str(out/'command.json'),result=str(out/'result.json'))
failure=BrokenPipeError('ACK destination closed before first ACK write');calls=[]
class Pipe:
    def write(self,data):calls.append(['rgb-write',len(data)]);return len(data)
    def flush(self):calls.append(['rgb-flush'])
class Child:
    stdin=Pipe()
    def poll(self):calls.append(['poll']);return None if len(calls)==1 else -25
class Ack:
    def write(self,text):raise failure
    def flush(self):raise AssertionError('ACK flush must be unreachable')
with patch.object(m.resource,'setrlimit',lambda *a:None),patch.object(m.subprocess,'Popen',lambda *a,**k:Child()),patch.object(sys,'stderr',io.StringIO()):
    try:m.encode(config,source=stream,ack=Ack())
    except BaseException as e:
        assert e is failure
        evidence=e.mediaFailure
    else:raise AssertionError('ACK failure accepted')
assert calls==[['poll'],['rgb-write',1920*1080*3],['rgb-flush'],['poll']]
assert stream.ordinal==0 and stream.pending['mediaFrameOrdinal']==0
assert evidence['accepted'] is False and evidence['encoderTerminal']['returncode']==-25
reported=evidence['encoderTerminal']['observations'][-1]['framesAcknowledged']
save('ack-count-regression.json',dict(sourceSha256=sha(A/'rgb-primary.py'),actualAcknowledged=stream.ordinal,reportedAcknowledged=reported,pending=stream.pending,calls=calls,evidence=evidence,qualification='Actual default full-size localized DiagnosticStream and actual pixels(); only Popen and setrlimit ports are inert.'))
print(json.dumps(dict(actualAcknowledged=stream.ordinal,reportedAcknowledged=reported,accepted=evidence['accepted'],knownEncoderReturncode=-25)),flush=True)
assert reported==stream.ordinal,'Terminal evidence overstates ACKs: reported 1, actual 0'
