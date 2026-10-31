import { loadModelSettings } from './model-settings-client.js';
import type { StageAPotentialInquiry, SymbolicSceneCandidatePlan, UserSupplementalAnswer } from '../contracts/dual-stage-contract.js';
import type { VisualizableEventCandidate } from './event-aggregation.js';

export interface DiaryDialogueContext { rawText:string; focuses:VisualizableEventCandidate[]; answers?:UserSupplementalAnswer[]; }
export interface VisualDiaryPlan { id:'candidate_1'|'candidate_2'; title:string; primary_subject:string; scene_description:string; ground_surface:string; translation_rationale:string; }
async function request<T>(path:string, input:DiaryDialogueContext):Promise<T> {
  await loadModelSettings(true);
  const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('细节服务尚未就绪，请刷新后重试；尚未提交生图。');
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'文字模型暂时不可用，尚未提交生图。');
  return result as T;
}
export function requestDiaryInquiries(input:DiaryDialogueContext):Promise<{intro:string;questions:StageAPotentialInquiry[]}> {
  return request('/api/diary/inquire',input);
}
export function requestDiaryScenePlans(input:DiaryDialogueContext):Promise<{candidates:VisualDiaryPlan[]}> {
  return request('/api/diary/scene-plan',input);
}
export function visualPlanToCandidate(plan:VisualDiaryPlan, focuses:VisualizableEventCandidate[]):SymbolicSceneCandidatePlan {
  return {id:plan.id,title:plan.title,primary_subject:plan.primary_subject,scene_description:plan.scene_description,
    symbolic_anchor:focuses[0]?.title||plan.primary_subject,grounded_evidence:focuses.map(focus=>focus.evidence).join('；'),translation_rationale:plan.translation_rationale,
    terrain:{type:'illustrated_ground',name:plan.ground_surface,recommendation_reason:'完整插画中的地面材质'},core_props:[],secondary_props:[],
    atmosphere:{lighting:'as_described',weather:'as_described',mood_tone:'as_described',environmental_narrative:plan.scene_description},asset_generation_requests:[],
    godot_readiness:{status:'pending_godot_validation',note:'完整图片渲染；不做模型或资产拼装'},selected_event_ids:focuses.map(focus=>focus.event_id)};
}
export function offlineVisualPlans(focuses:VisualizableEventCandidate[]):VisualDiaryPlan[] {
  return [0,1].map(index=>({id:index?'candidate_2':'candidate_1',title:'离线构图示例',primary_subject:'带有书本和台灯的工作桌',
    scene_description:'这是明确标记的离线构图示例，不代表真实生成结果：一张完整的等距像素生活地块插画，中央摆放带有打开的书本和小台灯的木质工作桌，桌边有一把椅子，地面是具有清楚侧面厚度的菱形木地板，所有物件属于同一个完整场景，地块外为纯白背景，画面中没有任何文字、日期或标签。',
    ground_surface:'木地板',translation_rationale:`离线演示；所选重点：${focuses.map(focus=>focus.keyword||focus.title).join('、')}`}));
}
