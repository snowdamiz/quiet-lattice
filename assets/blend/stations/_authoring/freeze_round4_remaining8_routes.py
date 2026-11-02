"""Freeze only the task-local logical route correction. No package code or capture runs."""
import ast
import copy
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import run_round4_remaining8 as caller

ROOT, BASE, OUT = caller.ROOT, caller.BASE, caller.FREEZE
HERE = Path(__file__).parent
PRIOR = BASE / 'station_remaining8_ready01'


def binding(path):
    path = Path(path)
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}


def save(path, value):
    assert not path.exists(), path
    path.write_text(json.dumps(value, indent=2) + '\n')


assert binding(PRIOR / 'readiness.json')['sha256'] == '209ae1d1cd736d936381d38bd9587c032af121d64f3b413607b7bc1a5fe7e3a6'
assert binding(PRIOR / 'inventory.json')['sha256'] == '6fb17221b8c7aed58fa2a97fe32a28272ae25bd5a708469101805d46004d18cc'
for row in json.loads((PRIOR/'inventory.json').read_text())['files']:
    assert binding(row['path'])['sha256'] == row['sha256'], row['path']
assert not caller.READY.exists() and not caller.GRANT.exists() and not (OUT/'consumed_grants').exists()
old_source = ast.parse((PRIOR/'frozen_sources/run_round4_remaining8.py').read_text())
new_source = ast.parse((HERE/'run_round4_remaining8.py').read_text())
for old in old_source.body:
    if isinstance(old,(ast.FunctionDef,ast.ClassDef)) and old.name != 'preflight':
        new = next(n for n in new_source.body if type(n) is type(old) and n.name == old.name)
        assert ast.dump(old) == ast.dump(new), old.name
ready = json.loads((PRIOR/'readiness.json').read_text())
for path, expected in ready['input_sha256'].items():
    if path != str(HERE/'run_round4_remaining8.py'): assert binding(path)['sha256'] == expected, path
routes = json.loads((OUT/'resolution_routes.json').read_text())
node = routes['config']['node']
argv = [node,'--experimental-import-meta-resolve',str(HERE/'resolve_round4_station_routes.mjs'),'--verify',str(OUT/'resolution_routes.json')]
result = subprocess.run(argv,cwd=ROOT,capture_output=True,text=True,timeout=10)
save(OUT/'route_verify_result.json',{'argv':argv,'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
assert result.returncode == 0 and routes['forbiddenCalls'] == []
controls = json.loads((OUT/'route_controls_final12_node26.json').read_text())
assert len(controls['results']) == 12 and all(r['status']=='PASS' for r in controls['results'])
assert controls['fixtureRootAbsent'] and not Path(controls['fixtureRoot']).exists()
log = (OUT/'admission_controls_final04.log').read_text()
assert 'Ran 4 tests' in log and log.rstrip().endswith('OK')
fixtures = json.loads((OUT/'admission_controls_final04/fixtures.json').read_text())
assert len(fixtures) == 4 and all(r['absent'] and not Path(r['root']).exists() for r in fixtures)

names = ['run_round4_remaining8.py','resolve_round4_station_routes.mjs','test_round4_station_routes.mjs',
         'test_round4_route_admission.py','freeze_round4_remaining8_routes.py']
freeze = OUT/'frozen_sources'; freeze.mkdir(exist_ok=False)
for name in names:
    shutil.copy2(HERE/name,freeze/name)
    assert binding(HERE/name)['sha256'] == binding(freeze/name)['sha256']
inputs = ready['input_sha256']
inputs.update({str(HERE/n):binding(HERE/n)['sha256'] for n in names})
inputs[str(OUT/'resolution_routes.json')] = binding(OUT/'resolution_routes.json')['sha256']
# Module/CLI receipt hashes supplement the unchanged old source/asset target bindings.
def add_targets(value):
    if isinstance(value,dict):
        if value.get('sha256') and value.get('resolved'):
            assert binding(value['resolved'])['sha256'] == value['sha256']
            inputs[value['resolved']] = value['sha256']
        for child in value.values(): add_targets(child)
    elif isinstance(value,list):
        for child in value: add_targets(child)
add_targets(routes)
ready.update(status='CPU_READY_FOR_FRESH_LOGICAL_ROUTE_REVIEW',source_parent='6a2be1e58088e0336221ee9a039b53f8e5e3a762',
    future_grant_file=str(caller.GRANT),route_verify_argv=argv,
    logical_routes={'snapshot':binding(OUT/'resolution_routes.json'),'module_resolutions':len(routes['modules']),
        'concrete_paths':len(routes['paths']),'per_stage':'preflight -> verify_routes; require_stage_admission re-runs preflight before every stage',
        'scope':'Concrete pnpm/shim/tsx, tools capture and supplement Playwright, client/capture Vite, nested core, esbuild, rolldown and client three routes; no broad package topology inventory',
        'cache_policy':routes['cachePolicy'],'generated_cache_children_pinned':False},
    source_bindings=[binding(HERE/n) for n in names],
    focused_controls=[binding(OUT/p) for p in ['route_controls_final12_node26.json','admission_controls_final04.log',
        'admission_controls_final04/fixtures.json','route_verify_result.json','entry_absent_grant.txt']],
    prior_focused_controls_reused_not_rerun=ready['focused_controls'],
    route_correction_provenance={'qa_pending_review_source':binding(Path('/private/tmp/characters-route-prep-20261102-hGpFaD/resolution-routes.mjs')),
        'marker_pending_review_source':binding(Path('/private/tmp/P1-E04-T06-ui-prep-r1-p7pkfltt/routes.mjs')),
        'acceptance_inferred':False},
    failed_fixture_limit='Initial same-process Node shadow fixture hit resolver cache. Raw source/stdout/stderr retained; final actual per-stage fresh-process queries reject shadow and exports retargets without executing packages.',
    current_parent_authorization='CPU route correction only; independent review and separate scheduled parent grant still required')
ready['history_references_not_recopied'] += [binding(PRIOR/p) for p in ['readiness.json','inventory.json','dependency_route_limit.json']]
caller.validate_plan(ready)
save(caller.READY,ready)
save(OUT/'inventory.json',{'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'files':[binding(p) for p in sorted(OUT.rglob('*')) if p.is_file() and not p.is_symlink()]})
print(json.dumps({'readiness':binding(caller.READY),'inventory':binding(OUT/'inventory.json'),
                  'runner':binding(HERE/'run_round4_remaining8.py'),'routes':binding(HERE/'resolve_round4_station_routes.mjs'),
                  'input_bindings':len(inputs),'new_controls':16},indent=2))
