import { createHash } from 'node:crypto';
import { ImageCardError } from '../image-card/config.mjs';

const invalid = message => { throw new ImageCardError('DIARY_CONTEXT_INVALID', message, 400); };
const modelInvalid = () => { throw new ImageCardError('MODEL_OUTPUT_INVALID', '模型返回的细节或画面方案不完整，请手动重试；尚未提交生图。', 502); };
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
export function validateDiaryContext(input) {
  if (!input || !text(input.rawText, 12000) || !Array.isArray(input.focuses) || input.focuses.length < 1 || input.focuses.length > 3) invalid('请保留当天日记并选择 1–3 项重点。');
  const ids = new Set();
  const focuses = input.focuses.map(focus => {
    if (!focus || !text(focus.event_id, 100) || ids.has(focus.event_id) || !text(focus.title, 200) || !text(focus.evidence, 12000) || !input.rawText.includes(focus.evidence)) invalid('重点事项缺少有效的日记来源。');
    ids.add(focus.event_id);
    return { event_id: focus.event_id, title: focus.title, evidence: focus.evidence, focus_kind: focus.focus_kind || 'event' };
  });
  const answers = input.answers || [];
  if (!Array.isArray(answers) || answers.length > 8 || answers.some(answer => !answer || !text(answer.final_answer, 700) || ![...ids, 'extra'].includes(answer.target_event_id))) invalid('细节回答与当前重点不匹配。');
  return { rawText: input.rawText, focuses, answers: answers.map(answer => ({ target_event_id: answer.target_event_id, question_text: String(answer.question_text || '').slice(0, 180), final_answer: answer.final_answer })) };
}

export const INQUIRY_SCHEMA = { type: 'object', required: ['intro','questions'], properties: {
  intro: { type:'string', maxLength:24 }, questions:{ type:'array', minItems:1, maxItems:3, items:{ type:'object', required:['target_event_id','question_text','input_type','answer_options','evidence'], properties:{
    target_event_id:{type:'string'}, question_text:{type:'string',maxLength:100}, input_type:{enum:['single_choice','text']}, answer_options:{type:'array',maxItems:4,items:{type:'string',maxLength:35}}, evidence:{type:'string'}
  } } }
} };
export const SCENE_PLAN_SCHEMA = { type:'object', required:['candidates'], properties:{ candidates:{ type:'array',minItems:2,maxItems:2,items:{ type:'object',required:['title','primary_subject','scene_description','ground_surface','translation_rationale'],properties:{
  title:{type:'string',maxLength:30},primary_subject:{type:'string',maxLength:160},scene_description:{type:'string',minLength:70,maxLength:900},ground_surface:{type:'string',maxLength:60},translation_rationale:{type:'string',maxLength:200}
} } } } };
export const INQUIRY_PROMPT = `你是 Life Map 的温柔细节向导。输入 JSON 的 rawText 是当天多条便签合成的原文，focuses 是用户选择的重点。生成 1–3 个简短问题，确认与这些重点相关、尚未写明且能影响插画的具体细节。不要重复询问已经写明的事件、地点、心情，不诊断心理状态，不要求再次阅读原文。问题与对话必须使用自然中文。
问题只可用 single_choice 或 text 控件。选择题给 2–4 个简短、具体、互斥选项；它们只是可选建议，在用户确认前不能当作事实。文字题 answer_options 为空。target_event_id 必须来自 focuses；evidence 必须逐字引用 rawText。intro 最多 24 字。所有问题可跳过，不诱导用户回答，也不在提问时调用生图。
只输出 JSON 对象，例如 {"intro":"想再确认一点画面里的细节吗？","questions":[{"target_event_id":"所选ID","question_text":"这次创作最想留下哪个画面？","input_type":"single_choice","answer_options":["正在操作的工作桌","贴着草图的灵感板","安静整理思路的角落"],"evidence":"原文中的逐字片段"}]}。`;
export const SCENE_PLAN_PROMPT = `你是完整 2.5D 等距像素地块的插画构图师。输入 JSON 中 rawText 是当天合并日记，focuses 是用户选择的重点，answers 是用户主动确认的可选细节。只用原文和已确认回答作为生活事实；没有回答也必须能够规划。问卷中未选择的选项不是事实。
输出两个不同构图的完整图片方案，而不是素材列表。抽象的工作、开发、UI 设计和推进 demo 等经历，要明确转译成可画的主体，例如有电脑、无字界面草图、便签和台灯的工作桌或小型工作室；情绪通过光线、颜色和空间表现，不画成文字。优先表达所选重点，不自动加入没有依据的湖畔、工坊、人物或心情。艺术构思不声称是真实发生的地点。
每个方案必须包含 primary_subject（清晰的主要建筑/工作桌/人物活动场景等，不能只是草地或底座）、scene_description（至少 70 字，完整说明主景、2–4 个相关物件、布局、底座材质与厚度）、ground_surface、title、translation_rationale。地面可以是草地、石板或木地板等，但不可只画地面。两张都保持单个菱形等距底座、完整场景、可透明处理的纯白外背景。不写真实文本、日记、日期、标题、标签、UI 面板或海报；电脑屏幕仅画无字的几何色块。不得把原文与回答逐句复制到插画描述中。
只输出符合给定 Schema 的 JSON 对象 {"candidates":[完整方案一,完整方案二]}。`;

