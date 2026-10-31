import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {crc32,mockPng} from '../server/image-card/png.mjs';
import {ModelSettings} from '../server/ai/models.mjs';
import {CompleteTerrainGeneration,buildNativeScenePrompt} from '../server/ai/complete-terrain.mjs';
import {DashScopeAdapter} from '../server/image-card/dashscope.mjs';
import {decodePng,alphaQuality,preservationQuality} from '../server/background-removal/alpha.mjs';
import {RoutedTerrainPipeline} from '../server/background-removal/routed-pipeline.mjs';
import {ReplicateRemover,REMOVER_VERSION} from '../server/background-removal/replicate.mjs';

export function fixturePng({opaque=false,base=true,empty=false,noise=0,filter=0}={}){
 const w=64,h=64,rgba=Buffer.alloc(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const ground=base&&y>=30&&y<54&&x>=10&&x<54,house=y>=14&&y<36&&x>=24&&x<44,fg=!empty&&(ground||house),i=(y*w+x)*4;
  rgba.set(fg?(ground?[85,125,45,255]:[120,65,30,255]):[255,255,255,opaque?255:noise],i);
 }
 const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
 const raw=Buffer.alloc((w*4+1)*h);
 for(let y=0;y<h;y++){raw[y*(w*4+1)]=filter;for(let x=0;x<w*4;x++){const i=y*w*4+x,a=x>=4?rgba[i-4]:0,b=y?rgba[i-w*4]:0,c=y&&x>=4?rgba[i-w*4-4]:0;raw[y*(w*4+1)+1+x]=(rgba[i]-(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0))&255;}}
 const chunk=(name,payload)=>{const t=Buffer.from(name),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(payload.length);c.writeUInt32BE(crc32(Buffer.concat([t,payload])));return Buffer.concat([n,t,payload,c]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const input=()=>({candidate_id:'candidate_1',planning_run_id:'synthetic-batch',client_request_id:randomUUID(),snapshot:{input_text:'测试日记'},candidate_plan:{primary_subject:'小屋和树',scene_description:'一个完整的等距像素生活场景，中央是一座小屋，门前有一条石头小路，路边站着小小的人物，两棵树分别在屋后和道路旁，所有主体位于同一个保留土壤侧面的菱形草地底座，整个地块的外部为纯白背景，画面内没有任何文字或标签。'},model_config:{provider:'qwen'}});
const hash=b=>createHash('sha256').update(b).digest('hex');
const settings=()=>new ModelSettings({DASHSCOPE_API_KEY:'fixture-qwen-key',REPLICATE_API_TOKEN:'fixture-replicate-key',LIFE_MAP_IMAGE_SIZE:'512*512'});
async function fixture(route='qwen-851',remover){
 const storageRoot=await mkdtemp(join(tmpdir(),'life-map-dual-')),id=randomUUID(),original=fixturePng({opaque:route!=='native-alpha'});await writeFile(join(storageRoot,id+'.png'),original);
 const s=settings();return {storageRoot,id,original,settings:s,pipeline:new RoutedTerrainPipeline({storageRoot,settings:s,remover}),job:{provider:'qwen',request_status:'succeeded',generation_route:route,provider_task_id:id,image_url:'/original',job_id:'fixture'}};
}

test('PNG alpha inspection reconstructs all five filters, rejects opaque RGBA/RGB/empty and accepts measured low-alpha noise',()=>{
 const base=decodePng(fixturePng());for(let filter=1;filter<5;filter++){const d=decodePng(fixturePng({filter}));assert.deepEqual(d.alpha,base.alpha);assert.deepEqual(d.rgb,base.rgb);}
 assert.equal(alphaQuality(base).ready,true);assert.equal(alphaQuality(decodePng(fixturePng({opaque:true}))).ready,false);assert.equal(alphaQuality(decodePng(mockPng(64,64))).ready,false);assert.equal(alphaQuality(decodePng(fixturePng({empty:true}))).ready,false);assert.equal(alphaQuality(decodePng(fixturePng({noise:3}))).ready,true);
});
test('preservation guard flags a removed base and accepts a complete island without modifying image bytes',()=>{
 const original=decodePng(fixturePng({opaque:true}));assert.equal(preservationQuality(original,decodePng(fixturePng())).ready,true);
 assert.ok(preservationQuality(original,decodePng(fixturePng({base:false}))).warnings.includes('possible_terrain_base_removed'));
});
test('two route settings are atomic and never expose Replicate credentials',()=>{
 const s=settings();s.update({textProvider:'qwen',generationRoute:'native-alpha',nativeImageModel:'qwen-image-2.1-pro',replicateKey:'fixture-session-key'});
 assert.equal(s.terrainConfig().model,'qwen-image-2.1-pro');assert.equal(s.info().backgroundRemoval.apiConfigured,true);assert.ok(!JSON.stringify(s.info()).includes('fixture-session-key'));
 const before=s.info();assert.throws(()=>s.update({textProvider:'mock',generationRoute:'invalid',replicateKey:'changed'}));assert.deepEqual(s.info(),before);
});
test('native request keeps scene, removes white-background constraints and omits unsupported negative_prompt',async()=>{
 const prompt=buildNativeScenePrompt('小屋，外部纯白。');assert.ok(prompt.positive.startsWith('This is an RGBA'));assert.ok(!prompt.positive.includes('外部纯白'));assert.match(prompt.positive,/整个菱形底座/);
 let sent;await new DashScopeAdapter(async(url,options)=>{
  if(options?.method==='POST'){sent=JSON.parse(options.body);return Response.json({output:{choices:[{message:{content:[{image:'https://fixture.oss-cn-beijing.aliyuncs.com/image.png'}]}}]}});}
  assert.equal(options.headers,undefined);return new Response(fixturePng());
 }).generate({...settings().imageConfig(),model:'qwen-image-2.1-turbo'},prompt,new AbortController().signal);
 assert.equal(sent.parameters.n,1);assert.equal(sent.parameters.prompt_extend,false);assert.equal(sent.parameters.negative_prompt,undefined);
});
test('native pipeline preserves raw bytes, makes zero cloud calls and caches across restart',async()=>{
 const f=await fixture('native-alpha',{submit(){assert.fail('no matting for native');}});
 const a=await f.pipeline.decorate(f.job);assert.equal(a.background_removal.status,'ready');assert.equal(a.background_removal.method,'native-alpha');assert.deepEqual(await f.pipeline.image(f.id),f.original);
 const restarted=new RoutedTerrainPipeline({storageRoot:f.storageRoot});assert.deepEqual(await restarted.decorate(f.job),a);assert.deepEqual(await readFile(join(f.storageRoot,f.id+'.png')),f.original);
});
test('opaque native output stays under review and never silently invokes a different paid chain',async()=>{
 const f=await fixture('native-alpha',{submit(){assert.fail('implicit fallback');}});await writeFile(join(f.storageRoot,f.id+'.png'),fixturePng({opaque:true}));
 const job=await f.pipeline.decorate(f.job);assert.equal(job.background_removal.status,'needs_review');assert.equal(job.calibration.alphaVerified,false);
});
test('cloud pipeline shares concurrent work, preserves source and reuses downloaded output after restart',async()=>{
 let submissions=0;const remover={async submit(_,token,signal,before){assert.equal(token,'fixture-replicate-key');await before();submissions++;return {id:'prediction12345',status:'succeeded',output:'https://replicate.delivery/file.png'};},async download(){return fixturePng();}};
 const f=await fixture('qwen-851',remover);const [a,b]=await Promise.all([f.pipeline.decorate(f.job),f.pipeline.decorate(f.job)]);assert.deepEqual(a,b);assert.equal(submissions,1);assert.equal(a.background_removal.status,'ready');
 assert.deepEqual(await readFile(join(f.storageRoot,f.id+'.png')),f.original);assert.equal((await new RoutedTerrainPipeline({storageRoot:f.storageRoot,settings:f.settings,remover:{submit(){assert.fail('rebill');}}}).decorate(f.job)).background_removal.status,'ready');
 const saved=await readFile(join(f.storageRoot,'.routed-alpha',f.id,'manifest.json'),'utf8');assert.ok(!saved.includes('fixture-replicate-key'));
});
test('pending cloud prediction resumes with GET only after restart',async()=>{
 let submissions=0,queries=0;const remover={async submit(_,__,___,before){await before();submissions++;return {id:'prediction12345',status:'processing'};},async query(){queries++;return {id:'prediction12345',status:'succeeded',output:'https://replicate.delivery/file.png'};},async download(){return fixturePng();}};
 const f=await fixture('qwen-851',remover);assert.equal((await f.pipeline.decorate(f.job)).request_status,'running');
 const resumed=await new RoutedTerrainPipeline({storageRoot:f.storageRoot,settings:f.settings,remover}).decorate(f.job);assert.equal(resumed.background_removal.status,'ready');assert.equal(submissions,1);assert.equal(queries,1);
});
test('two independent server instances cannot submit the same paid cloud operation twice',async()=>{
 let calls=0;const remover={async submit(_,__,___,before){await before();calls++;await new Promise(r=>setTimeout(r,20));return {id:'prediction12345',status:'processing'};}};
 const f=await fixture('qwen-851',remover),other=new RoutedTerrainPipeline({storageRoot:f.storageRoot,settings:f.settings,remover});
 const results=await Promise.all([f.pipeline.decorate(f.job),other.decorate(f.job)]);assert.equal(calls,1);assert.ok(results.every(r=>r.request_status==='running'));
});
test('unknown paid submission is durably blocked from automatic resubmission',async()=>{
 let submissions=0;const f=await fixture('qwen-851',{async submit(_,__,___,before){await before();submissions++;throw Error('network disconnected after POST');}});
 assert.equal((await f.pipeline.decorate(f.job)).background_removal.status,'failed');await f.pipeline.decorate(f.job);await new RoutedTerrainPipeline({storageRoot:f.storageRoot,settings:f.settings,remover:{submit(){assert.fail('rebill');}}}).decorate(f.job);assert.equal(submissions,1);
});
test('download retry queries the accepted cloud job without rebilling',async()=>{
 let submissions=0,downloads=0;const remover={async submit(_,__,___,before){await before();submissions++;return {id:'prediction12345',status:'succeeded',output:'https://replicate.delivery/file.png'};},async query(){return {id:'prediction12345',status:'succeeded',output:'https://replicate.delivery/file.png'};},async download(){if(++downloads===1)throw Error('download interrupted');return fixturePng();}};
 const f=await fixture('qwen-851',remover);assert.equal((await f.pipeline.decorate(f.job)).background_removal.status,'failed');assert.equal((await f.pipeline.decorate(f.job)).background_removal.status,'ready');assert.equal(submissions,1);
});
test('cloud foreground loss is held for review rather than published',async()=>{
 const f=await fixture('qwen-851',{async submit(_,__,___,before){await before();return {id:'prediction12345',status:'succeeded',output:'https://replicate.delivery/file.png'};},async download(){return fixturePng({base:false});}});
 const job=await f.pipeline.decorate(f.job);assert.equal(job.background_removal.status,'needs_review');assert.ok(job.background_removal.warnings.includes('possible_terrain_base_removed'));assert.equal(job.calibration.alphaVerified,false);
});
test('new cloud jobs fail before Qwen if no Replicate token; saved native jobs retain their route',async()=>{
 const s=new ModelSettings({DASHSCOPE_API_KEY:'fixture-qwen-key',LIFE_MAP_IMAGE_SIZE:'512*512'});s.update({textProvider:'qwen',generationRoute:'qwen-851'});let calls=0;
 const service=new CompleteTerrainGeneration(s,{storageRoot:await mkdtemp(join(tmpdir(),'life-map-dual-generate-')),adapter:{async generate(){calls++;return {bytes:fixturePng()};}}});
 await assert.rejects(service.generate(input()),{code:'REPLICATE_KEY_MISSING'});assert.equal(calls,0);
 s.update({textProvider:'qwen',generationRoute:'native-alpha'});const request=input(),first=await service.generate(request);assert.equal(first.job.generation_route,'native-alpha');
 s.update({textProvider:'qwen',generationRoute:'qwen-851'});assert.deepEqual(await service.generate(request),first);assert.equal(calls,1);
});
test('Replicate transport uses pinned version, multipart upload, correct soft alpha options and bounded trusted output host',async()=>{
 const calls=[];const adapter=new ReplicateRemover(async(url,options)=>{calls.push({url,options});
  if(url.endsWith('/files'))return Response.json({urls:{get:'https://api.replicate.com/v1/files/fixture12345'}});
  if(url.endsWith('/predictions'))return Response.json({id:'prediction12345',status:'processing'});
  return new Response(fixturePng());
 });
 let protectedMarker=false;await adapter.submit(fixturePng({opaque:true}),'fixture-token',new AbortController().signal,async()=>{protectedMarker=true;});assert.equal(protectedMarker,true);
 assert.ok(calls[0].options.body instanceof FormData);assert.equal(calls[0].options.headers['content-type'],undefined);
 const request=JSON.parse(calls[1].options.body);assert.equal(request.version,REMOVER_VERSION);assert.equal(request.input.background_type,'rgba');assert.equal(request.input.reverse,false);assert.equal(request.input.threshold,0);assert.equal(request.input.format,'png');
 assert.ok(calls.every(call=>call.options.redirect==='manual'));
 const count=calls.length;await assert.rejects(adapter.download('http://127.0.0.1/secret','fixture-token'));await assert.rejects(adapter.download('https://evil.example/output.png','fixture-token'));assert.equal(calls.length,count);
 await adapter.download('https://replicate.delivery/output.png','fixture-token');assert.equal(calls.at(-1).options.headers.Authorization,'Bearer fixture-token');assert.equal(calls.at(-1).options.redirect,'manual');
});
