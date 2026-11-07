"""Real file replacement and read-byte instrumentation; no native boundaries."""
import sys
sys.dont_write_bytecode=True
import argparse, hashlib, json, os, tempfile
from pathlib import Path
from unittest.mock import patch
import admission_json as metadata
import native189

ROOT=Path(tempfile.mkdtemp(prefix='t02-json-controls-',dir='/tmp')).resolve()
ROWS=[]

def run(mode):
    path=ROOT/(mode+'.json')
    failed=dict(primaryFailure={'type':'ORIGINAL_FAILURE','unknown':{'keep':17}},cleanupFailure=None,persistenceFailures=[],outcome='completed',exits={'capture':0},terminal=dict(registrationAbsent=True,scratchAndTmpAbsent=True,kernel=dict(live=0,coalition_absent=True)))
    good={**failed,'primaryFailure':None}
    raw=json.dumps(failed).encode();path.write_bytes(raw);expected=hashlib.sha256(raw).hexdigest()
    calls=[];original=os.fdopen
    if mode=='oversized':path.write_bytes(b'x'*(8*1024**2))
    if mode=='symlink':path.unlink();path.symlink_to(ROOT/'missing')
    if mode=='fifo':path.unlink();os.mkfifo(path)
    if mode=='exit-bool':path.write_text(json.dumps({**good,'exits':{'capture':False}}));expected=hashlib.sha256(path.read_bytes()).hexdigest()
    class Stream:
        def __init__(self,stream):self.stream=stream
        def __enter__(self):return self
        def __exit__(self,*args):return self.stream.__exit__(*args)
        def fileno(self):return self.stream.fileno()
        def read(self,n):
            if mode=='growth':
                with path.open('ab') as f:f.write(b'x'*(8*1024**2))
            value=self.stream.read(n);calls.append(dict(requested=n,returned=len(value)))
            if mode=='replace-after-read':
                replacement=path.with_suffix('.replacement');replacement.write_text(json.dumps(good));replacement.replace(path)
            return value
    error=None;retained=None
    with patch.object(metadata.os,'fdopen',lambda *args,**kwargs:Stream(original(*args,**kwargs))):
        try:
            retained=metadata.snapshot(path,expected)
            native189.require_native_release(retained['value'])
        except BaseException as caught:error={'type':type(caught).__name__,'message':str(caught),'details':vars(caught)}
    assert error is not None
    if mode in ['oversized','symlink','fifo']:assert calls==[]
    elif mode=='growth':assert calls==[dict(requested=metadata.LIMIT+1,returned=metadata.LIMIT+1)]
    else:assert len(calls)==1 and calls[0]['returned']<=metadata.LIMIT
    if mode=='replace-after-read':
        assert retained['sha256']==expected and retained['value']['primaryFailure']==failed['primaryFailure']
        assert json.loads(path.read_text())['primaryFailure'] is None
    return dict(mode=mode,path=str(path),reads=calls,error=error,snapshot=retained)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args()
    try:
        for mode in ['replace-after-read','oversized','growth','symlink','fifo','exit-bool','failed-receipt']:ROWS.append(run(mode))
    finally:
        with args.report.open('x') as f:json.dump(dict(controls=ROWS,count=len(ROWS),scratch=str(ROOT)),f,indent=2)
    print(json.dumps(dict(status='PASS',controls=len(ROWS),nativeJobs=0)))
if __name__=='__main__':main()
