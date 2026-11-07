import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PROJECT_ROOT} from '../image-card/config.mjs';
import {validId} from '../image-card/service.mjs';
import {TerrainBackgroundPipeline} from './pipeline.mjs';
import {decodePng,alphaQuality,preservationQuality} from './alpha.mjs';
import {ReplicateRemover,REMOVER_VERSION} from './replicate.mjs';
export const ROUTED_ALPHA_VERSION='terrain-dual-alpha-v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
export class RoutedTerrainPipeline {
  constructor({settings,storageRoot=join(PROJECT_ROOT,'.local/terrain-candidates'),remover=new ReplicateRemover(),legacy}={}){
    this.settings=settings;this.storageRoot=storageRoot;this.outputRoot=join(storageRoot,'.routed-alpha');this.remover=remover;this.legacy=legacy||new TerrainBackgroundPipeline({storageRoot});this.pending=new Map();
  }
  async decorate(job){
    if(!job||job.provider!=='qwen'||job.request_status!=='succeeded')return job;
    if(!job.generation_route||job.generation_route==='legacy-local')return this.legacy.decorate(job);
    const key=job.provider_task_id;if(!validId(key))throw Error('Invalid terrain id');
    if(!this.pending.has(key))this.pending.set(key,this.run(job).finally(()=>this.pending.delete(key)));
    const result=await this.pending.get(key),ready=result.status==='ready';
    return {...job,request_status:result.status==='processing'?'running':job.request_status,original_image_url:`/api/terrain-images/${key}`,
      image_url:result.cutoutSha256?`/api/terrain-cutouts/${key}`:undefined,
      background_removal:{version:ROUTED_ALPHA_VERSION,status:result.status,method:job.generation_route==='native-alpha'?'native-alpha':(job.generation_route==='opaque'?'none':'851-labs/background-remover'),route:job.generation_route,source_sha256:result.sourceSha256,transparent_fraction:result.quality?.transparentPixels/(result.quality?.totalPixels||1)||0,warnings:result.warnings||[],message:job.generation_route==='opaque'?'本次为不透明直出测试，未调用 851LAB 抠图':result.message,prediction_id:result.predictionId},
      calibration:{...job.calibration,status:'unverified',alphaVerified:ready,targetGroundRatio:job.calibration?.targetGroundRatio||752/448},error_message:ready?undefined:result.message};
  }
  async run(job){
    const id=job.provider_task_id,route=job.generation_route,original=await readFile(join(this.storageRoot,id+'.png')),sourceSha256=hash(original),directory=join(this.outputRoot,id),path=join(directory,'manifest.json');
    await mkdir(directory,{recursive:true});
    let state;try{state=JSON.parse(await readFile(path,'utf8'));}catch{}
    if(state&&(state.sourceSha256!==sourceSha256||state.route!==route))return {status:'needs_review',message:'原图或链路与处理记录不一致，已阻止重新扣费。',warnings:['source_or_route_mismatch']};
    const save=async()=>{await writeFile(path+'.tmp',JSON.stringify(state,null,2));await rename(path+'.tmp',path);};
    if(state?.cutoutSha256){try{if(hash(await readFile(join(directory,'cutout.png')))===state.cutoutSha256)return state;}catch{}return {...state,status:'failed',cutoutSha256:undefined,message:'派生图丢失或校验失败，原图保留；不会重提收费任务。'};}
    if(state?.status==='needs_review')return state;
    state??={version:ROUTED_ALPHA_VERSION,route,sourceSha256,createdAt:new Date().toISOString()};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try{
      let bytes=original;
      if(route==='qwen-851'){
        const token=this.settings?.backgroundConfig().apiToken;
        if(!token){state.status='failed';state.message='请在模型设置填写 Replicate Token；原图已保留，未提交抠图。';await save();return state;}
        if(state.submission==='submitting'||state.submission==='unknown'){state.status='failed';state.message='抠图提交状态待核查，已禁止自动重提，避免重复扣费。';await save();return state;}
        let prediction;
        if(state.predictionId){
          if(state.providerFailed){state.status='failed';state.message='851 Labs 任务失败；原图保留，不会自动创建新收费任务。';await save();return state;}
          prediction=await this.remover.query(state.predictionId,token,controller.signal);
        }else{
          prediction=await this.remover.submit(original,token,controller.signal,async()=>{
            // Cross-process exclusion: even two preview/server processes cannot bill twice.
            const lock=await open(join(directory,'prediction-submission.lock'),'wx');await lock.close();
            state.submission='submitting';state.status='processing';state.removerVersion=REMOVER_VERSION;await save();
          });
        }
        if(!prediction?.id||!/^[a-z0-9]{8,100}$/i.test(prediction.id))throw Error('Missing prediction id');
        state.predictionId=prediction.id;state.submission='known';state.status='processing';await save();
        if(['failed','canceled'].includes(prediction.status)){state.status='failed';state.providerFailed=true;state.message='851 Labs 任务失败；原图保留，不会重新生图或自动重提抠图。';await save();return state;}
        if(prediction.status!=='succeeded'){state.message='851 Labs 正在处理，可继续查询当前任务。';await save();return state;}
        bytes=await this.remover.download(prediction.output,token,controller.signal);
      }else if(route==='opaque'){
        const decoded=decodePng(bytes);
        Object.assign(state,{status:'ready',warnings:[],cutoutSha256:hash(bytes),width:decoded.width,height:decoded.height,message:undefined,isOpaqueDirect:true});
        await writeFile(join(directory,'cutout.png.tmp'),bytes);await rename(join(directory,'cutout.png.tmp'),join(directory,'cutout.png'));await save();return state;
      }else if(route!=='native-alpha')throw Error('Unknown generation route');
      const decoded=decodePng(bytes),quality=alphaQuality(decoded),preservation=route==='qwen-851'?preservationQuality(decodePng(original),decoded):undefined;
      const ready=quality.ready&&(!preservation||preservation.ready);
      Object.assign(state,{status:ready?'ready':'needs_review',quality,preservation,warnings:[...quality.warnings,...(preservation?.warnings||[])],cutoutSha256:hash(bytes),width:decoded.width,height:decoded.height,
        message:ready?undefined:route==='native-alpha'?'原生透明未通过检查，原图保留；不会自动重生或改走收费抠图。':'抠图透明度或整块地形保留检查未通过，待审核，暂不能放入地图。'});
      await writeFile(join(directory,'cutout.png.tmp'),bytes);await rename(join(directory,'cutout.png.tmp'),join(directory,'cutout.png'));await save();return state;
    }catch(error){
      if(error.code==='EEXIST'){
        let latest;try{latest=JSON.parse(await readFile(path,'utf8'));}catch{}
        return {...(latest||state),status:latest?.status==='ready'?'ready':'processing',message:'同一图片已有处理任务，请继续查询；未重复提交。'};
      }
      state.status='failed';state.message='背景处理未完成，请继续查询原任务；原始生图已保留，不会重新生成。';
      if(state.submission==='submitting'){
        state.submission=error?.details?.submissionRejected?'rejected':'unknown';
        if(state.submission==='rejected')await unlink(join(directory,'prediction-submission.lock')).catch(()=>{});
      }
      await save();return state;
    }finally{clearTimeout(timer);}
  }
  async image(id){
    if(!validId(id))throw Error('Invalid terrain image id');
    let raw;try{raw=await readFile(join(this.outputRoot,id,'manifest.json'),'utf8');}catch{return this.legacy.image(id);}
    const state=JSON.parse(raw),bytes=await readFile(join(this.outputRoot,id,'cutout.png'));
    if(state.version!==ROUTED_ALPHA_VERSION||!state.cutoutSha256||hash(bytes)!==state.cutoutSha256)throw Error('Derived image unavailable');return bytes;
  }
}
