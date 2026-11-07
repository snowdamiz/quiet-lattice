from pathlib import Path
import datetime,hashlib,json,subprocess,sys
from PIL import Image
b=Path('.claude/pause/characters-resume');key=sys.argv[1];session=int(sys.argv[2]);p=b/f'ulgani5-cpu-{key}-job.json';j=json.loads(p.read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();now=datetime.datetime.now(datetime.timezone.utc).isoformat();assert j['exit_code']==j['caffeinate_exit_code']==0
ids={j[k] for k in ['controller_pid','pid','caffeinate_pid']};groups={j[k] for k in ['controller_pgid','pgid','caffeinate_pgid']}
for line in subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,comm='],text=True).splitlines():
 a=line.strip().split(None,3);assert len(a)!=4 or not (int(a[0]) in ids or int(a[2]) in groups),line
pngs=[]
for item in j['artifacts']:
 f=Path(item['path']);assert sha(f)==item['sha256'],f
 if f.suffix=='.png':
  with Image.open(f) as im:im.verify()
  with Image.open(f) as im:im.load();pngs.append({'path':str(f),'size':list(im.size),'mode':im.mode,'full_decode_pass':True})
j.update(session=session,controller_exit_code=0,drain_verified_utc=now,png_decode=pngs,status='complete;controller/render/idle assertion and all owned groups drained')
if '--inspected' in sys.argv:j['visual_inspected_utc']=now
p.write_text(json.dumps(j,indent=2)+'\n');progress=Path('assets/renders/characters/validate/ulgani-review5-cpu-stages.json');r=json.loads(progress.read_text());r['steps']=[j if s['key']==key else s for s in r['steps']];r.update(updated_utc=now,completed_stage_count=len(r['steps']),total_stage_count=16,status=f'{len(r["steps"])}/16 CPU stages complete;browser/GPU held');progress.write_text(json.dumps(r,indent=2)+'\n')
a=b/'ACTIVE_SOL_RESUME.json';active=json.loads(a.read_text());active.update(updated_utc=now,status=r['status']+';drained boundary',live_jobs=[],ulgani5_cpu_current_stage=j);a.write_text(json.dumps(active,indent=2)+'\n');print(json.dumps({'key':key,'actual_start':j['utc'],'render_end':j['render_end_utc'],'drain_utc':now,'pids':sorted(ids),'groups':sorted(groups),'coverage':len(r['steps']),'pngs':pngs},indent=2))
