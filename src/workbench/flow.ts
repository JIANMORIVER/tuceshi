import type {LifeInterpretationResponse} from '../services/life-interpretation-service.js';
import {buildDiaryFocusCandidates} from '../services/diary-focus.js';
import {recommendDefaultFocusEvents,generatePotentialInquiries,type VisualizableEventCandidate} from '../services/event-aggregation.js';
import {offlineVisualPlans,visualPlanToCandidate} from '../services/diary-dialogue-client.js';
import type {StageAPotentialInquiry,UserSupplementalAnswer,SymbolicSceneCandidatePlan} from '../contracts/dual-stage-contract.js';
import type {GenerationJob} from '../contracts/image-generation-contract.js';
import type {PublicModelSettings} from '../services/model-settings-client.js';
import {approveTerrain,terrainUsable,hasTerrainApproval} from '../world/domain/terrainReview.js';
import {createSnapshot} from './snapshot.js';
export const STORAGE_KEY='life-map.image-workbench.v1';
export type Stage='write'|'focus'|'inquiry'|'results'|'selected';
export type Candidate={id:'candidate_1'|'candidate_2';plan:SymbolicSceneCandidatePlan;submissionId:string;status:'not_started'|'submitting'|'known'|'unknown';job?:GenerationJob;error?:string};
export type Experiment={version:1;id:string;date:string;stage:Stage;notes:string[];rawText:string;provider:'mock'|'deepseek'|'qwen';pipeline:{route:'native-alpha'|'qwen-851';model:string};analysis?:LifeInterpretationResponse;focuses:VisualizableEventCandidate[];focusIds:string[];intro:string;questions:StageAPotentialInquiry[];answers:Record<string,{option?:string;text?:string}>;extra:string;candidates:Candidate[];selectedId?:string};
export interface Storage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export interface Api {call<T>(path:string,body?:unknown):Promise<T>}
export class WorkbenchApi implements Api {
 async call<T>(path:string,body?:unknown):Promise<T>{
  if(body!==undefined){const session=await fetch('/api/model-settings',{cache:'no-store'});if(!session.ok)throw new Error('无法建立模型会话，请刷新后重试。');}
  const response=await fetch(path,{...(body===undefined?{cache:'no-store' as const}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('服务未返回 JSON，请启动独立 Node 服务。');
  const value=await response.json();if(!response.ok)throw new Error(value.error||`请求失败 (${response.status})`);return value as T;
 }
}
const date=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function freshExperiment():Experiment{return {version:1,id:crypto.randomUUID(),date:date(),stage:'write',notes:[''],rawText:'',provider:'mock',pipeline:{route:'native-alpha',model:'qwen-image-2.1-turbo'},focuses:[],focusIds:[],intro:'',questions:[],answers:{},extra:'',candidates:[]};}
export function collectAnswers(exp:Experiment):UserSupplementalAnswer[]{
 const answers=exp.questions.flatMap(q=>{const draft=exp.answers[q.question_id],text=[draft?.option,draft?.text?.trim()].filter(Boolean).join('；');return text?[{question_id:q.question_id,target_event_id:q.target_event_id,question_text:q.question_text,final_answer:text,answered_at:new Date().toISOString()}]:[];});
 if(exp.extra.trim())answers.push({question_id:'extra',target_event_id:'extra',question_text:'其他想留下的细节',final_answer:exp.extra.trim(),answered_at:new Date().toISOString()});return answers;
}
/** All paid submission identifiers are durably saved BEFORE fetch. No automatic resubmit or hidden retries. */
export class Workbench {
 private listeners=new Set<()=>void>();private submitting=new Set<string>();private working=false;
 state:Experiment;busy=false;error='';
 constructor(readonly storage:Storage,readonly api:Api=new WorkbenchApi()){
  const raw=storage.getItem(STORAGE_KEY);this.state=freshExperiment();
  if(raw){try{const value=JSON.parse(raw);if(value.version!==1||!value.id||!['write','focus','inquiry','results','selected'].includes(value.stage)||!Array.isArray(value.notes)||!Array.isArray(value.candidates)||!Array.isArray(value.questions))throw Error('invalid');this.state=value;}catch{this.error='上次实验记录无法读取，已保留原始缓存。请先导出缓存备份或新建实验。';}}
 }
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private emit(){this.listeners.forEach(fn=>fn());}
 private save(next:Experiment){this.storage.setItem(STORAGE_KEY,JSON.stringify(next));this.state=next;this.emit();}
 edit(patch:Partial<Experiment>){this.save({...this.state,...patch});}
 private async task(action:()=>Promise<void>){if(this.working)return;this.working=true;this.busy=true;this.error='';this.emit();try{await action();}catch(error){this.error=error instanceof Error?error.message:'处理失败，请手动重试。';}finally{this.working=false;this.busy=false;this.emit();}}
 async analyze(){if(this.state.stage!=='write')return;await this.task(async()=>{
  const rawText=this.state.notes.filter(note=>note.trim()).join('\n\n');if(!rawText.trim()||rawText.length>12000)throw Error('请填写合计1–12000字的日记便签。');
  const settings=await this.api.call<PublicModelSettings>('/api/model-settings');
  // Preflight persistence also prevents starting model work when local storage is unavailable.
  this.edit({rawText});
  const result=await this.api.call<LifeInterpretationResponse>('/api/diary/interpret',{input:rawText});
  const focuses=buildDiaryFocusCandidates(result.envelope.diary_interpretation,rawText);
  this.edit({analysis:result,focuses,focusIds:recommendDefaultFocusEvents(focuses),provider:result.debug.provider as Experiment['provider'],pipeline:{route:settings.generationRoute==='qwen-851'?'qwen-851':'native-alpha',model:settings.generationRoute==='qwen-851'?settings.image.model:settings.nativeImageModel||'qwen-image-2.1-turbo'},stage:'focus'});
 });}
 async inquire(){if(this.state.stage!=='focus'&&this.state.stage!=='inquiry')return;await this.task(async()=>{
  if(!this.state.focusIds.length||this.state.focusIds.length>3)throw Error('请选择1–3项重点。');this.edit({stage:'inquiry'});
  const focuses=this.state.focuses.filter(f=>this.state.focusIds.includes(f.event_id));
  if(this.state.provider==='mock'){this.edit({intro:'离线细节建议 · 可以不回答直接生成模拟图',questions:generatePotentialInquiries(focuses,this.state.rawText)});return;}
  const result=await this.api.call<{intro:string;questions:StageAPotentialInquiry[]}>('/api/diary/inquire',{rawText:this.state.rawText,focuses});this.edit(result);
 });}
 back(){if(this.busy||this.state.candidates.length)return;if(this.state.stage==='inquiry')this.edit({stage:'focus'});else if(this.state.stage==='focus')this.edit({stage:'write',analysis:undefined,questions:[],answers:{},extra:''});}
 async generate(){if(this.state.stage!=='inquiry'||this.state.candidates.length)return;await this.task(async()=>{
  const exp=this.state,focuses=exp.focuses.filter(f=>exp.focusIds.includes(f.event_id)),answers=collectAnswers(exp);
  const result=exp.provider==='mock'?{candidates:offlineVisualPlans(focuses)}:await this.api.call<{candidates:Parameters<typeof visualPlanToCandidate>[0][]}>('/api/diary/scene-plan',{rawText:exp.rawText,focuses,answers});
  if(result.candidates.length!==2)throw Error('必须返回两个完整构图方案，尚未提交生图。');
  const candidates=result.candidates.map(plan=>({id:plan.id,plan:visualPlanToCandidate(plan,focuses),submissionId:crypto.randomUUID(),status:'not_started' as const}));
  this.edit({stage:'results',candidates});
  await Promise.all(candidates.map(candidate=>this.submit(candidate.id)));
 });}
 private snapshot(){const e=this.state,a=e.analysis!;return createSnapshot(e.date,e.rawText,{activities:a.envelope.diary_interpretation.activities,places:a.envelope.diary_interpretation.places,explicit_emotions:a.envelope.diary_interpretation.explicit_emotions,keywords:a.annotation.keywords,visualizable_events:e.focuses,potential_inquiries:e.questions},collectAnswers(e));}
 private candidate(id:string){const c=this.state.candidates.find(c=>c.id===id);if(!c)throw Error('找不到方案。');return c;}
 private patchCandidate(id:string,patch:Partial<Candidate>){this.edit({candidates:this.state.candidates.map(c=>c.id===id?{...c,...patch}:c)});}
 async submit(id:string){
  const candidate=this.candidate(id);if(candidate.status!=='not_started'||this.submitting.has(candidate.submissionId))return;
  // This synchronous write MUST succeed before the first paid request.
  this.patchCandidate(id,{status:'submitting',error:undefined});this.submitting.add(candidate.submissionId);
  try{
   const result=await this.api.call<{job:GenerationJob}>('/api/terrain/generate',{candidate_id:candidate.id,planning_run_id:this.state.id,client_request_id:candidate.submissionId,focus_event_ids:this.state.focusIds,snapshot:this.snapshot(),candidate_plan:candidate.plan,model_config:{provider:this.state.provider==='mock'?'mock':'qwen'},image_pipeline:this.state.pipeline});
   if(!result.job?.job_id)throw Error('响应缺少任务标识，请查询原任务。');this.patchCandidate(id,{job:result.job,status:'known'});
  }catch(error){this.patchCandidate(id,{status:'unknown',error:(error instanceof Error?error.message:'提交状态未知')+'；不自动重提，可查询原任务。'});}
  finally{this.submitting.delete(candidate.submissionId);}
 }
 async query(id:string){await this.task(async()=>{const c=this.candidate(id);if(c.status==='not_started')throw Error('尚未提交，请明确开始此方案。');const result=await this.api.call<GenerationJob>('/api/terrain/query',{provider_task_id:c.submissionId,job_id:c.job?.job_id||`terrain:${c.submissionId}`,planning_run_id:this.state.id,candidate_id:c.id});
  const reviewed={...result,manual_review:c.job?.manual_review},job=hasTerrainApproval(reviewed)?reviewed:result;
  this.patchCandidate(id,{job,status:'known',error:undefined});
  if(this.state.selectedId===id&&!terrainUsable(job))this.edit({stage:'results',selectedId:undefined});
 });}
 approve(id:string){this.patchCandidate(id,{job:approveTerrain(this.candidate(id).job!)});}
 select(id:string){if(!terrainUsable(this.candidate(id).job))throw Error('方案尚未就绪或待审核。');this.edit({stage:'selected',selectedId:id});}
 reset(){if(this.busy||this.submitting.size)throw Error('请等待当前请求完成。');this.save(freshExperiment());this.error='';this.emit();}
 export(){return JSON.stringify(this.state,null,2);}
}
