import os,subprocess,json,time
from pathlib import Path
root=Path(__file__).resolve().parents[3]
Path('/tmp/maneki-security-audit').mkdir(exist_ok=True)
files=sorted(str(p.relative_to(root)) for folder in ['server','shared','framework/bridge'] for p in (root/folder).glob('*.test.mjs'))
env={k:os.environ[k] for k in ['PATH','HOME','LANG','TMPDIR','SystemRoot'] if k in os.environ}
env.update(NODE_ENV='test',BANK_WEBHOOK_ENABLED='false')
started=time.time()
results=[]
with open('/tmp/maneki-security-audit/tests-full.tap','w') as log:
 for file in files:
  r=subprocess.run(['node',file],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=180)
  log.write('FILE '+file+'\n'+r.stdout+'\n')
  counts={}
  for line in r.stdout.splitlines():
   for word in ['tests','pass','fail','cancelled','skipped','todo']:
    if line.startswith('# '+word+' '): counts[word]=int(line.split()[-1])
  results.append({'file':file,'exitCode':r.returncode,**counts})
summary={'files':results,'durationSeconds':round(time.time()-started,2),'totals':{k:sum(x.get(k,0) for x in results) for k in ['tests','pass','fail','cancelled','skipped','todo']},'failedFiles':[x['file'] for x in results if x['exitCode']]}
Path('/tmp/maneki-security-audit/test-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k!='files'},ensure_ascii=False))
