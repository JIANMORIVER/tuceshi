import type {LifeInterpretationResponse} from '../services/life-interpretation-service.js';
import {buildDiaryFocusCandidates} from '../services/diary-focus.js';
import {recommendDefaultFocusEvents,generatePotentialInquiries,type VisualizableEventCandidate} from '../services/event-aggregation.js';
import {offlineVisualPlans,visualPlanToCandidate} from '../services/diary-dialogue-client.js';
import type {StageAPotentialInquiry,UserSupplementalAnswer,SymbolicSceneCandidatePlan} from '../contracts/dual-stage-contract.js';
import type {GenerationJob} from '../contracts/image-generation-contract.js';
import type {PublicModelSettings} from '../services/model-settings-client.js';
import {approveTerrain,terrainUsable,hasTerrainApproval} from '../world/domain/terrainReview.js';
import {createSnapshot} from './snapshot.js';
import {
  PRESET_STYLE_PACKAGES,
  DEFAULT_I2I_RULES,
  type StylePackage,
  type ReferenceImage,
  type ImageToImageRules,
  type ReferenceImageRole
} from '../domain/experiment-rules.js';
import {
  exportDiaryInputSnapshot,
  validateAndParseDiarySnapshot
} from '../domain/diary-snapshot.js';

export const STORAGE_KEY='life-map.image-workbench.v1';
export type Stage='write'|'focus'|'inquiry'|'results'|'selected';
export type Candidate={id:'candidate_1'|'candidate_2';plan:SymbolicSceneCandidatePlan;submissionId:string;status:'not_started'|'submitting'|'known'|'unknown';job?:GenerationJob;error?:string};

export interface LabConfig {
  mode: 'text_to_image' | 'image_to_image';
  selectedStyleId: string;
  customStyleText?: string;
  customNegativeText?: string;
  referenceImages: ReferenceImage[];
  i2iRules: ImageToImageRules;
  frozenCandidateId?: 'candidate_1' | 'candidate_2';
}

export type Experiment={
  version:1;
  id:string;
  date:string;
  stage:Stage;
  notes:string[];
  rawText:string;
  provider:'mock'|'deepseek'|'qwen';
  pipeline:{route:'native-alpha'|'qwen-851';model:string};
  analysis?:LifeInterpretationResponse;
  focuses:VisualizableEventCandidate[];
  focusIds:string[];
  intro:string;
  questions:StageAPotentialInquiry[];
  answers:Record<string,{option?:string;text?:string}>;
  extra:string;
  candidates:Candidate[];
  selectedId?:string;
  lab:LabConfig;
};

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

