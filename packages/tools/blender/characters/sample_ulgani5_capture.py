from pathlib import Path
import datetime,json,subprocess,time,os
root=Path.cwd(); log=Path(os.environ['ART_CAPTURE_LOG'])
out=Path(os.environ['ART_CAPTURE_LOAD_OUT'])
owner=int(os.environ['ART_CAPTURE_CONTROLLER_PID']);assert owner>1
result={'scope':'Observed host load and owned capture process snapshots around the single Ulgani review capture session; no performance comparison. Command arguments recorded only for the owned controller descendant tree.', 'controller_pid':owner,'logical_cpu_cores':int(subprocess.check_output(['sysctl','-n','hw.logicalcpu'],text=True)), 'samples':[]}
deadline=time.monotonic()+600;next_sample=0
while True:
 assert time.monotonic()<deadline,'Capture sampler600second bound exceeded;preserve partial load evidence'
 content=log.read_text(); phase='after' if 'ULGANI5_GPU_END' in content else 'during' if 'ULGANI5_BROWSER_CAPTURE_BEGIN' in content else 'before'
 if phase!='after' and time.monotonic()<next_sample:
  time.sleep(1);continue
 next_sample=time.monotonic()+15
 rows=[];snapshot=[]
 for row in subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,pcpu=,etime=,command='],text=True).splitlines():
  parts=row.strip().split(None,5)
  if len(parts)==6:snapshot.append(parts)
 owned={owner}
 while True:
  found={int(p[0]) for p in snapshot if int(p[1]) in owned}
  if found<=owned:break
  owned|=found
 for pid,ppid,pgid,cpu,elapsed,command in snapshot:
  if int(pid) in owned:rows.append({'pid':int(pid),'ppid':int(ppid),'pgid':int(pgid),'cpu_percent':float(cpu),'elapsed':elapsed,'command':command})
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
 time.sleep(1)
print('ULGANI_LOAD_SAMPLES_COMPLETE',len(result['samples']),flush=True)
