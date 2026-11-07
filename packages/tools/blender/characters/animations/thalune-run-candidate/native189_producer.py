"""189 diagnostic PNGs in memory, one frame until ACK; no retained PNG or RGB spool."""
import sys
sys.dont_write_bytecode = True
from assertion_guard import require_assertions
require_assertions(__debug__)
import argparse, hashlib, importlib.util, io, json, struct, subprocess
from pathlib import Path
from inspector import error_receipt
import contract, packet_budget as budget

PATTERN = 'R=(x+3*i)%256; G=(y+5*i)%256; B=((x//32)^(y//32)^i)&255'


def diagnostic(i, width=1920, height=1080):
    from PIL import Image
    assert type(i) is int and 0<=i<189 and 0<width<=1920 and 0<height<=1080
    # One row per y; the pixels are deliberately independent of the animation library.
    rgb = bytearray(width*height*3)
    for y in range(height):
        row = bytearray(width*3)
        row[0::3] = bytes((x+3*i)%256 for x in range(width))
        row[1::3] = bytes([(y+5*i)%256])*width
        row[2::3] = bytes(((x//32)^(y//32)^i)&255 for x in range(width))
        rgb[y*width*3:(y+1)*width*3] = row
    image = Image.frombytes('RGB',(width,height),bytes(rgb)).convert('RGBA')
    output=io.BytesIO();image.save(output,format='PNG',compress_level=1)
    return output.getvalue(), dict(sourcePngSha256=hashlib.sha256(output.getvalue()).hexdigest(),
        rgbSha256=hashlib.sha256(rgb).hexdigest(), rgbaSha256=hashlib.sha256(image.tobytes()).hexdigest())


class DiagnosticStream:
    def __init__(self, spec, produce=diagnostic):
        assert spec==dict(frames=189,width=1920,height=1080,fps=60,alpha=255,pattern=PATTERN)
        self.produce=produce;self.ordinal=0;self.pending=None;self.buffer=b'';self.rows=[];self.ack_text=''

    def read(self, count):
        assert 0<count<=12*1024**2
        if not self.buffer:
            assert self.pending is None, 'A frame is still awaiting ACK'
            if self.ordinal==189:return b''
            png,hashes=self.produce(self.ordinal)
            header=dict(workId=f'native-189/diagnostic/{self.ordinal:04}',mediaFrameOrdinal=self.ordinal)
            encoded=json.dumps(header).encode()
            self.pending={**header,**hashes}
            self.buffer=struct.pack('>II',len(encoded),len(png))+encoded+png
        data,self.buffer=self.buffer[:count],self.buffer[count:]
        return data

    def write(self, text):
        self.ack_text+=text
        assert len(self.ack_text)<=4096,'ACK ceiling'
        if '\n' in self.ack_text:
            line,rest=self.ack_text.split('\n',1);assert not rest and not self.buffer and self.pending is not None
            ack=json.loads(line)
            for name,value in self.pending.items():assert ack[name]==value,'ACK mismatch: '+name
            assert ack['schema']==contract.SCHEMA and ack['width']==1920 and ack['height']==1080
            assert ack['alphaPolicy']=='verified-opaque255' and ack['sourcePngRetained'] is False
            self.rows.append({**ack,'mediaPts':self.ordinal*1000,'mediaTimeBase':'1/60000'})
            self.ordinal+=1;self.pending=None;self.ack_text=''
        return len(text)

    def flush(self):pass


def worker():
    spec=importlib.util.spec_from_file_location('native189_rgb_worker',Path(__file__).with_name('rgb-primary.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def encode(config, spec):
    module=worker();stream=DiagnosticStream(spec)
    module.encode(config,source=stream,ack=stream)
    assert stream.ordinal==189 and not stream.buffer and stream.pending is None and not stream.ack_text
    budget.write_json(config['packetRoot'],config['frameMap'],dict(schema=contract.SCHEMA,frames=stream.rows))
    result=json.loads(Path(config['result']).read_text())
    assert result['accepted'] is True and result['frames']==189
    assert result['videoSha256']==module.digest(Path(config['video']).read_bytes())


def validate(config):
    module=worker();module.validate(config)
    # Deliberately decode a looped 190th frame, in this same validator cohort.
    # The positive validator above must already have checked every RGB/RGBA hash.
    sys.path.insert(0,config['helperDirectory'])
    from round4_job_boundary import deadline
    out=Path(config['nativeRawDirectory'])
    argv=[config['ffmpeg'],'-n','-hide_banner','-nostdin','-loglevel','error','-xerror','-hwaccel','none',
          '-threads','1','-filter_threads','1','-filter_complex_threads','1','-stream_loop','1','-i',config['video'],
          '-map','0:v:0','-fps_mode','passthrough','-frames:v','190','-an','-c:v','rawvideo','-pix_fmt','rgb24',
          '-threads','1','-f','framehash','-hash','sha256','pipe:1']
    module.save(out/'surplus-command.json',dict(argv=argv,deadlineSeconds=120,maxFrames=190))
    with (out/'surplus.stdout').open('xb') as stdout,(out/'surplus.stderr').open('xb') as stderr,deadline(120):
        child=subprocess.Popen(argv,stdout=stdout,stderr=stderr)
        assert child.wait()==0,'Surplus decoder failed'
    text=(out/'surplus.stdout').read_text()
    assert len([line for line in text.splitlines() if line and not line.startswith('#')])==190,'Surplus control did not produce 190'
    rows=module.check_validation_config(config)
    try:module.parse_framehash(text,rows,'rgb')
    except AssertionError as error:
        assert str(error)=='Decoded frame count refused'
        refusal=error_receipt(error)
    else:raise AssertionError('Surplus control was accepted')
    budget.write_json(config['packetRoot'],Path(config['output'])/'surplus-refusal.json',dict(accepted=False,expectedRefusal=True,frames=190,failure=refusal))


def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['encode','validate']);parser.add_argument('config',type=Path)
    args=parser.parse_args()
    import native189
    ready=native189.load(native189.READY)
    assert ready['nativeFixtureAuthorization'] is True and ready['runtimeAuthorization'] is False,'NATIVE189_DISABLED'
    config_snapshot=native189.snapshot(args.config);config=config_snapshot['value']
    native189.verify_worker(ready,config,args.mode,args.config,config_snapshot)
    try:
        if args.mode=='encode':encode(config,native189.load(native189.PLAN)['diagnostic'])
        else:validate(config)
    except BaseException as error:
        worker().retain_failure(error,Path(config['nativeRawDirectory'])/'producer-failure.json',dict(accepted=False,mode=args.mode))
        raise

if __name__=='__main__':main()
