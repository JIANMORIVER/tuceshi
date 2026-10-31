import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiaryDialogue, validateInquiries, validateScenePlans, validateDiaryContext } from '../server/ai/diary-dialogue.mjs';
import { completeSceneDescription, CompleteTerrainGeneration } from '../server/ai/complete-terrain.mjs';
import { ModelSettings } from '../server/ai/models.mjs';
import { mockPng } from '../server/image-card/png.mjs';
import { visualPlanToCandidate } from '../dist/domain/services/diary-dialogue-client.js';

const context=()=>({rawText:'今天在打磨界面，想把 demo 做出来。感到有点累。',focuses:[{event_id:'work',title:'打磨界面',evidence:'在打磨界面'}],answers:[]});
const inquiry=()=>({intro:'想再确认一点画面细节吗？',questions:[{target_event_id:'work',question_text:'想把创作时的哪一幕留下？',input_type:'single_choice',answer_options:['电脑前的工作桌','贴满草图的灵感板'],evidence:'在打磨界面'}]});
const scene=()=>({title:'界面设计工作角',primary_subject:'带电脑、便签和台灯的木质工作桌',ground_surface:'石板地面',translation_rationale:'将界面设计转译为可见的创作工作桌',scene_description:'完整的等距像素生活场景，中央是一张有电脑和无字界面草图的木质工作桌，台灯在左侧投下温暖的光，桌面放着几张无字便签和铅笔，右侧是一把椅子，后方有一块展示几何布局的画板，所有主体位于同一个有厚度的石板菱形底座，外部纯白，无文字和标签。'});
const settings=()=>new ModelSettings({DEEPSEEK_API_KEY:'fixture-key',DASHSCOPE_API_KEY:'fixture-image-key',LIFE_MAP_IMAGE_SIZE:'512*512'});

test('DeepSeek returns typed optional controls; identical and concurrent contexts call the provider once',async()=>{
 let calls=0,body; const service=new DiaryDialogue(settings(),{fetcher:async(url,options)=>{calls++;body=JSON.parse(options.body);assert.equal(url,'https://api.deepseek.com/v1/chat/completions');return Response.json({choices:[{message:{content:JSON.stringify(inquiry())}}]});}});
 const [a,b]=await Promise.all([service.complete('inquiry',context()),service.complete('inquiry',context())]);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.questions[0].input_type,'single_choice');
 assert.equal(body.response_format.type,'json_object');assert.equal(body.thinking.type,'disabled');
 assert.match(body.messages[0].content,/可跳过/);
});
test('arbitrary controls, invented evidence and unrelated target IDs cannot become UI',()=>{
 for(const change of [{input_type:'html'},{evidence:'没有出现的日记'},{target_event_id:'other'}]){
  const value=inquiry();Object.assign(value.questions[0],change);assert.throws(()=>validateInquiries(value,context(),'test-key'));
 }
});
test('empty or unavailable provider does not silently fabricate online questions and failed calls are retryable',async()=>{
 const offline=new ModelSettings({});offline.update({textProvider:'mock'});
 await assert.rejects(()=>new DiaryDialogue(offline).complete('inquiry',context()),/在线文字模型/);
 let calls=0;const service=new DiaryDialogue(settings(),{fetcher:async()=>{calls++;return new Response('secret-provider-message',{status:502});}});
 await assert.rejects(()=>service.complete('inquiry',context()),error=>error.message.includes('502')&&!error.message.includes('secret-provider-message'));
 await assert.rejects(()=>service.complete('inquiry',context()));assert.equal(calls,2);
});
test('scene planning accepts zero optional answers and carries actual answers when supplied',async()=>{
 const requests=[];const service=new DiaryDialogue(settings(),{fetcher:async(_,options)=>{requests.push(JSON.parse(options.body));return Response.json({choices:[{message:{content:JSON.stringify({candidates:[scene(),scene()]})}}]});}});
 const empty=await service.complete('scene',context());assert.equal(empty.candidates.length,2);
 const answered={...context(),answers:[{target_event_id:'work',question_text:'想留下什么细节？',final_answer:'台灯和便签'}]};
 await service.complete('scene',answered);assert.equal(requests.length,2);
 assert.deepEqual(JSON.parse(requests[0].messages[1].content).answers,[]);
 assert.equal(JSON.parse(requests[1].messages[1].content).answers[0].final_answer,'台灯和便签');
});
test('the complete visual scene survives conversion, JSON transport and the final Qwen prompt without diary text',async()=>{
 const visual=validateScenePlans({candidates:[scene(),scene()]}).candidates[0];
 const plan=visualPlanToCandidate(visual,context().focuses);
 const payload=JSON.parse(JSON.stringify({candidate_id:'candidate_1',planning_run_id:'fixture-batch',client_request_id:randomUUID(),candidate_plan:plan,snapshot:{input_text:context().rawText},model_config:{provider:'qwen'}}));
 assert.equal(payload.candidate_plan.scene_description,scene().scene_description);
 let calls=0,prompt;const service=new CompleteTerrainGeneration(settings(),{storageRoot:await mkdtemp(join(tmpdir(),'life-map-complete-scene-')),adapter:{async generate(_,submitted){calls++;prompt=submitted;return {bytes:mockPng(512,512)};}}});
 const [a,b]=await Promise.all([service.generate(payload),service.generate(payload)]);
 assert.equal(calls,1);assert.equal(a.job.job_id,b.job.job_id);assert.equal(a.job.prompt_version,'isometric-complete-scene-v5');
 assert.match(prompt.positive,/电脑/);assert.match(prompt.positive,/工作桌/);assert.match(prompt.positive,/石板/);
 assert.ok(!prompt.positive.includes(context().rawText));assert.ok(!prompt.positive.includes('用户细节回答'));assert.ok(!prompt.positive.includes('当日明确线索'));
});
test('missing scene descriptions and bare-ground subjects fail before any image call',()=>{
 assert.throws(()=>completeSceneDescription({candidate_plan:{title:'本周 demo 路标'}}),/阻止空草地/);
 assert.throws(()=>validateScenePlans({candidates:[{...scene(),primary_subject:'草地'},scene()]}),/不完整/);
});
test('mismatched user answers or fabricated focus evidence are rejected before provider access',()=>{
 assert.throws(()=>validateDiaryContext({...context(),answers:[{target_event_id:'other',final_answer:'未知回答'}]}));
 assert.throws(()=>validateDiaryContext({...context(),focuses:[{event_id:'work',title:'工作',evidence:'原文没有这一句'}]}));
});

