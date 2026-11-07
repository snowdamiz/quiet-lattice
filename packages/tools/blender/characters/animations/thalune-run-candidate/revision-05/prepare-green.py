from pathlib import Path
p=Path(__file__).parent
s=(p/'adverse-v2.py').read_text().replace("/'adverse-v2'","/'adverse-green'").replace("'adverse-results-v2.json'","'adverse-green-results.json'")
s=s.replace("if break_write:assert result['primaryFailure']['message']=='POST_WAIT_RECEIPT_FAILURE' and original['type']!='OSError'", "if break_write:assert result['primaryFailure'] is original and any(f['message']=='POST_WAIT_RECEIPT_FAILURE' for f in receipt['persistenceFailures'])")
s=s.replace("status='DEFECT_REPRODUCED' if break_write else 'PASS'","status='PASS'")
s=s.replace("assert name!='duplicate-after'","assert name in ['empty','duplicate-after','uid-after']").replace("else:assert name=='duplicate-after';result=dict(accepted=True)","else:raise AssertionError('Duplicate membership was accepted')")
s=s.replace("status='DEFECT_REPRODUCED' if name=='duplicate-after' else 'PASS'","status='PASS'")
s=s.replace("assert read_bytes==384*1024**2+1", "assert read_bytes==0")
s=s.replace("status='DEFECT_REPRODUCED'", "status='PASS'")
start=s.index('real_sha=resources.sha');end=s.index("assert signal.getitimer",start)
s=s[:start]+'''real_open_fd=resources.os.open
reads=[];real_read=resources.os.read

def raced_open(p,flags,*args,**kwargs):
 global swapped
 if Path(p)==file and not (flags & os.O_DIRECTORY) and not swapped:
  swapped=True;file.unlink();os.mkfifo(file)
 return real_open_fd(p,flags,*args,**kwargs)

def counted_read(fd,count):
 value=real_read(fd,count);reads.append(len(value));return value
lease=resources.CacheLease([root],O,O/'fifo-lock',O/'fifo-archive',[],lambda *a:dict(owners=[]))
with patch.object(resources.os,'open',raced_open),patch.object(resources.os,'read',counted_read):
 try:
  with core['deadline'](.1):lease.check()
 except AssertionError as e:failure=caller.error_receipt(e)
 else:raise AssertionError('FIFO replacement was accepted')
assert swapped and not reads
'''+s[end:]
(p/'adverse-green.py').write_text(s)
