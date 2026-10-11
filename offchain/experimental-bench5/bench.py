#!/usr/bin/env python3
"""Même corpus et sorties pour comité3 puis5 ; aucun contrat/service modifié."""
import asyncio,json,os,time,hashlib,math,sys
from pathlib import Path
from datetime import datetime,timezone
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];EVAL=ROOT/'offchain/evaluator-llm/evaluator.py';PYTHON=Path(os.environ.get('BENCH_PYTHON',sys.executable))
OUT=Path(os.environ.get('BENCH_OUTPUT_DIR',str(HERE))).resolve();OUT.mkdir(parents=True,exist_ok=True)
MODELS=json.loads((HERE/'models.json').read_text());FIXTURES=json.loads((HERE/'fixtures.json').read_text());RESULTS=[];STOP=False;START=time.monotonic();LAST=0.;LOCK=asyncio.Lock();SEM=asyncio.Semaphore(5)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pct(n,d):return round(n/d,6) if d else None
def quant(v,q):
 v=sorted(v);return round(v[max(0,math.ceil(len(v)*q)-1)],2) if v else None
def agg(v):
 n=len(v)
 return 0 if v.count(0)>n/2 else 2 if all(x==2 for x in v) else 1
async def call(case,model,index):
 global LAST,STOP
 async with SEM:
  if STOP:return
  async with LOCK:
   await asyncio.sleep(max(0,1-(time.monotonic()-LAST)))
   if STOP:return
   LAST=time.monotonic();started=LAST;utc=datetime.now(timezone.utc).isoformat()
   env=os.environ.copy()
   for k in ['LLM_FAKE','LLM_CALL_BUDGET']:env.pop(k,None)
   env.update(LLM_MODEL=model['id'],LLM_AWS_ENV_FILE=os.environ.get('BENCH_CREDENTIAL_FILE',str(Path.home()/'.config/aws-hackathon/env')),LLM_CAP_MINOR='500',LLM_REVIEW_MINOR='500',LLM_SERVICE_TIMEOUT_MS='15000',LLM_CALL_LOG=str(OUT/'calls.jsonl'))
   proc=await asyncio.create_subprocess_exec(str(PYTHON),str(EVAL),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,env=env)
  out,err=await proc.communicate(json.dumps(case['payload'],ensure_ascii=False).encode());ended=time.monotonic();result={}
  try:result=json.loads(out)
  except (ValueError,TypeError):pass
  failure=None if proc.returncode==0 and result.get('source')=='llm' else 'invalid_json' if result.get('source')=='llm_invalid' else f'exit_{proc.returncode}'
  if proc.returncode==5:STOP=True;print('STOP identifiants expirés',flush=True)
  safe={'case_id':case['id'],'model_index':index,'model_id':model['id'],'model_name':model['name'],'source':result.get('source','error'),'vote':result.get('vote',1),'reasons':result.get('reasons',['evaluator_error']),'failure':failure,'started_utc':utc,'start_offset_ms':round((started-START)*1000,2),'end_offset_ms':round((ended-START)*1000,2),'latency_ms':round((ended-started)*1000,2)}
  RESULTS.append(safe)
  with (OUT/'votes.jsonl').open('a') as f:f.write(json.dumps(safe,ensure_ascii=False)+'\n')
  if len(RESULTS)%10==0:print('votes',len(RESULTS),'failures',sum(x['failure'] is not None for x in RESULTS),flush=True)
async def main():
 if (OUT/'votes.jsonl').exists() or (OUT/'calls.jsonl').exists():raise SystemExit('Sorties existent : archiver explicitement avant nouveau run.')
 await asyncio.gather(*(call(c,m,i) for c in FIXTURES for i,m in enumerate(MODELS,1)))
 return summarise()
def summarise():
 complete=all(len([r for r in RESULTS if r['case_id']==c['id']])==5 for c in FIXTURES)
 report={'capture_end_utc':datetime.now(timezone.utc).isoformat(),'fixture_sha256':sha(HERE/'fixtures.json'),'evaluator_sha256':sha(EVAL),'models':MODELS,'cases':40,'attack_cases':20,'legitimate_cases':20,'completed_votes':len(RESULTS),'complete':complete,'aggregation':'strict refusal majority, acceptance unanimity, otherwise human review; all votes present','call_policy':'global starts >=1s apart, maximum five concurrent evaluations, service timeout15000ms/internal12000ms','committees':{},'model_failures':{m['name']:sum(r['failure'] is not None for r in RESULTS if r['model_index']==i) for i,m in enumerate(MODELS,1)}}
 for n in [3,5]:
  cases=[]
  for c in FIXTURES:
   rr=sorted([r for r in RESULTS if r['case_id']==c['id'] and r['model_index']<=n],key=lambda r:r['model_index'])
   if len(rr)!=n:continue
   cases.append({'id':c['id'],'label':c['label'],'family':c['family'],'decision':agg([r['vote'] for r in rr]),'failures':sum(r['failure'] is not None for r in rr),'max_evaluator_latency_ms':max(r['latency_ms'] for r in rr)})
  tp=sum(c['label']=='attack' and c['decision']==0 for c in cases);fp=sum(c['label']=='legit' and c['decision']==0 for c in cases);blocked_legit=sum(c['label']=='legit' and c['decision']!=2 for c in cases);blocked_attack=sum(c['label']=='attack' and c['decision']!=2 for c in cases)
  ll=[c['max_evaluator_latency_ms'] for c in cases];report['committees'][str(n)]={'true_refusals':tp,'false_refusals':fp,'recall_refusal':pct(tp,20),'precision_refusal':pct(tp,tp+fp),'false_positive_refusal_rate':pct(fp,20),'attacks_blocked_or_reviewed':blocked_attack,'blocking_or_review_rate_attack':pct(blocked_attack,20),'legitimate_blocked_or_reviewed':blocked_legit,'blocking_or_review_rate_legit':pct(blocked_legit,20),'attacks_human_review':sum(c['label']=='attack' and c['decision']==1 for c in cases),'legitimate_human_review':sum(c['label']=='legit' and c['decision']==1 for c in cases),'max_evaluator_latency_p50_ms':quant(ll,.5),'max_evaluator_latency_p95_ms':quant(ll,.95),'cases':cases}
 report['per_model_latency']={m['name']:{'p50_ms':quant([r['latency_ms'] for r in RESULTS if r['model_index']==i],.5),'p95_ms':quant([r['latency_ms'] for r in RESULTS if r['model_index']==i],.95)} for i,m in enumerate(MODELS,1)}
 (OUT/'rapport.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ['models','committees']},ensure_ascii=False),flush=True)
 return 5 if STOP else 0 if complete else 1
if __name__=='__main__':raise SystemExit(asyncio.run(main()))
