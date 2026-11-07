"""Select unchanged RSS/dispatcher/error-precedence controls; no old report writes."""
import ast, importlib.util, json, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
A=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(A))
root=Path(sys.argv[1]);root.mkdir(exist_ok=False)
real_mkdtemp=tempfile.mkdtemp
def owned_tmp(*args,**kwargs):kwargs['dir']=root;return real_mkdtemp(*args,**kwargs)
with patch.object(tempfile,'mkdtemp',owned_tmp):
    path=A/'native189-controls.py';spec=importlib.util.spec_from_file_location('retained_native_controls',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    for mode in ['happy','birth','reuse','cohort-drift','kernel','excess','unreadable','empty-error','cancel','timeout']:
        m.case('retained RSS '+mode,lambda mode=mode:m.rss_case(mode))
    for mode in ['happy','primary','empty-error','all-sinks','all-files','cli-all-sinks','after-bytes','rss-timed','rss-excess','rss-normalized','cancel','cleanup-timeout']:
        m.case('retained dispatcher '+mode,lambda mode=mode:m.sequence(mode))
    (root/'native-results.json').write_text(json.dumps(m.RESULTS,indent=2)+'\n')
    path=A/'revision05-controls.py';tree=ast.parse(path.read_text());tree.body=[n for n in tree.body if not isinstance(n,ast.Try) and not (isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='print')]
    values=dict(__name__='retained_ordering_controls',__file__=str(path))
    with patch.object(sys,'argv',[str(path),'--report',str(root/'unused-old-main-report'),'--ordering-only']):exec(compile(tree,str(path),'exec'),values)
    for kind in ['timeout','missing','excess','deadline']:
        for crossing in ['none','post-write','exits-read','worker-read','worker-failure']:
            values['case']('ordering '+kind+' '+crossing,lambda kind=kind,crossing=crossing:values['ordering'](kind,crossing,'normal'))
        for crossing in ['post-write','worker-read']:
            for delivery in ['packet-fallback','all-files','all-sinks']:
                values['case']('ordering '+kind+' '+crossing+' '+delivery,lambda kind=kind,crossing=crossing,delivery=delivery:values['ordering'](kind,crossing,delivery))
    (root/'ordering-results.json').write_text(json.dumps(values['RESULTS'],indent=2)+'\n')
print(json.dumps(dict(status='PASS',retainedRssAndDispatcher=len(m.RESULTS),retainedPrecedence=len(values['RESULTS']),count=len(m.RESULTS)+len(values['RESULTS']))))