export function freshExperiment():Experiment{
  return {
    version:1,
    id:crypto.randomUUID(),
    date:date(),
    stage:'write',
    notes:[''],
    rawText:'',
    provider:'mock',
    pipeline:{route:'native-alpha',model:'qwen-image-2.1-turbo'},
    focuses:[],
    focusIds:[],
    intro:'',
    questions:[],
    answers:{},
    extra:'',
    candidates:[],
    lab:{
      mode:'text_to_image',
      selectedStyleId:'preset-gentle-pixel',
      referenceImages:[],
      i2iRules:{...DEFAULT_I2I_RULES}
    }
  };
}

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
  if(raw){
    try{
      const value=JSON.parse(raw);
      if(value.version!==1||!value.id||!['write','focus','inquiry','results','selected'].includes(value.stage)||!Array.isArray(value.notes)||!Array.isArray(value.candidates)||!Array.isArray(value.questions))throw Error('invalid');
      if(!value.lab) {
        value.lab = {
          mode: 'text_to_image',
          selectedStyleId: 'preset-gentle-pixel',
          referenceImages: [],
          i2iRules: { ...DEFAULT_I2I_RULES }
        };
      }
      this.state=value;
    }catch{
      this.error='上次实验记录无法读取，已保留原始缓存。请先导出缓存备份或新建实验。';
    }
  }
 }
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private emit(){this.listeners.forEach(fn=>fn());}
 private save(next:Experiment){this.storage.setItem(STORAGE_KEY,JSON.stringify(next));this.state=next;this.emit();}
 edit(patch:Partial<Experiment>){this.save({...this.state,...patch});}

 syncModelSettings(settings: PublicModelSettings) {
  if (this.state.stage === 'results' || this.state.stage === 'selected') return;
  const provider = settings.textProvider === 'mock' ? 'mock' : (settings.textProvider as any);
  const pipeline = {
    route: settings.generationRoute === 'qwen-851' ? ('qwen-851' as const) : ('native-alpha' as const),
    model: settings.generationRoute === 'qwen-851' ? settings.image.model : (settings.nativeImageModel || 'qwen-image-2.1-turbo')
  };
  this.edit({ provider, pipeline });
 }

 setLab(patch:Partial<LabConfig>){
  const lab={...(this.state.lab||freshExperiment().lab),...patch};
  this.save({...this.state,lab});
 }

 addReferenceImage(image:ReferenceImage){
  const current=this.state.lab?.referenceImages||[];
  if(current.length>=3)throw Error('参考图最多支持添加 3 张。');
  this.setLab({referenceImages:[...current,image]});
 }

 removeReferenceImage(id:string){
  const current=this.state.lab?.referenceImages||[];
  this.setLab({referenceImages:current.filter(img=>img.id!==id)});
 }

 updateReferenceImageRole(id:string,role:ReferenceImageRole){
  const current=this.state.lab?.referenceImages||[];
  this.setLab({referenceImages:current.map(img=>img.id===id?{...img,role}:img)});
 }

 freezeCandidate(candidateId:'candidate_1'|'candidate_2'){
  this.setLab({frozenCandidateId:candidateId});
 }

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
 private snapshot() {
  const e = this.state;
  const a = e.analysis;
  const visualEvents = e.focuses;
  const keywords = a?.annotation?.keywords || e.focuses.map(f => f.title);
  const activities = a?.envelope?.diary_interpretation?.activities || [];
  const places = a?.envelope?.diary_interpretation?.places || [];
  const explicit_emotions = a?.envelope?.diary_interpretation?.explicit_emotions || [];
  return createSnapshot(
    e.date,
    e.rawText,
    {
      activities,
      places,
      explicit_emotions,
      keywords,
      brief_analysis: (a as any)?.envelope?.diary_interpretation?.scene_summary || '日记快照事实提炼',
      visualizable_events: visualEvents,
      potential_inquiries: e.questions
    },
    collectAnswers(e)
  );
 }

 exportDiarySnapshot(): string {
  const e = this.state;
  const snapshot = exportDiaryInputSnapshot({
    date: e.date,
    notes: e.notes,
    focuses: e.focuses,
    focusIds: e.focusIds,
    answers: collectAnswers(e),
    extra: e.extra
  });
  return JSON.stringify(snapshot, null, 2);
 }

 importDiarySnapshot(jsonStr: string): void {
  const snapshot = validateAndParseDiarySnapshot(jsonStr);
  const newId = crypto.randomUUID();
  const focuses: VisualizableEventCandidate[] = snapshot.selected_focuses.map(f => ({
    event_id: f.event_id,
    title: f.title,
    summary: f.title,
    focus_kind: (f.focus_kind as any) || 'event',
    evidence: f.evidence || '',
    related_fact_ids: [],
    event_type: 'activity',
    suggested_priority: 1,
    visual_cue_hint: f.title
  }));
  const focusIds = snapshot.selected_focuses.map(f => f.event_id);
  const questions: StageAPotentialInquiry[] = snapshot.supplemental_answers
    .filter(a => a.question_id !== 'extra')
    .map(a => ({
      question_id: a.question_id,
      target_event_id: a.target_event_id,
      question_text: a.question_text,
      answer_options: [],
      evidence: '',
      reason_for_asking: '日记快照导入'
    }));
  const answers: Record<string, { option?: string; text?: string }> = {};
  for (const ans of snapshot.supplemental_answers) {
    if (ans.question_id !== 'extra') {
      answers[ans.question_id] = { text: ans.final_answer };
    }
  }
  const extra = snapshot.extra_detail || snapshot.supplemental_answers.find(a => a.question_id === 'extra')?.final_answer || '';

  const currentLab = this.state.lab || { ...freshExperiment().lab };
  const currentProvider = this.state.provider;
  const currentPipeline = this.state.pipeline;

  this.save({
    ...freshExperiment(),
    id: newId,
    date: snapshot.diary_date || date(),
    notes: snapshot.notes,
    rawText: snapshot.notes.join('\n\n'),
    stage: 'inquiry',
    focuses,
    focusIds,
    questions,
    answers,
    extra,
    provider: currentProvider,
    pipeline: currentPipeline,
    lab: currentLab
  });
 }

 restoreFromRun(run: any, mode: 'input_only' | 'full_rules'): void {
  if (!run) throw new Error('无效的实验记录');
  const newId = crypto.randomUUID();
  const diaryCase = run.diary_case || {};
  const notes: string[] = Array.isArray(diaryCase.notes) && diaryCase.notes.length > 0 ? diaryCase.notes : [diaryCase.raw_text || ''];
  const rawText = diaryCase.raw_text || notes.join('\n\n');
  const rawFocuses = Array.isArray(diaryCase.focuses) ? diaryCase.focuses : [];
  const focuses: VisualizableEventCandidate[] = rawFocuses.map((f: any) => ({
    event_id: f.event_id || crypto.randomUUID(),
    title: f.title || '重点',
    summary: f.summary || f.title || '',
    focus_kind: f.focus_kind || 'event',
    evidence: f.evidence || '',
    related_fact_ids: f.related_fact_ids || [],
    event_type: f.event_type || 'activity',
    suggested_priority: f.suggested_priority || 1,
    visual_cue_hint: f.visual_cue_hint || f.title || ''
  }));
  const focusIds = focuses.map(f => f.event_id);

  const supplementalAnswers = Array.isArray(diaryCase.answers) ? diaryCase.answers : [];
  const questions: StageAPotentialInquiry[] = supplementalAnswers
    .filter((a: any) => a.question_id !== 'extra')
    .map((a: any) => ({
      question_id: a.question_id,
      target_event_id: a.target_event_id,
      question_text: a.question_text,
      answer_options: a.answer_options || [],
      evidence: a.evidence || '',
      reason_for_asking: '历史实验恢复'
    }));
  const answers: Record<string, { option?: string; text?: string }> = {};
  for (const ans of supplementalAnswers) {
    if (ans.question_id !== 'extra') {
      answers[ans.question_id] = { text: ans.final_answer };
    }
  }
  const extra = diaryCase.extra || supplementalAnswers.find((a: any) => a.question_id === 'extra')?.final_answer || '';

  const currentProvider = this.state.provider;
  const currentPipeline = this.state.pipeline;
  let nextLab = this.state.lab || { ...freshExperiment().lab };
  if (mode === 'full_rules') {
    nextLab = {
      mode: run.experiment_mode === 'image_to_image' ? 'image_to_image' : 'text_to_image',
      selectedStyleId: run.style_package?.style_id || 'preset-gentle-pixel',
      customStyleText: run.style_package?.style_text_rules,
      customNegativeText: run.style_package?.negative_rules,
      referenceImages: Array.isArray(run.reference_images) ? run.reference_images : [],
      i2iRules: run.i2i_rules ? { ...DEFAULT_I2I_RULES, ...run.i2i_rules } : { ...DEFAULT_I2I_RULES }
    };
  }

  this.save({
    ...freshExperiment(),
    id: newId,
    date: diaryCase.diary_date || date(),
    notes,
    rawText,
    stage: 'inquiry',
    focuses,
    focusIds,
    questions,
    answers,
    extra,
    provider: currentProvider,
    pipeline: currentPipeline,
    lab: nextLab
  });
 }

 async syncToArchive(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const exp = this.state;
    const activeStyle = PRESET_STYLE_PACKAGES.find(s => s.style_id === exp.lab?.selectedStyleId);
    const hasImage = exp.candidates.some(c => c.job?.image_url || c.job?.original_image_url);
    const status = exp.selectedId ? 'completed' : (hasImage ? 'completed' : 'pending');
    const runRecord = {
      experiment_id: exp.id,
      created_at: new Date().toISOString(),
      experiment_mode: exp.lab?.mode || 'text_to_image',
      status,
      diary_case: {
        diary_case_id: `case_${exp.id}`,
        diary_date: exp.date,
        notes: exp.notes,
        raw_text: exp.rawText,
        focuses: exp.focuses.filter(f => exp.focusIds.includes(f.event_id)),
        answers: collectAnswers(exp),
        extra: exp.extra
      },
      style_package: {
        style_id: exp.lab?.selectedStyleId || 'preset-gentle-pixel',
        name: activeStyle?.style_name || '自定义风格',
        style_text_rules: exp.lab?.customStyleText?.trim() || activeStyle?.style_text_rules || '',
        negative_rules: exp.lab?.customNegativeText?.trim() || activeStyle?.style_negative_rules || ''
      },
      i2i_rules: exp.lab?.i2iRules,
      reference_images: exp.lab?.referenceImages || [],
      candidates: exp.candidates.map(c => ({
        id: c.id,
        status: c.status,
        submission_id: c.submissionId,
        prompt: c.job?.submitted_prompt?.positive_prompt || '',
        original_image_url: c.job?.original_image_url || '',
        image_url: c.job?.image_url || '',
        review_status: c.job?.manual_review?.decision === 'approved' ? 'approved' : 'pending',
        review_comment: c.job?.manual_review?.reviewed_at ? '人工审核通过' : '',
        is_selected: exp.selectedId === c.id,
        model_info: {
          provider: exp.provider,
          pipeline: exp.pipeline
        }
      })),
      selected_candidate_id: exp.selectedId
    };
    await fetch('/api/archive/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runRecord)
    });
  } catch {
    // 归档同步仅作为持久化辅助，不阻塞主流程
  }
 }
 private candidate(id:string){const c=this.state.candidates.find(c=>c.id===id);if(!c)throw Error('找不到方案。');return c;}
 private patchCandidate(id:string,patch:Partial<Candidate>){this.edit({candidates:this.state.candidates.map(c=>c.id===id?{...c,...patch}:c)});}
 async submit(id:string){
  const candidate=this.candidate(id);if(candidate.status!=='not_started'||this.submitting.has(candidate.submissionId))return;
  // This synchronous write MUST succeed before the first paid request.
  this.patchCandidate(id,{status:'submitting',error:undefined});this.submitting.add(candidate.submissionId);
  try{
   const lab=this.state.lab||freshExperiment().lab;
   const activeStyle=PRESET_STYLE_PACKAGES.find(s=>s.style_id===lab.selectedStyleId);
   const lab_config={
    mode:lab.mode,
    style:lab.customStyleText?.trim()||activeStyle?.style_text_rules,
    negativeRules:lab.customNegativeText?.trim()||activeStyle?.style_negative_rules,
    reference_images:lab.referenceImages,
    i2i_rules:lab.i2iRules,
    selected_style_id:lab.selectedStyleId
   };
   const result=await this.api.call<{job:GenerationJob}>('/api/terrain/generate',{
    candidate_id:candidate.id,
    planning_run_id:this.state.id,
    client_request_id:candidate.submissionId,
    focus_event_ids:this.state.focusIds,
    snapshot:this.snapshot(),
    candidate_plan:candidate.plan,
    model_config:{provider:this.state.provider==='mock'?'mock':'qwen'},
    image_pipeline:this.state.pipeline,
    lab_config
   });
   if(!result.job?.job_id)throw Error('响应缺少任务标识，请查询原任务。');
   this.patchCandidate(id,{job:result.job,status:'known'});
   void this.syncToArchive();
  }catch(error){this.patchCandidate(id,{status:'unknown',error:(error instanceof Error?error.message:'提交状态未知')+'；不自动重提，可查询原任务。'});}
  finally{this.submitting.delete(candidate.submissionId);}
 }
 async regenerateWithLab(candidateId?: 'candidate_1'|'candidate_2'){
  const targetId = candidateId || this.state.lab?.frozenCandidateId || 'candidate_1';
  await this.task(async()=>{
   const newSubmissionId = crypto.randomUUID();
   this.patchCandidate(targetId, {
    submissionId: newSubmissionId,
    status: 'not_started',
    job: undefined,
    error: undefined
   });
   await this.submit(targetId);
  });
 }
 async query(id:string){await this.task(async()=>{const c=this.candidate(id);if(c.status==='not_started')throw Error('尚未提交，请明确开始此方案。');const result=await this.api.call<GenerationJob>('/api/terrain/query',{provider_task_id:c.submissionId,job_id:c.job?.job_id||`terrain:${c.submissionId}`,planning_run_id:this.state.id,candidate_id:c.id});
  const reviewed={...result,manual_review:c.job?.manual_review},job=hasTerrainApproval(reviewed)?reviewed:result;
  this.patchCandidate(id,{job,status:'known',error:undefined});
  if(this.state.selectedId===id&&!terrainUsable(job))this.edit({stage:'results',selectedId:undefined});
 });}
 approve(id:string){
  this.patchCandidate(id,{job:approveTerrain(this.candidate(id).job!)});
  void this.syncToArchive();
 }
 select(id:string){
  if(!terrainUsable(this.candidate(id).job))throw Error('方案尚未就绪或待审核。');
  this.edit({stage:'selected',selectedId:id});
  void this.syncToArchive();
 }
 reset(){if(this.busy||this.submitting.size)throw Error('请等待当前请求完成。');this.save(freshExperiment());this.error='';this.emit();}
 export(){return JSON.stringify(this.state,null,2);}
}
