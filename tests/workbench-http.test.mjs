import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {createWorkbenchServer} from '../server/index.mjs';import {ModelSettings} from '../server/ai/models.mjs';
test('standalone HTTP server keeps settings secret, requires session, blocks foreign origins and serves generated mock PNG',async()=>{
 const storageRoot=await mkdtemp(join(tmpdir(),'image-workbench-')),settings=new ModelSettings({LIFE_MAP_TEXT_PROVIDER:'mock',LIFE_MAP_GENERATION_ROUTE:'native-alpha',DASHSCOPE_API_KEY:'fixture-hidden-key',LIFE_MAP_IMAGE_SIZE:'512*512'}),server=await createWorkbenchServer({storageRoot,settings});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const noSession=await fetch(base+'/api/diary/interpret',{method:'POST',body:JSON.stringify({input:'今天读书'})});assert.equal(noSession.status,403);
  const info=await fetch(base+'/api/model-settings'),cookie=info.headers.get('set-cookie').split(';')[0],publicInfo=await info.text();assert.ok(!publicInfo.includes('fixture-hidden-key'));assert.equal(JSON.parse(publicInfo).textProvider,'mock');
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/api/model-settings',{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/api/scene/chat')).status,404);
  const interpreted=await post('/api/diary/interpret',{input:'今天在公园散步，很开心。'});assert.equal(interpreted.status,200);assert.equal((await interpreted.json()).debug.provider,'mock');
  const input={candidate_id:'candidate_1',client_request_id:randomUUID(),planning_run_id:'http-test',model_config:{provider:'mock'},image_pipeline:{route:'native-alpha',model:'qwen-image-2.1-turbo'},snapshot:{input_text:'今天散步'},candidate_plan:{primary_subject:'一条公园小路和路旁的长椅',scene_description:'完整的等距像素生活场景，中央是一条石头铺成的林间小路，道路旁摆放着木质长椅和温暖的路灯，后方是几棵树木和低矮的灌木，所有主体位于同一个保留清晰侧面的薄菱形草地底座，整个地块外部透明，画面内没有任何文字、标签和说明。'}};
  const first=await (await post('/api/terrain/generate',input)).json(),again=await (await post('/api/terrain/generate',input)).json();assert.equal(first.job.job_id,again.job.job_id);
  const image=await fetch(base+first.job.image_url);assert.equal(image.status,200);const bytes=Buffer.from(await image.arrayBuffer());assert.equal(bytes.readUInt32BE(0),0x89504e47);
  const query=await (await post('/api/terrain/query',{provider_task_id:input.client_request_id,job_id:first.job.job_id})).json();assert.equal(query.provider_task_id,input.client_request_id);
  assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/%2e%2e%5cpackage.json')).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
