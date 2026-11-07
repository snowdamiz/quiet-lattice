from pathlib import Path
import datetime, hashlib, json, subprocess, time
root=Path.cwd()
log=root/'.claude/pause/characters-resume/ixari-gpu-pack-root.log'
validation=root/'assets/renders/characters/validate'
context={
 'scope':'One standard review capture session per variant/lighting case. No comparative performance or budget conclusion is asserted.',
 'machine':{'model':subprocess.check_output(['sysctl','-n','hw.model'],text=True).strip(), 'logical_cpu_cores':int(subprocess.check_output(['sysctl','-n','hw.logicalcpu'],text=True)), 'memory_bytes':int(subprocess.check_output(['sysctl','-n','hw.memsize'],text=True)), 'gpu':'Apple M5 Pro', 'gpu_cores':16, 'graphics_api':'Metal', 'viewport':[1920,1080]},
 'concurrent_work':'Station Cycles CPU rendering is scheduled at two threads. No other scheduled GPU bake or art capture; Ulgani GPU gate remains closed during Ixari capture.',
 'method':'EXT_disjoint_timer_query_webgl2 measures whole rendered frames; adjacent shown/hidden frames are sampled in ABBA blocks. The standard harness adapts from 120 to 720 pairs according to its confidence interval.',
 'checks':'Per-variant inventory verifies all three cases, no captured page errors, nonzero shown-minus-hidden draw/triangle work and timer samples.',
 'limitations':'This is a development review scene, not a production benchmark. No five-run comparison or independent limiter profile was performed. The full scene and asset-only paired readouts remain separate in each perf.json.',
 'measurement_sources':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path('packages/tools/src/capture/capture.ts'),Path('packages/client/src/dev/review.js')]},
 'snapshots':[]}
def snapshot(phase):
 context['snapshots'].append({'phase':phase,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'load':subprocess.check_output(['uptime'],text=True).strip()})
 (validation/'ixari-review4-performance-context.json').write_text(json.dumps(context,indent=2)+'\n')
while 'IXARI_BROWSER_CAPTURE_BEGIN' not in log.read_text(): time.sleep(3)
snapshot('browser_capture_begin_observed')
while 'IXARI_GPU_END' not in log.read_text(): time.sleep(3)
snapshot('browser_capture_end_observed')
variants=[f'{kind}{n}' for kind,count in [('head',6),('suit',4)] for n in range(1,count+1)]
inputs=[f'assets/renders/review/characters/ixari/ixari/ixari_{variant}/far_lod2.png' for variant in variants]
for suffix,flags in [('',[]),('_grayscale',['--grayscale'])]:
 subprocess.run(['/Applications/Blender.app/Contents/MacOS/Blender','-b','--factory-startup','-t','1','--python-exit-code','1','-P','packages/tools/blender/characters/lineup.py','--',*flags,f'assets/renders/review/characters/ixari_lineup_far_lod2{suffix}.png',*inputs],cwd=root,check=True)
subprocess.run(['python3','packages/tools/blender/characters/review_inventory.py','ixari','4'],cwd=root,check=True)
print('IXARI_REVIEW_CPU_FINISH',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
