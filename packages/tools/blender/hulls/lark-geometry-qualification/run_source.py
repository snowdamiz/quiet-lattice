"""Admitted read-only Blender stage on a fresh pinned disposable copy."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ap=argparse.ArgumentParser()
ap.add_argument('--source', required=True)
ap.add_argument('--glb', required=True)
ap.add_argument('--script', required=True)
ap.add_argument('--output', required=True)
ap.add_argument('extra', nargs=argparse.REMAINDER)
a=ap.parse_args()
base=Path(__file__).resolve().parent
out=Path(a.output).resolve()
def sha(p):
    with Path(p).open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()
expected={'blend':'d48d83e9c6a76b0214028a80389a77d6dfd19f65704c73ffc9f47dca58b244ba',
          'glb':'7cd5fed2661f96dd67b50c0a5f6d7df995be43d4adc57d327d35479d894a5e78'}
assert {'blend':sha(a.source),'glb':sha(a.glb)}==expected
processes=subprocess.check_output(['ps','-axo','comm='],text=True).splitlines()
assert not any(p.strip().endswith('/Contents/MacOS/Blender') for p in processes),'Blender lane occupied'
scratch=Path(tempfile.mkdtemp(prefix='lark-readonly-geometry-',dir='/private/tmp'))
copy=scratch/'lark-pinned.blend';shutil.copyfile(a.source,copy);copy.chmod(0o444)
assert sha(copy)==expected['blend']
cmd=[sys.executable,str(base/'bounded.py'),'--profile','blender','--private-tmp',str(scratch),
     '--receipt',str(out)+'.resource.json','--output-dir',str(out.parent),'--',
     '/Applications/Blender.app/Contents/MacOS/Blender','-b','-t','2','--factory-startup','--disable-autoexec',
     '--python-exit-code','1','--python',str(Path(a.script).resolve()),'--',
     '--source',str(copy),'--sha256',expected['blend'],'--output',str(out)]
cmd+=a.extra[1:] if a.extra and a.extra[0]=='--' else a.extra
with Path(str(out)+'.log').open('w') as log:
    result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
after={'blend':sha(a.source),'glb':sha(a.glb),'copy':sha(copy)}
processes=subprocess.check_output(['ps','-axo','comm='],text=True).splitlines()
remaining=[p for p in processes if p.strip().endswith('/Contents/MacOS/Blender')]
Path(str(out)+'.seal.json').write_text(json.dumps(dict(before=expected,after=after,assets_unchanged=after['blend']==expected['blend'] and after['glb']==expected['glb'] and after['copy']==expected['blend'],scratch=str(scratch),exit_code=result.returncode,remaining_blender_processes=remaining),indent=2)+'\n')
assert after['blend']==expected['blend'] and after['glb']==expected['glb'] and after['copy']==expected['blend']
assert not remaining,'Blender process remains'
print(json.dumps(dict(exit_code=result.returncode,output=str(out),scratch=str(scratch),processes_released=True)))
raise SystemExit(result.returncode)
