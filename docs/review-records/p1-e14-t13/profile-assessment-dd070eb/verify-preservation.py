from pathlib import Path
import sys,json,subprocess,os
root=Path.cwd();out=Path(__file__).parent;sys.path.insert(0,str(root/'packages/tools/src/capture/trace_observer_packet'));import metadata as m
base='dd070eb0233e242eed6ec4e62d5d7f8857d6dc21';assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==base;assert not subprocess.check_output(['git','status','--porcelain'])
before=m.snapshot(out/'effects-preservation-before.json',cap=16*1024**2)['value'];checked={}
with m.io_deadline(30):
 for path,expected in before.items():
  actual=m.ledger(path,count=20000,cap=128*1024**2);assert actual==expected,path;checked[path]={'unchanged':True,'count':actual['count'],'bytes':actual['bytes']}
ready_path='/private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/frozen-dd070eb02/readiness.json';ready=m.snapshot(ready_path,'ef0311ecabde0d5ec187fdb2f938933bcb80b44ad199abe055d73516c48bd359')['value'];assert ready['runtimeAuthorized'] is False and ready['binding']['runtimeAuthorized'] is False
binding=m.snapshot(root/'packages/tools/src/capture/trace_observer_packet/local-binding.json','3172f65d4b58dc4e67a525156f76a7af3212d4435152ded107601d9cfdf48fcb')['value'];assert binding==ready['binding']
absent={str(binding[k]):not os.path.lexists(binding[k]) for k in ['output','fallback','consumption','grant']};absent['/private/tmp/t13-observer-enabled-readiness-161689e0.json']=not os.path.lexists('/private/tmp/t13-observer-enabled-readiness-161689e0.json');assert all(absent.values())
paths=['packages/tools/src/capture/trace_observer_packet/'+p for p in ['metadata.py','launch.py','controller_controls.py','live_controls.py','local-binding.json']]+['assets/blend/stations/_authoring/'+p for p in ['round4_job_boundary.py','round4_capture_children.py','run_round4_browser_proof.py','run_round4_remaining8.py']]+['packages/tools/src/capture/'+p for p in ['capture.ts','browser-work-probe.ts','browser-work-trace.ts','trace-observer-report.ts']]+['packages/client/src/dev/review.js']
hashes={}
for p in paths:
 raw=(root/p).read_bytes();assert raw==subprocess.check_output(['git','show',base+':'+p]);hashes[p]=m.digest(raw)
value={'head':base,'tree':subprocess.check_output(['git','rev-parse','HEAD^{tree}'],text=True).strip(),'clean':True,'filesChanged':[],'effectsOriginals':checked,'unchangedSourceHashes':hashes,'readiness':ready_path,'readinessSha256':'ef0311ecabde0d5ec187fdb2f938933bcb80b44ad199abe055d73516c48bd359','runtimeAuthorized':False,'prospectivePathsAbsent':absent}
(out/'preservation-and-pins.json').write_text(json.dumps(value,indent=2));print(json.dumps({k:value[k] for k in ['head','tree','clean','effectsOriginals','runtimeAuthorized','prospectivePathsAbsent']},indent=2))