export function validateInquiries(value, context, key) {
  if (!text(value?.intro, 50) || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 3) modelInvalid();
  const ids = new Set(context.focuses.map(focus => focus.event_id));
  const questions = value.questions.map((question, index) => {
    if (!question || !ids.has(question.target_event_id) || !text(question.question_text, 160) || !['single_choice','text'].includes(question.input_type) || !text(question.evidence, 12000) || !context.rawText.includes(question.evidence) || !Array.isArray(question.answer_options)) modelInvalid();
    const options = [...new Set(question.answer_options)];
    if (options.some(option => !text(option, 50)) || (question.input_type === 'single_choice' ? options.length < 2 || options.length > 4 : options.length !== 0)) modelInvalid();
    return { question_id:`inq_ai_${key.slice(0,12)}_${index}`, target_event_id:question.target_event_id, question_text:question.question_text, input_type:question.input_type,
      answer_options:options, evidence:question.evidence, reason_for_asking:'确认与所选重点相关的画面细节' };
  });
  return { intro:value.intro, questions };
}
export function validateScenePlans(value) {
  if (!Array.isArray(value?.candidates) || value.candidates.length !== 2) modelInvalid();
  return { candidates:value.candidates.map((candidate,index) => {
    if (!candidate || !text(candidate.title, 60) || !text(candidate.primary_subject, 160) || !text(candidate.scene_description, 900) || candidate.scene_description.length < 70 || !text(candidate.ground_surface, 60) || !text(candidate.translation_rationale, 300)) modelInvalid();
    if (/^(草地|草坪|空地|地面|底座|地块|grass|grassland)$/i.test(candidate.primary_subject.trim())) modelInvalid();
    return { id:index ? 'candidate_2':'candidate_1', title:candidate.title, primary_subject:candidate.primary_subject, scene_description:candidate.scene_description, ground_surface:candidate.ground_surface, translation_rationale:candidate.translation_rationale };
  }) };
}

