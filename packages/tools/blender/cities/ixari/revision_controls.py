"""Bounded controls for revision runner accounting and disk admission; no Blender."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[5]
OUT=ROOT/'assets/blend/cities/ixari/revision-r1/resource-tests'
OUT.mkdir(exist_ok=False)
fixture=OUT/'fixture';scripts=fixture/'packages/tools/blender/cities/ixari';scripts.mkdir(parents=True)
for name in ('run_cpu.py','resource_controls.py'):shutil.copy2(Path(__file__).parent/name,scripts/name)
env=dict(os.environ,**{k:'2' for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','NUMEXPR_NUM_THREADS','BLIS_NUM_THREADS','TBB_NUM_THREADS','RAYON_NUM_THREADS','UV_THREADPOOL_SIZE')},PYTHONDONTWRITEBYTECODE='1')
command=[sys.executable,str(scripts/'resource_controls.py')]
with (OUT/'controls.log').open('x') as log:
    result=subprocess.run(command,cwd=fixture,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=45)
assert result.returncode==0
controls=json.loads((fixture/'assets/blend/cities/ixari/receipts/resource-controls.json').read_text())
(OUT/'resource-controls.json').write_text(json.dumps(controls,indent=2)+'\n')
module=runpy.run_path(str(scripts/'run_cpu.py'))
files=OUT/'accounting';files.mkdir();a=files/'original';a.write_bytes(b'x'*4096)
b=files/'hardlink';os.link(a,b);c=files/'symlink';c.symlink_to(a)
assert module['file_bytes']([a,b,c])==12288
assert module['file_bytes']([a,b,c],unique=True)==4096
code="import runpy,shutil,sys;shutil.disk_usage=lambda p:type('Disk',(),{'free':0})();sys.argv=['run_cpu.py','--attempt','control-disk','--seconds','5','--','python3','-c','raise RuntimeError(\"must not launch\")'];runpy.run_path(sys.argv[1] if False else "+repr(str(scripts/'run_cpu.py'))+",run_name='__main__')"
command2=[sys.executable,'-c',code]
with (OUT/'disk.log').open('x') as log:
    disk=subprocess.run(command2,cwd=fixture,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=15)
receipt=json.loads((fixture/'assets/blend/cities/ixari/receipts/control-disk/process.json').read_text())
assert disk.returncode==124 and 'disk admission' in receipt['stoppedBy'] and receipt['exitCode'] is None
review=Path('/tmp/p1-e10-t06-r1-2d23ecb3/adversarial.json')
producer_files=['packages/tools/blender/artlib/ktx.py','packages/tools/blender/artlib/meshopt.py','packages/tools/blender/cities/ixari/ktx_cpu.py']
report=dict(status='PASS',runnerSha256=hashlib.sha256((scripts/'run_cpu.py').read_bytes()).hexdigest(),
            commands=[dict(command=command,exitCode=result.returncode,log=str((OUT/'controls.log').relative_to(ROOT))),
                      dict(command=command2,exitCode=disk.returncode,log=str((OUT/'disk.log').relative_to(ROOT)),expectedFailure=True,last20Lines=(OUT/'disk.log').read_text().splitlines()[-20:])],
            uniqueByteAccounting=dict(logicalBytes=12288,uniqueBytes=4096,status='PASS'),diskAdmission=receipt,
            resourceControls=controls,
            processOwnership=dict(scope='process group only, not arbitrary detached descendants',
                reviewerSetsidEvidence=str(review),reviewerEvidenceSha256=hashlib.sha256(review.read_bytes()).hexdigest(),
                producerHashes={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in producer_files},
                evaluation='KTX and Meshopt use synchronous subprocess.run without a new session. ART_KTX_JOBS=1 serializes codecs; the task KTX wrapper execs the codec. No task producer requests setsid/detached children. Native internals and deliberately detached grandchildren are outside this guarantee; reviewer demonstrated that limitation and killed its test child.',
                detachedDescendantsReaped=False,claim='No universal process-tree reaping claim'))
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print('PASS: four runner controls, unique-object output accounting, disk refusal before launch; setsid limitation retained')
