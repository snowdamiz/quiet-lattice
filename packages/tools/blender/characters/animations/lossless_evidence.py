"""Bounded CPU-only lossless RGB evidence proof over existing pilot PNGs."""
import argparse,hashlib,json,os,re,resource,shutil,subprocess,sys,time
from fractions import Fraction
from pathlib import Path
from PIL import Image
sys.dont_write_bytecode=True
HELPERS={'round4_job_boundary.py':'3f5ca99841be6a2ab4218bd45c5e44c5bb368e331d4b323b906b25354baa444c',
 'round4_capture_children.py':'e6bca98d53ce502a4115a6220a2aa78b27b3ab9ee1383c30165c274aaabb1f07',
 'run_round4_browser_proof.py':'f550d2e70238c9ff5527a4316833b83a38cdcf519273ed4b366491a936961fab'}
SUPPORT=Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/blend/stations/_authoring')
EXEC='''import os,resource,sys
resource.setrlimit(resource.RLIMIT_FSIZE,(int(sys.argv[2]),int(sys.argv[2])))
with open(sys.argv[1],'xb',buffering=0) as stream:
 print('Native raw output is retained at '+sys.argv[1],flush=True)
 os.dup2(stream.fileno(),1);os.dup2(stream.fileno(),2)
 os.execve(sys.argv[3],sys.argv[3:],os.environ)
'''
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n')
def opaque_rgb(im):
    assert im.mode in ['RGB','RGBA'] and im.size==(1920,1080),'Unsupported original pixel format'
    if im.mode=='RGBA':assert im.getchannel('A').getextrema()==(255,255),'Nonopaque alpha refused; RGB-only codec cannot preserve it'
    return im.convert('RGB').tobytes()