test('response transport, empty output, truncation and malformed controls have distinct errors, without automatic retries',async()=>{
 const cases=[
  {response:()=>new Response('<html>gateway error</html>'),code:'TEXT_RESPONSE_INVALID'},
  {response:()=>Response.json({choices:[{message:{content:'   '}}]}),code:'TEXT_OUTPUT_EMPTY'},
  {response:()=>Response.json({choices:[{finish_reason:'length',message:{content:'{"intro":'}}]}),code:'TEXT_OUTPUT_TRUNCATED'},
  {response:()=>Response.json({choices:[{message:{content:JSON.stringify({intro:'细节',questions:[null]})}}]}),code:'MODEL_OUTPUT_INVALID'},
  {response:()=>new Response('',{status:401}),code:'TEXT_AUTH_FAILED'},
  {response:()=>new Response('',{status:429}),code:'TEXT_RATE_LIMITED'},
  {response:()=>new Response('',{status:503}),code:'TEXT_PROVIDER_UNAVAILABLE'},
  {response:()=>{throw Error('transport failed');},code:'TEXT_CONNECTION_FAILED'}
 ];
 for(const fixture of cases){let calls=0;const service=new DiaryDialogue(settings(),{fetcher:async()=>{calls++;return fixture.response();}});await assert.rejects(service.complete('inquiry',context()),{code:fixture.code});assert.equal(calls,1);}
});

test('transport invokes injected native-compatible fetch with the global receiver',async()=>{
 let calls=0;
 const fetcher=async function(){assert.equal(this,globalThis);calls++;return Response.json({choices:[{message:{content:JSON.stringify(inquiry())}}]});};
 assert.equal((await new DiaryDialogue(settings(),{fetcher}).complete('inquiry',context())).questions.length,1);assert.equal(calls,1);
});

test('null user selections fail validation and null scene candidates cannot become a connection error',()=>{
 assert.throws(()=>validateDiaryContext({...context(),focuses:[null]}),{code:'DIARY_CONTEXT_INVALID'});
 assert.throws(()=>validateDiaryContext({...context(),answers:[null]}),{code:'DIARY_CONTEXT_INVALID'});
 assert.throws(()=>validateScenePlans({candidates:[scene(),null]}),{code:'MODEL_OUTPUT_INVALID'});
});
