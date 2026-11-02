"""Freeze the one reviewed esbuild native resolution gap; no runtime/package execution."""
import ast
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import datetime
import run_round4_remaining8 as caller

ROOT, BASE, OUT = caller.ROOT, caller.BASE, caller.FREEZE
HERE = Path(__file__).parent
PRIOR = BASE/'station_remaining8_ready02'


def binding(path):
    path=Path(path)
    return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}


def save(path,value):
    assert not path.exists(),path
    path.write_text(json.dumps(value,indent=2)+'\n')


assert binding(PRIOR/'readiness.json')['sha256']=='02bf879ca6c94ff58a2101daa9a8024ca49a3adc04c9c7250db73f01c5d549e2'
assert binding(PRIOR/'inventory.json')['sha256']=='6c1ce2c13a01e3db3a144cd6622043e73c0c2755ff9175ce78da4db803a3003c'
assert not caller.READY.exists() and not caller.GRANT.exists() and not (OUT/'consumed_grants').exists()
for row in json.loads((PRIOR/'inventory.json').read_text())['files']:assert binding(row['path'])['sha256']==row['sha256']
# All caller functions/classes are exact; only its new freeze path changed.
def functions(path):return [ast.dump(n) for n in ast.parse(path.read_text()).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))]
assert functions(HERE/'run_round4_remaining8.py')==functions(PRIOR/'frozen_sources/run_round4_remaining8.py')
before_source=(PRIOR/'frozen_sources/resolve_round4_station_routes.mjs').read_text()
after_source=(HERE/'resolve_round4_station_routes.mjs').read_text()
old="  add(path.join(root, 'package.json'), 'tsx'); add(tsx, 'esbuild');"
new="  add(path.join(root, 'package.json'), 'tsx');\n  const esbuild = add(tsx, 'esbuild');\n  add(esbuild, '@esbuild/darwin-arm64/bin/esbuild', ['require']);"
assert after_source==before_source.replace(old,new) and before_source.count(old)==1
ready=json.loads((PRIOR/'readiness.json').read_text())
changed={str(HERE/n) for n in ['run_round4_remaining8.py','resolve_round4_station_routes.mjs']}
for path,expected in ready['input_sha256'].items():
    if path not in changed:assert binding(path)['sha256']==expected,path
config=PRIOR/'route_config_node26.json'
argv=[ready['logical_routes']['snapshot']['path']]
node=ready['route_verify_argv'][0]
route_argv=[node,'--experimental-import-meta-resolve',str(HERE/'resolve_round4_station_routes.mjs')]
result=subprocess.run(route_argv+['--collect',str(config)],capture_output=True,text=True,cwd=ROOT,timeout=10)
save(OUT/'installed_route_collect_command.json',{'argv':route_argv+['--collect',str(config)],'exit':result.returncode,'stderr':result.stderr})
assert result.returncode==0
routes=json.loads(result.stdout);assert routes['forbiddenCalls']==[]
save(OUT/'resolution_routes.json',routes)
native=[r for r in routes['modules'] if r['specifier']=='@esbuild/darwin-arm64/bin/esbuild']
assert len(native)==1 and native[0]['mode']=='require'
selected=native[0]['entry']
assert ready['process_binary_sha256'][selected['resolved']]==selected['sha256'], 'Native allowlist may not expand'
assert native[0]['logicalPackages'] and native[0]['logicalPackages'][0]['links']
assert ready['stages']==caller.original_stages()
controls=json.loads((OUT/'native_controls04/native_route_gap.json').read_text())
before=json.loads((OUT/'before/native_route_gap.json').read_text())
assert before['collector_snapshot_equal'] and before['old_target_bytes_unchanged']
assert not controls['collector_snapshot_equal'] and controls['old_target_bytes_unchanged'] and controls['all4_controls_pass']
assert before['fixture_root_absent'] and controls['fixture_root_absent']
assert not Path(before['fixture_root']).exists() and not Path(controls['fixture_root']).exists()
verify=route_argv+['--verify',str(OUT/'resolution_routes.json')]
verified=subprocess.run(verify,capture_output=True,text=True,cwd=ROOT,timeout=10)
save(OUT/'installed_route_verify_command.json',{'argv':verify,'exit':verified.returncode,'stdout':verified.stdout,'stderr':verified.stderr})
assert verified.returncode==0
names=['run_round4_remaining8.py','resolve_round4_station_routes.mjs','test_round4_native_route.py','freeze_round4_native_route.py']
frozen=OUT/'frozen_sources';frozen.mkdir(exist_ok=False)
for name in names:
    shutil.copy2(HERE/name,frozen/name);assert binding(HERE/name)['sha256']==binding(frozen/name)['sha256']
inputs=ready['input_sha256'];inputs.update({str(HERE/n):binding(HERE/n)['sha256'] for n in names})
inputs[str(OUT/'resolution_routes.json')]=binding(OUT/'resolution_routes.json')['sha256']
inputs[selected['resolved']]=selected['sha256']
inputs[native[0]['packageJson']['resolved']]=native[0]['packageJson']['sha256']
ready.update(status='CPU_READY_FOR_NARROW_ESBUILD_NATIVE_ROUTE_REVIEW',source_parent='5c5a502aaaf1262ce32026b61f46687992ff1260',
    future_grant_file=str(caller.GRANT),route_verify_argv=verify,source_bindings=[binding(HERE/n) for n in names],
    prior_focused_controls_reused_not_rerun=ready['focused_controls'],
    focused_controls=[binding(OUT/p) for p in ['before/native_route_gap.json','native_controls04/native_route_gap.json',
        'native_controls04/missing_native_stderr.txt','installed_route_verify_command.json','entry_absent_grant.txt']],
    native_route_correction={'scope':'Exact createRequire(resolved esbuild JS entry).resolve(@esbuild/darwin-arm64/bin/esbuild)',
        'module':native[0],'current_native_binary_allowlist_unchanged':True,
        'runtime_observation_limit':'250ms process samples do not establish every historical executable; exact native selection is now checked before launch',
        'only_route_collector_delta':'Capture esbuild JS entry and add one require-mode native module route',
        'review_preservation':binding(OUT/'review_preservation.json'),
        'parent_verdict_verbatim':binding(OUT/'parent_verdict_verbatim.txt'),
        'new_controls':4,'unchanged_broad_suites_repeated':False},
    current_parent_authorization='CPU correction only. Marker capture owns GPU; fresh review and separate parent grant required')
ready['logical_routes'].update(snapshot=binding(OUT/'resolution_routes.json'),module_resolutions=len(routes['modules']),concrete_paths=len(routes['paths']))
ready['history_references_not_recopied'] += [binding(PRIOR/p) for p in ['readiness.json','inventory.json','final_cpu_audit.json']]
caller.validate_plan(ready)
save(caller.READY,ready)
save(OUT/'inventory.json',{'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'files':[binding(p) for p in sorted(OUT.rglob('*')) if p.is_file() and not p.is_symlink()]})
print(json.dumps({'readiness':binding(caller.READY),'inventory':binding(OUT/'inventory.json'),
    'runner':binding(HERE/'run_round4_remaining8.py'),'routes':binding(HERE/'resolve_round4_station_routes.mjs'),
    'bindings':len(inputs),'module_resolutions':len(routes['modules']),'native_selection':selected,'new_controls':4},indent=2))
