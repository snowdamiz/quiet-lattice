"""Bound one CPU Blender process in this lane. Logs outside tracked source by default."""
import os
import signal
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[4]
mode=sys.argv[1]
logdir=ROOT/'.claude/pause/P1-E07-T14'
logdir.mkdir(parents=True,exist_ok=True)
commands={
 'author':['packages/tools/blender/effects/author.py'],
 'revise':['packages/tools/blender/effects/revise_spore.py'],
 'refine':['packages/tools/blender/effects/refine_textures.py'],
 'export':['packages/tools/blender/export_effects.py','--','--only','gravitic,thermal,resonance,symbiotic,void,recall','--report-dir',str(logdir/'validation')],
 'validate':['packages/tools/blender/validate.py','--','--report-dir',str(logdir/'validation')]+[str(p) for folder in ['assets/blend/effects','packages/client/public/models/effects'] for p in sorted((ROOT/folder).glob('*.blend' if 'blend' in folder else '*.glb'))],
 'audit':['packages/tools/blender/effects/audit.py'],
 'preview':['packages/tools/blender/effects/preview.py'],
}
args=commands[mode]+sys.argv[2:]
env=dict(os.environ,OMP_NUM_THREADS='2',OPENBLAS_NUM_THREADS='2',VECLIB_MAXIMUM_THREADS='2',ART_KTX_JOBS='1',CYCLES_DEVICE='CPU')
cached=ROOT/'node_modules/.cache/ktx-software-4.4.2/bin/ktx'
local=Path('/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx')
env['EFFECTS_KTX_BINARY']=env.get('KTX',str(cached if cached.exists() else local))
env['KTX']=str(Path(__file__).with_name('ktx_cpu.py'))
cmd=['/Applications/Blender.app/Contents/MacOS/Blender','-b','--factory-startup','-t','2','--python-exit-code','1','-P']+args
with (logdir/(mode+'.log')).open('w') as out:
    proc=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
    try:
        code=proc.wait(timeout=900)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid,signal.SIGTERM)
        try: proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid,signal.SIGKILL)
            proc.wait()
        code=124
print('COMMAND',cmd,'EXIT',code,'LOG',logdir/(mode+'.log'))
print('\n'.join((logdir/(mode+'.log')).read_text().splitlines()[-20:]))
sys.exit(code)
