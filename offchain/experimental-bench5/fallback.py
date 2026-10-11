#!/usr/bin/env python3
"""Remplace uniquement40tentatives modèle inaccessible, sans retoucher corpus/prompts."""
import asyncio,json,time
from pathlib import Path
import bench
async def main():
 p=bench.HERE/'votes.jsonl';prev=[json.loads(x) for x in p.read_text().splitlines()]
 assert len(prev)==200, 'attendre fin de première campagne'
 unavailable=[r for r in prev if r['model_index']==5]
 assert len(unavailable)==40 and all(r['source']=='error' for r in unavailable)
 p.rename(bench.HERE/'votes-initial-unavailable.jsonl')
 (bench.HERE/'calls.jsonl').rename(bench.HERE/'calls-initial-unavailable.jsonl')
 (bench.HERE/'models.json').rename(bench.HERE/'models-initial-unavailable.json')
 bench.MODELS[-1]={'name':'Sonnet 4.5 (instance 5)','id':bench.MODELS[2]['id'],'provider':'Anthropic'}
 (bench.HERE/'models.json').write_text(json.dumps(bench.MODELS,indent=2)+'\n')
 bench.RESULTS.extend(r for r in prev if r['model_index']!=5)
 with p.open('w') as f:
  for r in bench.RESULTS:f.write(json.dumps(r,ensure_ascii=False)+'\n')
 await asyncio.gather(*(bench.call(c,bench.MODELS[-1],5) for c in bench.FIXTURES))
 result=bench.summarise()
 rp=bench.HERE/'rapport.json';report=json.loads(rp.read_text());report['fallback']={'reason':'Nova Premier inference profile ACTIVE, but all40 Converse attempts ResourceNotFoundException','initial_model':'us.amazon.nova-premier-v1:0','replacement':bench.MODELS[-1]['id'],'reused_evaluations':160,'new_evaluations':40,'model_selection_not_based_on_scores':True};report['committee_latency_scope']='maximum measured individual evaluator duration per case; proxy for simultaneous evaluations, not actual blockchain/committee end-to-end latency; fifth evaluator replayed after four previous models';rp.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');return result
if __name__=='__main__':raise SystemExit(asyncio.run(main()))
