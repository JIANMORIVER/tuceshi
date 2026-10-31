import test from 'node:test';import assert from 'node:assert/strict';
import {Workbench,STORAGE_KEY} from '../dist/domain/workbench/flow.js';
import {interpretLifeEntry} from '../dist/domain/services/life-interpretation-service.js';
const memory=()=>{const rows=new Map();return {getItem:key=>rows.get(key)||null,setItem:(key,value)=>rows.set(key,value)};};
function fixture({unknown=false}={}){
 const storage=memory(),calls=[];let flow;
 const api={async call(path,body){calls.push({path,body});
  if(path==='/api/model-settings')return {textProvider:'mock',image:{model:'qwen-image-2.0'},generationRoute:'native-alpha',nativeImageModel:'qwen-image-2.1-turbo'};
  if(path==='/api/diary/interpret')return interpretLifeEntry(body.input,{provider:'mock'});
  if(path==='/api/terrain/generate'){
   const saved=JSON.parse(storage.getItem(STORAGE_KEY)),candidate=saved.candidates.find(c=>c.id===body.candidate_id);assert.equal(candidate.status,'submitting');assert.equal(candidate.submissionId,body.client_request_id);
   if(unknown)throw Error('response lost');return {job:{job_id:'terrain:'+body.client_request_id,provider:'mock',request_status:'succeeded',provider_task_id:body.client_request_id,image_url:'/fixture.png'}};
  }
  if(path==='/api/terrain/query')return {job_id:body.job_id,provider:'mock',request_status:'succeeded',image_url:'/fixture.png'};
  assert.fail(path);
 }};flow=new Workbench(storage,api);return {flow,storage,api,calls};
}
async function inquiry(f){f.flow.edit({notes:['今天在公园散步，很开心。','然后回家读书。']});await f.flow.analyze();await f.flow.inquire();assert.equal(f.flow.state.stage,'inquiry');}
test('isolated offline workflow aggregates notes, keeps evidence, freezes images and exports without keys',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);await inquiry(f);assert.equal(f.flow.state.rawText,'今天在公园散步，很开心。\n\n然后回家读书。');assert.ok(f.flow.state.focuses.every(focus=>f.flow.state.rawText.includes(focus.evidence)));
 await f.flow.generate();assert.equal(f.flow.state.stage,'results');assert.equal(f.calls.filter(c=>c.path==='/api/terrain/generate').length,2);const ids=f.flow.state.candidates.map(c=>c.submissionId);assert.equal(new Set(ids).size,2);
 f.flow.back();assert.equal(f.flow.state.stage,'results');await f.flow.generate();assert.equal(f.calls.filter(c=>c.path==='/api/terrain/generate').length,2);
 f.flow.select('candidate_1');assert.equal(f.flow.state.stage,'selected');assert.equal(new Workbench(f.storage,f.api).state.selectedId,'candidate_1');assert.doesNotMatch(f.flow.export(),/apiKey|deepseekKey|qwenKey|replicateKey/);
});
test('uncertain submissions survive reload and only query original IDs, never auto-submit',async()=>{
 const f=fixture({unknown:true});await inquiry(f);await f.flow.generate();assert.ok(f.flow.state.candidates.every(c=>c.status==='unknown'));const before=f.calls.length,restored=new Workbench(f.storage,f.api);assert.equal(f.calls.length,before);
 await restored.submit('candidate_1');assert.equal(f.calls.length,before);await restored.query('candidate_1');assert.equal(restored.state.candidates[0].status,'known');assert.equal(f.calls.filter(c=>c.path==='/api/terrain/generate').length,2);
});
test('failed durable storage blocks image submissions before any model work',async()=>{
 const f=fixture();await inquiry(f);f.storage.setItem=()=>{throw Error('quota');};await f.flow.generate();assert.match(f.flow.error,/quota/);assert.equal(f.calls.filter(c=>c.path==='/api/terrain/generate').length,0);assert.equal(f.flow.state.stage,'inquiry');
});
test('double clicks submit each candidate once, preserving allocated IDs',async()=>{
 const f=fixture();await inquiry(f);await Promise.all([f.flow.generate(),f.flow.generate()]);assert.equal(f.calls.filter(c=>c.path==='/api/terrain/generate').length,2);
});
test('manual review retains machine findings and is not a generation request',async()=>{
 const f=fixture();await inquiry(f);await f.flow.generate();const c=f.flow.state.candidates[0];f.flow.edit({candidates:[{...c,job:{...c.job,provider:'qwen',background_removal:{status:'needs_review',source_sha256:'sha'},calibration:{alphaVerified:false}}},f.flow.state.candidates[1]]});
 assert.throws(()=>f.flow.select(c.id));const n=f.calls.length;f.flow.approve(c.id);f.flow.select(c.id);assert.equal(f.calls.length,n);assert.equal(f.flow.state.candidates[0].job.calibration.alphaVerified,false);assert.equal(new Workbench(f.storage,f.api).state.selectedId,c.id);
});
test('corrupt cached data is reported and preserved without requests or implicit replacement',()=>{
 const storage=memory();storage.setItem(STORAGE_KEY,'broken json');const f=new Workbench(storage,{call(){assert.fail('request');}});assert.match(f.error,/缓存/);assert.equal(storage.getItem(STORAGE_KEY),'broken json');
});

test('refreshing a reviewed result retains approval only for the same job and source',async()=>{
 const f=fixture();await inquiry(f);await f.flow.generate();const c=f.flow.state.candidates[0],job={...c.job,provider:'qwen',background_removal:{status:'needs_review',source_sha256:'one'},calibration:{alphaVerified:false}};
 f.flow.edit({candidates:[{...c,job},f.flow.state.candidates[1]]});f.flow.approve(c.id);f.flow.select(c.id);
 f.api.call=async()=>job;await f.flow.query(c.id);assert.equal(f.flow.state.selectedId,c.id);assert.equal(f.flow.state.candidates[0].job.manual_review.decision,'approved');
 f.api.call=async()=>({...job,background_removal:{...job.background_removal,source_sha256:'changed'}});await f.flow.query(c.id);assert.equal(f.flow.state.selectedId,undefined);assert.equal(f.flow.state.stage,'results');assert.equal(f.flow.state.candidates[0].job.manual_review,undefined);
});
