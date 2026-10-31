import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {PROJECT_ROOT} from '../image-card/config.mjs';
import {validId} from '../image-card/service.mjs';
import {validatePng} from '../image-card/png.mjs';
import {prepareBackgroundRemovalReview} from './offline.mjs';
export const BACKGROUND_PIPELINE_VERSION='terrain-alpha-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export class TerrainBackgroundPipeline {
  constructor({storageRoot=join(PROJECT_ROOT,'.local/terrain-candidates'),pythonExecutable,processor=prepareBackgroundRemovalReview}={}){
    this.storageRoot=resolve(storageRoot);this.outputRoot=join(this.storageRoot,'.cutouts');this.processor=processor;this.pending=new Map();
    const local=join(PROJECT_ROOT,'.local/background-removal-venv/Scripts/python.exe');
    this.python=pythonExecutable||process.env.LIFE_MAP_BG_PYTHON||(existsSync(local)?local:'python');
  }
  async process(id){
    if(!validId(id))throw Error('Invalid terrain image ID');
    if(this.pending.has(id))return this.pending.get(id);
    const promise=this.run(id);this.pending.set(id,promise);
    try{return await promise;}finally{this.pending.delete(id);}
  }
  async run(id){
    const originalPath=join(this.storageRoot,`${id}.png`),sourceSha256=hash(await readFile(originalPath));
    const directory=join(this.outputRoot,id),manifestPath=join(directory,'manifest.json');
    try{
      const saved=JSON.parse(await readFile(manifestPath,'utf8'));
      if(saved.version===BACKGROUND_PIPELINE_VERSION&&saved.sourceSha256===sourceSha256&&saved.status!=='failed'&&hash(await readFile(join(directory,'cutout.png')))===saved.cutoutSha256)return saved;
    }catch{/* Rebuild missing/corrupt derived files without generating another image. */}
    await mkdir(directory,{recursive:true});
    try{
      const result=await this.processor({sourcePath:originalPath,outputRoot:directory,pythonExecutable:this.python,jobId:'process',timeoutMs:45000});
      const report=result.report,produced=resolve(result.directory,'result.png');
      if(report.sourceSha256!==sourceSha256||report.publishAllowed!==false||!produced.startsWith(directory+sep))throw Error('Invalid preservation report');
      const bytes=await readFile(produced),dimensions=validatePng(bytes);
      if(dimensions.width!==report.width||dimensions.height!==report.height||report.rgbChangedPixels!==0)throw Error('Invalid processed image');
      const ready=report.reviewState==='ready_for_review'&&report.quality.transparentPixels>0&&['border-connected-color','existing-alpha-preserved'].includes(report.method);
      const metadata={version:BACKGROUND_PIPELINE_VERSION,status:ready?'ready':'needs_review',method:report.method,sourceSha256,cutoutSha256:hash(bytes),transparentPixels:report.quality.transparentPixels,totalPixels:report.width*report.height,width:report.width,height:report.height,warnings:report.warnings||[],timingsMs:report.timingsMs,createdAt:new Date().toISOString(),publishAllowed:false};
      await writeFile(join(directory,'cutout.png.tmp'),bytes);await rename(join(directory,'cutout.png.tmp'),join(directory,'cutout.png'));
      await writeFile(`${manifestPath}.tmp`,JSON.stringify(metadata,null,2));await rename(`${manifestPath}.tmp`,manifestPath);return metadata;
    }catch{return {version:BACKGROUND_PIPELINE_VERSION,status:'failed',sourceSha256,method:'unprocessed',transparentPixels:0,totalPixels:0,publishAllowed:false,message:'背景处理暂时未完成，可继续查询同一任务；不会重新调用生图。'};}
  }
  async decorate(job){
    if(!job||job.provider!=='qwen'||job.request_status!=='succeeded')return job;
    let metadata;try{metadata=await this.process(job.provider_task_id);}catch{metadata={version:BACKGROUND_PIPELINE_VERSION,status:'failed',method:'unprocessed',transparentPixels:0,totalPixels:0};}
    const ready=metadata.status==='ready';
    return {...job,original_image_url:job.original_image_url||job.image_url||`/api/terrain-images/${job.provider_task_id}`,
      image_url:metadata.transparentPixels>0?`/api/terrain-cutouts/${job.provider_task_id}`:undefined,
      background_removal:{version:metadata.version,status:metadata.status,method:metadata.method,source_sha256:metadata.sourceSha256,transparent_fraction:metadata.totalPixels?metadata.transparentPixels/metadata.totalPixels:0},
      calibration:{...job.calibration,status:'unverified',alphaVerified:ready,targetGroundRatio:job.calibration?.targetGroundRatio||752/448},
      error_message:ready?undefined:metadata.message||'背景边缘待审核，暂不能选入地图。原图已保留。'};
  }
  async image(id){
    if(!validId(id))throw Error('Invalid terrain image ID');
    const directory=join(this.outputRoot,id),metadata=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')),bytes=await readFile(join(directory,'cutout.png'));
    if(metadata.version!==BACKGROUND_PIPELINE_VERSION||!metadata.transparentPixels||hash(bytes)!==metadata.cutoutSha256)throw Error('Derived image unavailable');return bytes;
  }
}
