from pathlib import Path
import datetime,json,subprocess,time
root=Path.cwd(); log=root/'.claude/pause/characters-resume/ulgani4-capture-only.log'
out=root/'assets/renders/characters/validate/ulgani-review4-load-samples.json'
result={'scope':'Observed host load and relevant process snapshots around the single Ulgani review capture session; no performance comparison.', 'logical_cpu_cores':int(subprocess.check_output(['sysctl','-n','hw.logicalcpu'],text=True)), 'samples':[]}
while True:
 content=log.read_text(); phase='after' if 'ULGANI_GPU_END' in content else 'during' if 'ULGANI_BROWSER_CAPTURE_BEGIN' in content else 'before'
 rows=[]
 for row in subprocess.check_output(['ps','-axo','pid,ppid,pcpu,etime,command'],text=True).splitlines()[1:]:
  parts=row.strip().split(None,4)
  if len(parts)!=5: continue
  pid,ppid,cpu,elapsed,command=parts
  if command.startswith(('/bin/zsh -lc','/bin/bash -lc')):continue
  if any(term in command for term in ('Blender.app/Contents/MacOS/Blender','capture/capture.ts','chrome-headless-shell','Chromium.app/Contents')):
   rows.append({'pid':int(pid),'ppid':int(ppid),'cpu_percent':float(cpu),'elapsed':elapsed,'command':command})
 top=[]
 for row in subprocess.check_output(['ps','-axo','pid=,ppid=,pcpu=,rss=,etime=,comm='],text=True).splitlines():
  parts=row.strip().split(None,5)
  if len(parts)!=6:continue
  pid,ppid,cpu,rss,elapsed,executable=parts
  top.append({'pid':int(pid),'ppid':int(ppid),'cpu_percent':float(cpu),'rss_kib':int(rss),'elapsed':elapsed,'executable':Path(executable).name})
 top.sort(key=lambda item:item['cpu_percent'],reverse=True)
 tests=[]
 for row in subprocess.check_output(['ps','-axo','pid=,ppid=,pcpu=,etime=,command='],text=True).splitlines():
  parts=row.strip().split(None,4)
  if len(parts)!=5:continue
  pid,ppid,cpu,elapsed,command=parts
  if any(term in command for term in ('vitest','test:int','playwright test','pnpm test')) and not command.startswith('/bin/zsh -lc'):
   tests.append({'pid':int(pid),'ppid':int(ppid),'cpu_percent':float(cpu),'elapsed':elapsed,'kind':'test-related process; command arguments omitted'})
 result['samples'].append({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phase':phase,'uptime':subprocess.check_output(['uptime'],text=True).strip(),'load_average':list(__import__('os').getloadavg()),'processes':rows,'top_cpu_processes':top[:20],'test_related_processes':tests,'cpu_counter_note':'ps pcpu is a process-lifetime average snapshot, not instantaneous host utilization or per-pair attribution.'})
 out.write_text(json.dumps(result,indent=2)+'\n')
 if phase=='after': break
 time.sleep(15)
print('ULGANI_LOAD_SAMPLES_COMPLETE',len(result['samples']),flush=True)
