import { runMatrix, toggle } from 'file:///Users/andreyyurlov/.t3/worktrees/space/t3-02adc2f8/packages/tools/src/diagnostics/review-performance/index.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const rawError = message => Object.assign(Object.create(null), { message, code: 'E_RAW' });
const attempt = async promise => { try { await promise; return { rejected: false }; } catch (error) { return { rejected: true, error }; } };
const print = (mode, result, o, more) => console.log(JSON.stringify({mode,rejected:o.rejected,thrown:String(o.error),aggregateErrors:o.error instanceof AggregateError ? o.error.errors.map(e => ({type: e?.constructor?.name ?? typeof e, message:e?.message})) : null,errors:result.errors,failures:result.failures ?? null,rowFailures:result.runs.at(-1)?.failures ?? null,...more}));
for (const mode of ['primary','restore']) {
  const result = {runs:[],errors:[]}, target = {enabled:true};
  const review = {case:'noon-lush',root:{visible:false}};
  const adapter = toggle('bloom',target,'enabled');
  let failed=false, verified=false;
  review.perf=async () => { await tick(); if (!target.enabled) { failed=true; review.root.visible=true; throw mode==='primary' ? rawError('raw primary cause') : new Error('ordinary primary cause'); } return {}; };
  adapter.restore=async saved => { await tick(); target.enabled=saved; if (failed) throw mode==='restore' ? rawError('raw restore cause') : new Error('ordinary restore cause'); };
  const matches=adapter.matches;
  adapter.matches=(arm,saved,observed) => { if(failed && arm==='A') verified=true; return matches(arm,saved,observed); };
  const o=await attempt(runMatrix({review,interventions:[adapter],receipt:result,repetitions:2}));
  review.perf=async()=>({});
  const retry=await attempt(runMatrix({review,interventions:[],repetitions:2}));
  print(mode,result,o,{restoreVerified:verified,rootVisible:review.root.visible,controlEnabled:target.enabled,retrySucceeded:!retry.rejected});
}
{
  const review={case:'noon-lush',root:{}},result={runs:[],errors:[]};
  let visible=false, failed=false,verified=false;
  Object.defineProperty(review.root,'visible',{get(){if(failed)verified=true;return visible;},set(v){if(failed)throw rawError('raw root restore cause');visible=v;}});
  review.perf=async()=>{await tick();review.root.visible=true;failed=true;throw new Error('ordinary primary cause');};
  const o=await attempt(runMatrix({review,interventions:[],receipt:result,repetitions:2}));
  const rootVisibleBeforeRetry=visible;
  failed=false;review.perf=async()=>({});
  const retry=await attempt(runMatrix({review,interventions:[],repetitions:2}));
  print('root-restore',result,o,{rootVerified:verified,rootVisibleBeforeRetry,retrySucceeded:!retry.rejected});
}
