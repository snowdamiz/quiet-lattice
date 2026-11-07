from pathlib import Path
import datetime,json,os,time
stage=Path('.claude/pause/characters-resume');log=stage/'ulgani-recovery.log';record={};output=stage/'ulgani-completion-watch.json'
while True:
 lines=log.read_text().splitlines()
 ended=next((line for line in lines if line.startswith('ULGANI_BAKE_END ')),None)
 if ended and 'bake_end_utc' not in record:
  record['bake_end_utc']=ended.split(' ',1)[1];record['studio_stop_requested_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
  (stage/'stop-ixari5-cpu-studio').write_text('Stop at next asset boundary for performance profiling after '+ended+'\n')
  output.write_text(json.dumps(record,indent=2)+'\n');print(ended,flush=True);print('IXARI_CPU_STUDIO_STOP_REQUESTED',record['studio_stop_requested_utc'],flush=True)
 saved=next((line for line in lines if line.startswith('AUTHORING_SAVED ')),None)
 if saved:
  record['authoring_saved_utc']=saved.rsplit(' ',1)[1];output.write_text(json.dumps(record,indent=2)+'\n');print(saved,flush=True);break
 try:os.kill(9760,0)
 except ProcessLookupError:raise RuntimeError('Ulgani recovery process ended before successful authoring save; inspect its log')
 time.sleep(1)
