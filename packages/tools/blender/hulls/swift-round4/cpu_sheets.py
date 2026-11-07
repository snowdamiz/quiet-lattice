"""Standard turntable/material sheets, with the entire GPU discovery block replaced by CPU-only setup.
No shared script is edited. Only compact sheets remain; the standard composer deletes its temporary tiles.
"""
import os,sys,hashlib,json
from pathlib import Path
script=Path(__file__).resolve().parents[2]/'turntable.py';source=script.read_text()
start=source.index("try:\n    prefs = bpy.context.preferences.addons['cycles'].preferences")
end=source.index('scene.cycles.samples = samples',start)
assert "prefs.compute_device_type = 'METAL'" in source[start:end]
source=source[:start]+"scene.cycles.device = 'CPU'\nscene.cycles.denoising_use_gpu = False\nscene.render.threads_mode = 'FIXED'\nscene.render.threads = 2\n"+source[end:]
assert 'METAL' not in source and "scene.cycles.device = 'GPU'" not in source
os.environ['KTX']=str(Path(__file__).with_name('ktx_cpu.py'))
args=sys.argv[sys.argv.index('--')+1:];asset=Path(args[0]);job=Path(os.environ['SWIFT_JOB'])
assert args[args.index('--samples')+1]=='12' and float(args[args.index('--scale')+1])==.6, 'compact CPU evidence settings required'
(job/'input.json').write_text(json.dumps({'glbSha256':hashlib.sha256(asset.read_bytes()).hexdigest(),'stockScriptSha256':hashlib.sha256(script.read_bytes()).hexdigest(),'device':'CPU','samples':12,'scale':.6,'qualifiesEngine':False},indent=2))
print('SWIFT CPU SHEETS; GPU discovery removed',flush=True)
sys.stdout.reconfigure(line_buffering=True)
exec(compile(source,str(script),'exec'),{'__name__':'__main__','__file__':str(script)})