/** One bounded JSON request; no automatic paid retries and no fallback to fabricated real output. */
export class DiaryDialogue {
  // workerd's native fetch requires the global receiver, even when dependency-injected.
  constructor(settings, { fetcher=fetch }={}) { this.settings=settings; this.fetcher=fetcher.bind(globalThis); this.cache=new Map(); }
  async complete(kind, input) {
    const context=validateDiaryContext(input), config=this.settings.textConfig();
    if (config.provider==='mock' || !config.apiKey) throw new ImageCardError('TEXT_MODEL_REQUIRED','请配置在线文字模型；也可跳过细节，离线模式使用明确标记的离线方案。',503);
    const key=createHash('sha256').update(JSON.stringify({kind,context,provider:config.provider,model:config.model})).digest('hex');
    const existing=this.cache.get(key);
    if(existing && existing.expires>Date.now())return existing.promise;
    const promise=this.request(kind,context,config,key);
    this.cache.set(key,{expires:Date.now()+10*60*1000,promise});
    while(this.cache.size>50)this.cache.delete(this.cache.keys().next().value);
    try{return await promise;}catch(error){this.cache.delete(key);throw error;}
  }
  async request(kind, context, config, key) {
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),config.timeoutMs||60000); const started=Date.now();
    try {
      const response=await this.fetcher(`${config.baseUrl.replace(/\/+$/,'')}/chat/completions`, { method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.apiKey}`},signal:controller.signal,
        body:JSON.stringify({model:config.model,messages:[{role:'system',content:`${kind==='inquiry'?INQUIRY_PROMPT:SCENE_PLAN_PROMPT}\nJSON Schema:\n${JSON.stringify(kind==='inquiry'?INQUIRY_SCHEMA:SCENE_PLAN_SCHEMA)}`},{role:'user',content:JSON.stringify(context)}],response_format:{type:'json_object'},temperature:0.3,
          ...(config.provider==='deepseek'?{thinking:{type:'disabled'},max_tokens:kind==='inquiry'?2200:4500}:{enable_thinking:false,max_tokens:kind==='inquiry'?2200:4500})}) });
      if(!response.ok){
        const status=response.status;
        const failure=[401,403].includes(status)?['TEXT_AUTH_FAILED','文字模型鉴权或权限校验失败，请检查所选模型对应的 Key。']:status===402?['TEXT_BALANCE_LOW','文字模型账户余额不足，请检查供应商账户。']:status===404?['TEXT_MODEL_UNAVAILABLE','所选文字模型不可用，请检查模型名称和权限。']:status===429?['TEXT_RATE_LIMITED','文字模型暂时限流，请稍后手动重试。']:status>=500?['TEXT_PROVIDER_UNAVAILABLE','文字模型服务暂不可用，请稍后手动重试。']:['TEXT_REQUEST_REJECTED','文字模型拒绝了请求，请检查模型参数。'];
        throw new ImageCardError(failure[0],`${failure[1]}（${status}）尚未提交生图。`,status===429?429:502,{upstreamStatus:status});
      }
      let data;try{data=await response.json();}catch{
        if(controller.signal.aborted)throw new ImageCardError('TEXT_MODEL_TIMEOUT','文字模型超时，细节可跳过；尚未提交生图。',504);
        throw new ImageCardError('TEXT_RESPONSE_INVALID','文字接口已响应，但返回的不是完整 JSON；请稍后手动重试。尚未提交生图。',502);
      }
      const choice=data?.choices?.[0],content=choice?.message?.content;
      if(choice?.finish_reason==='length')throw new ImageCardError('TEXT_OUTPUT_TRUNCATED','文字模型输出被截断，尚未形成完整问题；请手动重试或跳过细节。尚未提交生图。',502);
      if(typeof content!=='string'||!content.trim())throw new ImageCardError('TEXT_OUTPUT_EMPTY','文字接口已响应，但没有返回有效问题或方案；请手动重试或跳过细节。尚未提交生图。',502);
      let parsed;try{parsed=JSON.parse(content);}catch{modelInvalid();}
      return {...(kind==='inquiry'?validateInquiries(parsed,context,key):validateScenePlans(parsed)),debug:{provider:config.provider,model:config.model,latencyMs:Date.now()-started}};
    } catch(error) {
      if(error instanceof ImageCardError)throw error;
      throw new ImageCardError(controller.signal.aborted?'TEXT_MODEL_TIMEOUT':'TEXT_CONNECTION_FAILED',controller.signal.aborted?'文字模型超时，细节可跳过；尚未提交生图。':'云端未能连接文字模型服务，请稍后手动重试；尚未提交生图。',controller.signal.aborted?504:502);
    } finally{clearTimeout(timer);}
  }
}
