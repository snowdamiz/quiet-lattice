"""Run the stock exporter into an immutable attempt; source remains authoritative.
Never imports author.py. Only promotes the GLB after stock validation and identity verification.
"""
import os,sys,json,hashlib,shutil
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
os.environ['KTX']=str(Path(__file__).with_name('ktx_cpu.py'))
sys.stdout.reconfigure(line_buffering=True)
from artlib import export, bake, meshopt
import bpy
job=Path(os.environ['SWIFT_JOB'])
source=ROOT/'assets/blend/hulls/swift.blend';before=hashlib.sha256(source.read_bytes()).hexdigest()
with (job/'input-source.json').open('x') as f:json.dump({'sha256':before,'bytes':source.stat().st_size},f,indent=2)
# The stock baker packs each completed map. Release only its reloadable decoded cache;
# check_packed_release.py proves exact texel identity for generated and actual packed images.
stock_bake=bake.bake_material
release_records=[]
def bake_and_release(*args,**kwargs):
    result=stock_bake(*args,**kwargs)
    released=[]
    for img in bpy.data.images:
        if img.packed_file and img.has_data:
            img.buffers_free();released.append(img.name)
    release_records.append({'material':args[0].name,'released':released})
    print('Released packed image caches:',len(released),flush=True)
    return result
bake.bake_material=bake_and_release
stock_compress=meshopt.compress
def compress_with_stage_record(src,dst,settings,log=print):
    stage=job/'encoded-stage.glb'
    assert not stage.exists()
    shutil.copyfile(src,stage)
    with stage.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    (job/'encoded-stage.json').write_text(json.dumps({'sourceSha256':before,'sha256':digest,'bytes':stage.stat().st_size,'status':'INTERMEDIATE_NOT_VALIDATED','purpose':'preserve completed bake/encode before compression; not imported into source or promoted'},indent=2))
    return stock_compress(src,dst,settings,log=log)
meshopt.compress=compress_with_stage_record
try:
    rc=export.main('hulls',['--only','swift','--out-dir',str(job/'models'),'--report-dir',str(job/'validation'),'--quiet'])
finally:
    bake.bake_material=stock_bake
    meshopt.compress=stock_compress
    with (job/'packed-cache-release.json').open('x') as f:json.dump(release_records,f,indent=2)

assert hashlib.sha256(source.read_bytes()).hexdigest()==before,'export modified source'
(job/'source-pin.json').write_text(json.dumps({'sha256':before,'bytes':source.stat().st_size,'stockExit':rc},indent=2))
sys.exit(rc)
