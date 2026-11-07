from pathlib import Path
import hashlib,io,json,os,resource,signal,subprocess,sys,threading,time,traceback
sys.dont_write_bytecode=True
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';O=Path(__file__).parent
sys.path.insert(0,str(A));import native189_producer as producer
from PIL import Image
READY=json.loads((A/'readiness.json').read_text());FF='/opt/homebrew/Cellar/ffmpeg/9.0.2/bin/ffmpeg'
assert hashlib.sha256(Path(FF).read_bytes()).hexdigest()==READY['process_binary_sha256'][FF]

def local_motion(i):
    png,_=producer.diagnostic(0);im=Image.open(io.BytesIO(png)).convert('RGB')
    w,h=384,576;data=bytearray(w*h*3)
    for y in range(h):
        row=bytearray(w*3);row[0::3]=bytes((x+3*i)%256 for x in range(w));row[1::3]=bytes([(y+5*i)%256])*w;row[2::3]=bytes(((x//32)^(y//32)^i)&255 for x in range(w));data[y*w*3:(y+1)*w*3]=row
    im.paste(Image.frombytes('RGB',(w,h),bytes(data)),(640+4*(i%61),220+(i%31)))
    return im.tobytes()

def save(p,v):
    with p.open('x') as f:json.dump(v,f,indent=2)

def ps():
    r=subprocess.run(['/bin/ps','-axo','pid=,ppid=,pgid=,rss=,lstart=,comm='],capture_output=True,text=True,timeout=2,check=True)
    rows=[]
    for line in r.stdout.splitlines():
        p=line.split(None,9)
        if len(p)==10:rows.append(dict(pid=int(p[0]),ppid=int(p[1]),pgid=int(p[2]),rssBytes=int(p[3])*1024,birth=' '.join(p[4:9]),command=p[9]))
    return rows

all_results=[]
for name,cap in [('localized-motion-candidate',8*1024**2)]:
    D=O/name;D.mkdir();video=D/'primary.mp4';log=D/'encoder.raw.log'
    argv=json.loads(Path('/private/tmp/t02-native189-r04-20261107-t3-11167406/proof/jobs/native-189-encode/native/encoder-command.json').read_text())['argv']
    argv=argv.copy();argv[argv.index('-frames:v')+1]='16';argv[-1]=str(video)
    save(D/'command.json',dict(argv=argv,capBytes=cap,maxFrames=16,seconds=60,rssBytes=2*1024**3,noPngOrRawSpool=True,ffmpegSha256=READY['process_binary_sha256'][FF]))
    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE,(cap,cap));resource.setrlimit(resource.RLIMIT_CPU,(55,55));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    start=time.monotonic();p=None;writer=None;facts=[];frames=[];writer_errors=[];failure=None;terminal=None;birth=None
    def write_frames():
        try:
            for i in range(16):
                if p.poll() is not None:raise RuntimeError('Encoder terminated before frame '+str(i))
                if name=='entropy-cap-negative':
                    png,hashes=producer.diagnostic(i);im=Image.open(io.BytesIO(png)).convert('RGB');rgb=im.tobytes()
                else:rgb=local_motion(i)
                frames.append(dict(ordinal=i,rgbSha256=hashlib.sha256(rgb).hexdigest(),bytes=len(rgb),writeCompleted=False))
                p.stdin.write(rgb);p.stdin.flush();frames[-1]['writeCompleted']=True
        except BaseException as e:writer_errors.append(dict(type=type(e).__name__,message=str(e),traceback=traceback.format_exc()))
        finally:
            try:p.stdin.close()
            except BaseException as e:writer_errors.append(dict(type=type(e).__name__,message=str(e)))
    try:
        with log.open('xb',buffering=0) as stream:
            p=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=limits,env={**os.environ,'PATH':READY['pathEnvironment']})
            assert os.getpgid(p.pid)==p.pid
            writer=threading.Thread(target=write_frames,daemon=True);writer.start()
            while True:
                rows=ps();owned=[r for r in rows if r['pgid']==p.pid or r['pid']==os.getpid() or r['ppid']==os.getpid()]
                subject=[r for r in owned if r['pid']==p.pid]
                terminal=p.poll()
                facts.append(dict(seconds=time.monotonic()-start,owned=owned,rssBytes=sum(r['rssBytes'] for r in owned),observedReturncode=terminal))
                if subject and terminal is None:
                    if birth is None:birth=subject[0]['birth']
                    assert subject[0]['birth']==birth and subject[0]['ppid']==os.getpid() and subject[0]['command']==FF
                assert all(r['pid']==p.pid for r in owned if r['pgid']==p.pid),'Unexpected group descendant'
                total=sum(r['rssBytes'] for r in owned);facts[-1]['rssBytes']=total
                assert total<=2*1024**3,'Aggregate RSS ceiling'
                assert time.monotonic()-start<56,'Finite diagnostic deadline'
                assert sum(q.stat().st_size for q in O.rglob('*') if q.is_file())<=30*1024**2,'Combined output headroom'
                terminal=p.poll()
                if terminal is not None:break
                time.sleep(.1)
    except BaseException as e:failure=dict(type=type(e).__name__,message=str(e),traceback=traceback.format_exc())
    finally:
        if p is not None and p.poll() is None:
            # While this owned child is unreaped its PID/group cannot be reused.
            os.killpg(p.pid,signal.SIGTERM)
            try:p.wait(timeout=1)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=2)
        if writer is not None:writer.join(timeout=2)
        terminal=None if p is None else p.poll()
        remaining=[] if p is None else [r for r in ps() if r['pgid']==p.pid or r['pid']==p.pid]
        result=dict(name=name,returncode=terminal,signal=signal.Signals(-terminal).name if terminal is not None and terminal<0 else None,seconds=time.monotonic()-start,frames=frames,writerErrors=writer_errors,primaryFailure=failure,ownedPid=None if p is None else p.pid,ownedPgid=None if p is None else p.pid,writerAlive=False if writer is None else writer.is_alive(),remainingOwned=remaining,releaseProved=not remaining and terminal is not None and not writer.is_alive(),peakSampledAggregateRSS=max((r['rssBytes'] for r in facts),default=0),rssObservations=facts,mediaBytes=video.stat().st_size if video.exists() else 0,mediaSha256=hashlib.sha256(video.read_bytes()).hexdigest() if video.exists() else None,rawLogBytes=log.stat().st_size,rawLogSha256=hashlib.sha256(log.read_bytes()).hexdigest())
        save(D/'result.json',result);all_results.append(result)
    print(json.dumps({k:result[k] for k in ['name','returncode','signal','seconds','releaseProved','peakSampledAggregateRSS','mediaBytes','rawLogBytes']}),flush=True)
    assert result['releaseProved'] and failure is None
    if name=='entropy-cap-negative':assert terminal==-signal.SIGXFSZ and result['mediaBytes']==cap
    else:assert terminal==0 and len(frames)==16 and all(r['writeCompleted'] for r in frames)
all_results.insert(0,json.loads((O/'entropy-cap-negative/result.json').read_text()))
save(O/'probe-phase.json',dict(status='COMPLETE_SLOT_RELEASED_WITH_FIRST_DRIVER_OBSERVER_FAILURE_RETAINED',probes=2,allOwnedReleased=all(r['releaseProved'] for r in all_results),outputsBytes=sum(q.stat().st_size for q in O.rglob('*') if q.is_file()),native189Run=False,results=[{k:v for k,v in r.items() if k not in ['rssObservations','frames']} for r in all_results]))
