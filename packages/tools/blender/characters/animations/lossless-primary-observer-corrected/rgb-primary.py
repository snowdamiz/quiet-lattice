"""Synchronous pixel-primary data worker; StationJob alone owns process lifecycle."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import argparse,hashlib,io,json,os,resource,struct,subprocess,sys
from pathlib import Path
from PIL import Image
import packet_budget as budget
SCHEMA='t02-lossless-rgb-primary/v1'
PIXELS=1920*1080
PNG_LIMIT=12*1024**2
VIDEO_LIMIT=512*1024**2
REPORT_LIMIT=2*1024**2

def digest(b):return hashlib.sha256(b).hexdigest()
def save(p,v):
    p=Path(p);data=(json.dumps(v,indent=2)+'\n').encode();assert len(data)<=REPORT_LIMIT
    with p.open('xb') as f:f.write(data)
def read_exact(stream,n):
    data=bytearray()
    while len(data)<n:
        part=stream.read(n-len(data));assert part,'Truncated source frame'
        data.extend(part)
    return bytes(data)
def pixels(png):
    assert len(png)<=PNG_LIMIT,'PNG byte ceiling'
    with Image.open(io.BytesIO(png)) as im:
        assert im.format=='PNG' and im.size==(1920,1080) and im.mode in ['RGB','RGBA'],'PNG pixel format refused'
        im.load()
        if im.mode=='RGBA':assert im.getchannel('A').getextrema()==(255,255),'Nonopaque alpha refused before encoder write'
        rgb=im.convert('RGB').tobytes();rgba=im.convert('RGBA').tobytes()
    return rgb,{'sourcePngBytes':len(png),'sourcePngSha256':digest(png),'rgbSha256':digest(rgb),'rgbaSha256':digest(rgba),
        'alphaPolicy':'verified-opaque255','sourcePngRetained':False,'width':1920,'height':1080}
def check_header(header,index,seen):
    assert set(header)=={'workId','mediaFrameOrdinal'} and isinstance(header['workId'],str) and header['workId'] not in seen
    assert type(header['mediaFrameOrdinal']) is int and header['mediaFrameOrdinal']==index,'Source frame order refused'

def encode(config,source=sys.stdin.buffer,ack=sys.stdout):
    assert config['schema']==SCHEMA and 1<=config['frameCount']<=132
    out=Path(config['video']);raw=Path(config['rawLog']);assert not out.exists() and not raw.exists()
    resource.setrlimit(resource.RLIMIT_FSIZE,(VIDEO_LIMIT,VIDEO_LIMIT))
    argv=[config['ffmpeg'],'-n','-hide_banner','-nostdin','-loglevel','error','-xerror','-f','rawvideo','-pixel_format','rgb24',
        '-video_size','1920x1080','-framerate','60','-i','pipe:0','-frames:v',str(config['frameCount']),'-fps_mode','passthrough',
        '-an','-c:v','libx264rgb','-preset','medium','-crf','0','-pix_fmt','rgb24','-threads','1','-filter_threads','1',
        '-filter_complex_threads','1','-g','60','-bf','0','-sc_threshold','0','-video_track_timescale','60000','-movflags','+faststart',str(out)]
    save(config['command'],{'argv':argv,'rawCombinedStdoutStderr':str(raw),'fileLimitBytes':VIDEO_LIMIT,'singleInFlight':True})
    child=None;seen=set();failure=None
    try:
        with raw.open('xb',buffering=0) as log:
            child=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT)
            for index in range(config['frameCount']):
                head_count,png_count=struct.unpack('>II',read_exact(source,8))
                assert 1<=head_count<=4096 and 1<=png_count<=PNG_LIMIT,'Framing byte ceiling'
                header=json.loads(read_exact(source,head_count));check_header(header,index,seen)
                png=read_exact(source,png_count);rgb,row=pixels(png)
                assert child.poll() is None,'Encoder exited before frame write'
                child.stdin.write(rgb);child.stdin.flush() # blocking write is the only queue; no next frame before ACK
                seen.add(header['workId']);print(json.dumps({'schema':SCHEMA,**header,**row}),file=ack,flush=True)
            assert not source.read(1),'Unexpected extra source frame'
            child.stdin.close();code=child.wait();assert code==0,f'Encoder exit {code}'
            assert 0<out.stat().st_size<=VIDEO_LIMIT
        save(config['result'],{'schema':SCHEMA,'accepted':True,'frames':len(seen),'videoBytes':out.stat().st_size,
            'videoSha256':digest(out.read_bytes()),'rawLogSha256':digest(raw.read_bytes())})
    except BaseException as e:
        failure={'type':type(e).__name__,'message':str(e)}
        save(config['result'],{'schema':SCHEMA,'accepted':False,'frames':len(seen),'primaryFailure':failure})
        # Do not kill/retry/wait under a fresh timeout. StationJob drains any surviving child.
        raise

def parse_framehash(text,rows,kind):
    assert [line for line in text.splitlines() if line.startswith('#tb')]==['#tb 0: 1/60'],'Framehash timebase refused'
    lines=[x for x in text.splitlines() if x and not x.startswith('#')]
    assert len(lines)==len(rows),'Decoded frame count refused'
    expected_size=PIXELS*(3 if kind=='rgb' else 4)
    for i,(line,row) in enumerate(zip(lines,rows)):
        fields=[x.strip() for x in line.split(',')];assert len(fields)==6
        assert [int(x) for x in fields[:5]]==[0,i,i,1,expected_size],'Decoded frame order/PTS/size refused'
        assert fields[5]==row[kind+'Sha256'],'Decoded pixel SHA mismatch'

def check_probe(info,count):
    assert len(info['streams'])==1
    s=info['streams'][0];packets=info['packets']
    assert s['codec_name']=='h264' and s['pix_fmt']=='gbrp' and s['color_space']=='gbr' and s['color_range']=='pc'
    assert [s['width'],s['height']]==[1920,1080]
    assert s['time_base']=='1/60000' and s['r_frame_rate']==s['avg_frame_rate']=='60/1'
    assert int(s['nb_frames'])==count and len(packets)==count
    assert [int(x['pts']) for x in packets]==[i*1000 for i in range(count)]
    assert [int(x['dts']) for x in packets]==[i*1000 for i in range(count)]
    assert all(int(x['duration'])==1000 for x in packets)

def validate(config):
    # Sequential native phases remain in this one unchanged StationJob cohort.
    sys.path.insert(0,config['helperDirectory'])
    from round4_job_boundary import deadline
    resource.setrlimit(resource.RLIMIT_FSIZE,(REPORT_LIMIT,REPORT_LIMIT))
    rows=json.loads(Path(config['frameMap']).read_text())['frames'];assert 1<=len(rows)<=132
    out=Path(config['output']);out.mkdir(exist_ok=False);raw_out=Path(config['nativeRawDirectory']);raw_out.mkdir(exist_ok=False);commands=[]
    def native(name,argv,seconds):
        raw=raw_out/(name+'.stdout');err=raw_out/(name+'.stderr');commands.append({'argv':argv,'stdout':str(raw),'stderr':str(err),'deadlineSeconds':seconds})
        save(raw_out/(name+'-command.json'),commands[-1])
        with raw.open('xb') as stdout,err.open('xb') as stderr,deadline(seconds):
            child=subprocess.Popen(argv,stdout=stdout,stderr=stderr)
            code=child.wait();assert code==0,f'{name} exit {code}'
        assert raw.stat().st_size<=REPORT_LIMIT and err.stat().st_size<=REPORT_LIMIT
        budget.write_bytes(config['packetRoot'],out/(name+'.stdout'),raw.read_bytes())
        budget.write_bytes(config['packetRoot'],out/(name+'.stderr'),err.read_bytes())
        budget.write_json(config['packetRoot'],out/(name+'-command.json'),commands[-1])
        return out/(name+'.stdout')
    try:
        meta=native('probe',[config['ffprobe'],'-v','error','-threads','1','-select_streams','v:0','-show_streams','-show_packets','-of','json',config['video']],30)
        check_probe(json.loads(meta.read_text()),len(rows))
        base=[config['ffmpeg'],'-n','-hide_banner','-nostdin','-loglevel','error','-xerror','-err_detect','explode','-hwaccel','none','-threads','1',
            '-filter_threads','1','-filter_complex_threads','1','-i',config['video'],'-map','0:v:0','-fps_mode','passthrough','-an','-c:v','rawvideo']
        for kind,pix in [('rgb','rgb24'),('rgba','rgba')]:
            report=native(kind,[*base,'-pix_fmt',pix,'-threads','1','-f','framehash','-hash','sha256','pipe:1'],120)
            parse_framehash(report.read_text(),rows,kind)
        budget.write_json(config['packetRoot'],out/'validation.json',{'schema':SCHEMA,'accepted':True,'frames':len(rows),'everyRgbAndRgbaHash':True,'ordered60Hz':True,
            'rawRgbSpoolBytes':0,'videoSha256':digest(Path(config['video']).read_bytes()),'frameMapSha256':digest(Path(config['frameMap']).read_bytes()),
            'commands':commands})
    except BaseException as e:
        problem={'schema':SCHEMA,'accepted':False,'primaryFailure':{'type':type(e).__name__,'message':str(e)},'commands':commands}
        save(raw_out/'validation-failure.json',problem)
        budget.first_failure(config['packetRoot'],{'schema':SCHEMA,'phase':'validator','primaryFailure':problem['primaryFailure'],'completeNativeEvidence':str(raw_out)})
        raise

def main():
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['encode-png-stdio','validate-primary']);p.add_argument('config',type=Path);a=p.parse_args()
    config=json.loads(a.config.read_text())
    if a.mode=='encode-png-stdio':encode(config)
    else:validate(config)
if __name__=='__main__':main()
