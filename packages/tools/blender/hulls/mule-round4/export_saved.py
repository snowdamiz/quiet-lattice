"""Export only the saved Mule: stock validation/bake/LODs/compression, no authoring."""
import hashlib
import os
from pathlib import Path
import sys
import json
import shutil

sys.dont_write_bytecode=True
sys.stdout.reconfigure(line_buffering=True)
ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import export, bake, meshopt, core, ktx
sys.path.insert(0,str(Path(__file__).resolve().parent))
from export_identity import snapshot, compare, negative_controls
from checkpoint import check

# Reuse installed, byte-identical tooling read-only; no install, fetch or shared edits.
CACHE=Path('/Users/andreyyurlov/Documents/dev/space')
script=Path('packages/tools/src/art/meshopt.ts')
assert hashlib.sha256((ROOT/script).read_bytes()).digest()==hashlib.sha256((CACHE/script).read_bytes()).digest()
meshopt._command=lambda: [os.environ.get('ART_NODE','/opt/homebrew/bin/node'),str(CACHE/'node_modules/tsx/dist/cli.mjs'),str(CACHE/script)]
os.environ['KTX']=str(CACHE/'node_modules/.cache/ktx-software-4.4.2/bin/ktx')
os.environ['ART_KTX_JOBS']='1'
# Stock ktx uses cpu_count/jobs for encoder threads; pin its observed CPU count to the lane budget.
os.cpu_count=lambda: 2
ensure=bake.ensure_cycles
def cpu(scene,samples=16):
    ensure(scene,samples)
    scene.render.threads_mode='FIXED';scene.render.threads=2
bake.ensure_cycles=cpu
material_bake=bake.bake_material
def bounded_material(mat,*args,**kwargs):
    check('bake '+mat.name)
    return material_bake(mat,*args,**kwargs)
bake.bake_material=bounded_material
for module,name,label in [(export,'_write','write GLB'),(ktx,'compress','encode KTX2'),(meshopt,'compress','encode meshopt')]:
    original=getattr(module,name)
    def bounded(*args,_original=original,_label=label,**kwargs):
        check(_label)
        return _original(*args,**kwargs)
    setattr(module,name,bounded)
out=Path(os.environ['MULE_ATTEMPT'])

sys.path.insert(0, str(ROOT / "packages/tools/blender/hulls/mule-phase-instrumentation"))
from phase_log import PhaseLog, install

def mesh_counts(objects):
    triangles = 0
    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
    return (len(objects), triangles)

def resource_snapshot():
    # run.py publishes these limits before Popen. Missing/invalid input fails
    # immediately; no polling, fallback limits, or export retry.
    limits = json.loads((out / "launch-limits.json").read_text())
    # Same measurement checkpoint.check already uses. Do not call check() here.
    from run import resources
    state = resources()
    own = [row for row in state.pop("processes") if row[2] == os.getpgrp()]
    state["group_rss_kib"] = sum(row[3] for row in own)
    state["wall_limit_s"] = limits["wall_seconds"]
    state["rss_limit_kib"] = limits["rss_mib"] * 1024
    return state

phase_log = PhaseLog(out / "bake-phases.jsonl")
install(
    bake,
    phase_log,
    resources_of=resource_snapshot,
    counts_of=mesh_counts,
    variant_ids=("mule_husked", "mule_damaged", "mule"),
)

(out/'identity-controls.json').write_text(json.dumps({'rejected':negative_controls()},indent=2))
original_load=core.load
candidate=None

def failure(phase,exc):
    with (out/'export-failures.jsonl').open('a') as f:
        f.write(json.dumps({'phase':phase,'error':repr(exc),'candidate':candidate})+'\n')

def preserving_load(path,*args,**kwargs):
    global candidate
    if Path(path).suffix=='.glb':
        # Preserve before decoder or any check can throw and stock finally removes tmp.
        retained=out/'scratch/export-candidate.glb'
        with Path(path).open('rb') as src,retained.open('xb') as dst:shutil.copyfileobj(src,dst)
        candidate={'path':str(retained.relative_to(out)),'size':retained.stat().st_size,'sha256':hashlib.file_digest(retained.open('rb'),'sha256').hexdigest()}
        (out/'export-candidate.json').write_text(json.dumps(candidate,indent=2))
        try:
            check('decode GLB')
            return original_load(path,*args,**kwargs)
        except BaseException as exc:failure('decode',exc);raise
    check('load saved source')
    return original_load(path,*args,**kwargs)
core.load=preserving_load
original_checks=core.run_checks
source_geometry=None
def checks(rules,path,family,mode,**kwargs):
    global source_geometry
    try:
        report=original_checks(rules,path,family,mode,**kwargs)
        if mode=='source':
            check('snapshot complete source geometry')
            source_geometry=snapshot(rules,report.model)
        elif mode=='export':
            assert candidate is not None
            if report.status!='PASS':failure('stock-validation',report.status)
            check('compare complete decoded geometry')
            identity=compare(source_geometry,snapshot(rules,report.model))
            identity['source_sha256']=hashlib.sha256((ROOT/'assets/blend/hulls/mule.blend').read_bytes()).hexdigest()
            identity['export_sha256']=hashlib.sha256(Path(kwargs['glb']).read_bytes()).hexdigest()
            (out/'source-export-identity.json').write_text(json.dumps(identity,indent=2))
        return report
    except BaseException as exc:
        failure(mode+'-checks',exc)
        raise

core.run_checks=checks
if __name__=='__main__':
    sys.exit(export.main('hulls',['--only','mule','--out-dir',str(out/'scratch/export'),'--report-dir',str(out/'validation')]))