def main():
    p=argparse.ArgumentParser();p.add_argument('--source-run',type=Path,required=True);p.add_argument('--stage',default='motion-thalune-lod0')
    p.add_argument('--first',type=int,default=15);p.add_argument('--frames',type=int,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--hand-reference',type=Path);a=p.parse_args()
    assert 1<=a.frames<=132 and a.first>=0
    out=a.out.absolute();assert out.parent==Path('/private/tmp') and not out.exists();out.mkdir(mode=0o700)
    assert all(sha(SUPPORT/n)==v for n,v in HELPERS.items()),'Accepted StationJob/helper drift'
    sys.path.insert(0,str(SUPPORT))
    from round4_job_boundary import StationJob,deadline,identity,kernel_tasks,coalition_members
    from run_round4_browser_proof import create_private_tmp,preserve_private_tmp,executable_path
    ff=Path(shutil.which('ffmpeg')).resolve();probe=Path(shutil.which('ffprobe')).resolve();bins={str(f):sha(f) for f in [ff,probe,Path(executable_path(os.getpid())),Path('/usr/bin/caffeinate')]}
    assert shutil.disk_usage(out).free>=6*1024**3,'Require bounded output room plus4GiB free'
    sequence=json.loads((a.source_run/'stages'/a.stage/'capture/sequence-index.json').read_text())
    work=sequence['work'][a.first:a.first+a.frames];assert len(work)==a.frames and len({w['reel'] for w in work})==1
    assert all(w['ordinal']==a.first+i and w['frame']==work[0]['frame']+i for i,w in enumerate(work))
    source=a.source_run/'stages'/a.stage/'capture/images';sources=[];jobs=[];started=time.monotonic()
    for i,w in enumerate(work):
        file=source/f"{w['ordinal']:04}.png"
        with Image.open(file) as im:
            rgb=opaque_rgb(im);rgba=im.convert('RGBA').tobytes();mode=im.mode
        sources.append({'work':w,'path':str(file),'pngBytes':file.stat().st_size,'pngSha256':sha(file),'originalMode':mode,
            'alpha':'opaque255' if mode=='RGBA' else 'absent','rgbSha256':hashlib.sha256(rgb).hexdigest(),
            'rgbaSha256':hashlib.sha256(rgba).hexdigest(),'mediaPts':i*1000,'mediaTimeBase':'1/60000'})
    rejected=False
    try:opaque_rgb(Image.new('RGBA',(1920,1080),(1,2,3,254)))
    except AssertionError:rejected=True
    assert rejected
    save(out/'source-frames.json',sources)
    def native(name,argv,file_limit,capture=120):
        d=out/name;d.mkdir();script=d/'native-exec.py';script.write_text(EXEC);raw=d/'native-output.log';job=private=admission=None;t=time.monotonic()
        receipt={'nativeArgv':argv,'wrapperArgv':[sys.executable,str(script),str(raw),str(file_limit),*argv],
            'captureSeconds':capture,'cleanupSeconds':20,'maxFileBytes':file_limit,'primaryFailure':None,'cleanupFailure':None}
        try:
            with deadline(capture):
                private,admission=create_private_tmp(d/'private-tmp-admission.json')
                job=StationJob.__new__(StationJob);StationJob.__init__(job,d/'owned-job',receipt['wrapperArgv'],str(out),capture_seconds=capture,
                    env={'PATH':os.environ['PATH'],'TMPDIR':str(private)+'/'})
                job.state.update(scope='T02_CPU_LOSSLESS_RGB_EVIDENCE_NO_RENDERING');job.save();job.start()
                def observe():
                    for row in job.members():
                        file=executable_path(row['pid']);assert file in bins and sha(file)==bins[file],'Unbound native executable'
                receipt['outcome']=job.wait(max(.001,capture-(time.monotonic()-t)),observe)
                assert receipt['outcome']=='completed' and job.state['exits'].get('capture')==0,'Native command failed'
        except BaseException as e:receipt['primaryFailure']={'type':type(e).__name__,'message':str(e)}
        finally:
            try:
                with deadline(20):
                    assert job is not None and job.coalition_id
                    state=job.drain(20);assert state['drained'] and state['clean'] and kernel_tasks(job.coalition_id)['live']==0 and not coalition_members(job.coalition_id)
                    job.archive(profile_namespace=private,profile_prefixes=('playwright_chromiumdev_profile-',))
                    release=preserve_private_tmp(private,admission,job.out/'preserved-private-tmp',job=job)
                    assert release['all_bytes_preserved'] and release['namespace_removed'] and not private.exists() and not job.scratch.exists()
                    assert all(identity(int(pid)) is None or identity(int(pid))['birth']!=old['birth'] for pid,old in job.known.items())
                    registration=subprocess.run(['/bin/launchctl','print',job.target],capture_output=True,text=True,timeout=3);assert registration.returncode!=0
                    receipt['terminal']={'coalition':job.coalition_id,'kernel':kernel_tasks(job.coalition_id),'exactBirthsAbsent':len(job.known),'registrationAbsent':True,'scratchAndTmpAbsent':True}
            except BaseException as e:receipt['cleanupFailure']={'type':type(e).__name__,'message':str(e)}
        receipt['pipelineSeconds']=time.monotonic()-t;receipt['rawOutputSha256']=sha(raw) if raw.exists() else None
        if raw.exists():
            m=re.search(r'bench: utime=([0-9.]+)s stime=([0-9.]+)s rtime=([0-9.]+)s',raw.read_text(errors='replace'))
            receipt['nativeReportedSeconds']=dict(zip(['user','system','wall'],map(float,m.groups()))) if m else None
        save(d/'receipt.json',receipt);jobs.append({'path':str(d/'receipt.json'),'sha256':sha(d/'receipt.json'),**receipt})
        assert receipt['primaryFailure'] is None and receipt['cleanupFailure'] is None,receipt
        return raw
    video=out/'lossless-rgb.mp4';raw=out/'decoded.rgb';pixels=1920*1080*3
    encode=[str(ff),'-n','-hide_banner','-nostdin','-loglevel','info','-benchmark','-xerror','-hwaccel','none','-threads','1','-filter_threads','1','-filter_complex_threads','1',
        '-framerate','60','-start_number',str(a.first),'-i',str(source/'%04d.png'),'-frames:v',str(a.frames),'-fps_mode','passthrough','-an','-c:v','libx264rgb','-preset','medium','-crf','0','-pix_fmt','rgb24','-threads','1','-g','60','-bf','0','-sc_threshold','0','-video_track_timescale','60000','-movflags','+faststart',str(video)]
    native('encode',encode,512*1024**2)
    metadata=native('probe',[str(probe),'-v','error','-threads','1','-select_streams','v:0','-show_streams','-show_packets','-count_packets','-of','json',str(video)],2*1024**2,30)
    info=json.loads(metadata.read_text());s=info['streams'][0];packets=info['packets']
    assert s['codec_name']=='h264' and s['pix_fmt']=='gbrp' and s['color_space']=='gbr'
    assert s['time_base']=='1/60000' and s['r_frame_rate']==s['avg_frame_rate']=='60/1' and int(s['nb_frames'])==a.frames
    assert [int(v['pts']) for v in packets]==[i*1000 for i in range(a.frames)] and all(int(v['duration'])==1000 for v in packets)
    decode=[str(ff),'-n','-hide_banner','-nostdin','-loglevel','info','-benchmark','-xerror','-err_detect','explode','-hwaccel','none','-threads','1','-filter_threads','1','-filter_complex_threads','1']
    tail=['-map','0:v:0','-fps_mode','passthrough','-an','-c:v','rawvideo','-pix_fmt','rgb24','-threads','1','-f','rawvideo']
    native('decode',[*decode,'-i',str(video),'-frames:v',str(a.frames),*tail,str(raw)],a.frames*pixels)
    assert raw.stat().st_size==a.frames*pixels
    with raw.open('rb') as stream:
        for row in sources:
            decoded=stream.read(pixels)
            with Image.open(row['path']) as im:
                assert decoded==opaque_rgb(im),'RGB byte mismatch'
                assert Image.frombytes('RGB',im.size,decoded).convert('RGBA').tobytes()==im.convert('RGBA').tobytes(),'RGBA byte mismatch'
            row['exactRgbAndRgbaPixelEquality']=True;assert sha(row['path'])==row['pngSha256']
        assert not stream.read(1)
    target=a.frames//2;anchor=target//60;relative=target-anchor*60;seek=out/'seek.rgb'
    native('seek',[*decode,'-ss',str(anchor),'-i',str(video),'-vf',f'select=eq(n\\,{relative})','-frames:v','1',*tail,str(seek)],pixels)
    with Image.open(sources[target]['path']) as im:assert seek.read_bytes()==opaque_rgb(im),'Seek returned wrong source frame'
    hand_equal=None
    if a.hand_reference:
        hand=json.loads(a.hand_reference.read_text());assert hand['frames']==a.frames
        assert [r['pngSha256'] for r in hand['sourceFrames']]==[r['pngSha256'] for r in sources]
        hand_equal=sha(video)==hand['encodedSha256'];assert hand_equal,'Hand-command container bytes changed'
    save(out/'pixel-proof.json',{'status':'PASS_LOSSLESS_RGB_PIXEL_TIMEBASE_AND_SEEK','frames':a.frames,'sourceFrames':sources,'video':{'path':str(video),'bytes':video.stat().st_size,'sha256':sha(video)},
        'originalPngBytes':sum(r['pngBytes'] for r in sources),'decodedRgbBytes':raw.stat().st_size,'decodedRgbSha256':sha(raw),'seekSourceIndex':target,
        'stream':s,'timebase':'1/60000','sampleRate':'60/1','nonopaqueAlphaRefusalControl':True,'alphaPolicy':'Accept RGB or fully opaque RGBA only. Original alpha255 is verified per frame; reconstructing alpha255 matches each original RGBA pixel. Nonopaque input stops before encoding.',
        'binarySha256':bins,'acceptedHelperSha256':HELPERS,'jobs':jobs,'handCommandContainerBytesEqual':hand_equal,'elapsedProofPipelineSeconds':time.monotonic()-started,
        'limits':['Software FFmpeg decoder compatibility and one seek only; browser/QuickTime playback not tested','PNG file bytes/metadata are not recreated, decoded pixel bytes are exact','Single bounded sample, not a production throughput or full-library compression guarantee','No browser/GPU/hardware encoder or fresh rendering','Existing joint-cap/gap concern remains for art review; no cause assigned']})
    print(json.dumps({'out':str(out),'frames':a.frames,'pngBytes':sum(r['pngBytes'] for r in sources),'encodedBytes':video.stat().st_size,'status':'PASS_LOSSLESS_RGB_PIXEL_TIMEBASE_AND_SEEK','proofSha256':sha(out/'pixel-proof.json')}))
if __name__=='__main__':main()
