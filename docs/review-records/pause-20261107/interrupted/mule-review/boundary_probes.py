"""Record boundary behavior without silently treating these probes as green tests."""
import contextlib
import io
import json
from pathlib import Path
import tempfile

from independent_review import exact_caller, material, PL, IDENTITY, RESOURCES, HERE

results = {}
with tempfile.TemporaryDirectory(dir=HERE/'tmp') as tmp:
    root=Path(tmp)
    limits_results=[]
    for name,limits in [
        ('null_wall',dict(wall_seconds=None,rss_mib=8192)),
        ('string_wall',dict(wall_seconds='not-a-number',rss_mib=8192)),
        ('boolean_wall',dict(wall_seconds=True,rss_mib=8192)),
        ('zero_wall',dict(wall_seconds=0,rss_mib=8192)),
        ('negative_wall',dict(wall_seconds=-1,rss_mib=8192)),
        ('empty_rss',dict(wall_seconds=5400,rss_mib='')),
        ('boolean_rss',dict(wall_seconds=5400,rss_mib=True)),
        ('negative_rss',dict(wall_seconds=5400,rss_mib=-1)),
        ('null_rss',dict(wall_seconds=5400,rss_mib=None)),
    ]:
        out=root/name;out.mkdir()
        (out/'launch-limits.json').write_text(json.dumps(limits))
        env,scene,events=exact_caller(out)
        error=None
        try:
            with contextlib.redirect_stdout(io.StringIO()): material(env,scene)
        except BaseException as exc: error=type(exc).__name__+': '+str(exc)
        phases,_=PL.load(env['phase_log'].path)
        limits_results.append(dict(case=name,input=limits,error=error,
                                   channel_calls=[e[1] for e in scene.events if e[0]=='bake'],
                                   recorded_resources=phases[0]['resources'] if phases else None))
    results['syntactically_valid_invalid_limits']=limits_results

    path=root/'replaced-log'
    log=PL.PhaseLog(path)
    original=RuntimeError('channel failed')
    try: log.invoke(IDENTITY,RESOURCES,lambda:(_ for _ in ()).throw(original))
    except RuntimeError as exc: assert exc is original
    before=log.phases()
    records=[json.loads(line) for line in path.read_text().splitlines()]
    for record in records:
        record['material']='ReplacedMaterial'
        record['channel']='normal'
    records[-1]['event']='success'
    records[-1].pop('error',None)
    replacement=root/'replacement'
    replacement.write_text(''.join(json.dumps(record)+'\n' for record in records))
    replacement.replace(path)
    results['external_log_replacement_same_phase_id']=dict(before=before,after=log.phases(),disk=PL.load(path)[0],
        precondition='External rewrite/replacement of the documented append-only log; no UUID collision or append-only caller can produce this.')

(HERE/'boundary-probes.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'limits_accepted':[r['case'] for r in results['syntactically_valid_invalid_limits'] if r['error'] is None],
                  'replacement_before_status':results['external_log_replacement_same_phase_id']['before'][0]['status'],
                  'replacement_after_status':results['external_log_replacement_same_phase_id']['after'][0]['status']},indent=2))
