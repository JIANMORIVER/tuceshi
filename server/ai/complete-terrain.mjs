import { join } from 'node:path';
import { ImageGenerationService, validId } from '../image-card/service.mjs';
import { ImageCardError, PROJECT_ROOT } from '../image-card/config.mjs';
import { stableRequestId, jobFromTerrainRecord } from './terrain.mjs';
import { STYLE, NEGATIVE } from '../image-card/prompt.mjs';

export const COMPLETE_SCENE_PROMPT_VERSION='isometric-complete-scene-v5';
export const NATIVE_SCENE_PROMPT_VERSION='isometric-native-alpha-v3';

export const GROUND_RULES='统一地表与底座规范（优先于场景中关于厚底座或高台的描述）：整个场景只有一个正方形等距菱形地块，地表投影宽高约 1.68:1；地表占画布宽约 83%，地表菱形中心位于画布宽 50%、高 55.3% 附近，不能用建筑外轮廓或土层底端代替地表中心。底座仅为薄而清晰的等厚侧边，屏幕竖直厚度约为地表宽度的 3%，左右两侧厚度一致，底座下缘与对应的地表边缘平行；不画厚重土壤剖面、层层堆土、锥形悬浮岛或不规则岩柱。地表外轮廓是四条笔直边与四个平整角，不画翘边、卷边、翻折、碗状凹陷或向上弯曲的底板，不能通过扭曲外边缘表现透视。地表外边界的四个角与四条边保持同一基准面，并在边缘保留一圈窄的平缓衔接带，供相邻地块拼接。山地、丘陵、坡面或不平整地形可以在地块内部高于这一基准面，保留真实起伏和生活主景，不通过加厚底座表现海拔；不要把所有内部地形压平。完整保留建筑、树木、人物、道路及场景细节，不裁断主体，不重复叠加第二层底座。';
export const STRUCTURE_RULES = '整个场景为一个正方形等距菱形地块，地表投影宽高约 1.68:1，四角笔直平整无翘边；外边缘保留窄平衔接带并带有相邻地块的道路连接口；底座为等厚清晰侧边，厚度约地表宽度的 3%，左右一致。';
export const SCALE_RULES = '物体与建筑保持等距像素插画的标准比例尺，房屋、树木、生活物件与人物相对大小自然协调，符合微观生活箱景比例，主体与配景层次分明。';

export function buildI2IRoleGuidance(referenceImages = []) {
  const lines = [];
  if (referenceImages.some(img => img?.role === 'structure')) {
    lines.push('【结构图规则】：决定地块形状、等距菱形轮廓与道路连接口走向，严禁复制参考图内的具体纹理或UI');
  }
  if (referenceImages.some(img => img?.role === 'scale')) {
    lines.push('【尺度图规则】：仅作为物体、建筑与角色的相对大小和比例尺参考，严格禁止借用其画风、材质或色彩，不影响画面风格');
  }
  if (referenceImages.some(img => img?.role === 'style')) {
    lines.push('【风格图规则】：提供像素质感、色彩基调与光影氛围参考');
  }
  if (referenceImages.some(img => img?.role === 'content')) {
    lines.push('【内容图规则】：提供特定建筑或生活物品的视觉造型参考');
  }
  return lines.join('；');
}

export function completeSceneDescription(input) {
  const plan=input?.candidate_plan;
  if(typeof plan?.scene_description!=='string' || plan.scene_description.trim().length<70 || plan.scene_description.length>1600 || typeof plan.primary_subject!=='string' || !plan.primary_subject.trim())throw new ImageCardError('SCENE_PLAN_REQUIRED','缺少完整场景描述或主景，已阻止空草地生图。请返回准备新的画面方案。',400);
  if(/^(草地|草坪|空地|地面|底座|地块|grass|grassland)$/i.test(plan.primary_subject.trim()))throw new ImageCardError('SCENE_PLAN_REQUIRED','画面必须包含清晰的生活主景，不能只有地面。',400);
  // Only visual composition reaches Qwen: never append raw diary, titles or survey transcripts.
  return `画面中必须清楚呈现${plan.primary_subject.trim()}。${plan.scene_description.trim()}${plan.terrain?.name?`地面材质为${String(plan.terrain.name).slice(0,100)}。`:''}`;
}
export function buildCompleteScenePrompt(description, options={}) {
  const style = options.style?.trim() || STYLE;
  const ground = options.groundRules?.trim() || GROUND_RULES;
  const customNegative = options.negativeRules?.trim() ? `，${options.negativeRules.trim()}` : '';
  const refImages = Array.isArray(options.referenceImages) ? options.referenceImages : (Array.isArray(options.reference_images) ? options.reference_images : []);
  const i2iRules = options.i2iRules || options.i2i_rules;
  const roleGuide = buildI2IRoleGuidance(refImages);
  const i2iSection = (options.mode === 'image_to_image' && refImages.length > 0)
    ? `\n【参考图指导】包含 ${refImages.length} 张参考图。${roleGuide ? roleGuide + '；' : ''}${i2iRules?.roleInstructions || ''}；${i2iRules?.preservationRules || ''}；${i2iRules?.variationRules || ''}；${i2iRules?.prohibitions || ''}`
    : '';
  const negClause = `${NEGATIVE}${customNegative}，空白草地，没有主体，日记文字，文字排版，说明文字，信息面板，厚重土壤剖面，左右底座厚度不一致，锥形悬浮岛，翘边，卷边，底板弯曲，翻折地块${options.mode === 'image_to_image' ? '，复制参考图边框，复制参考图UI，复制参考图水印' : ''}`;
  const transDesc = '地块外为均匀 RGB(255,255,255) 纯白背景，无投影、渐变或棋盘格。只画插画；任何位置都不要文字、字母、数字、日记、标题、标签、水印或说明卡片。屏幕和便签仅用无字色块表达。';
  const positive = `${style}\n${description}\n主体与相关物件必须真实出现在画面中，主景占据主要视觉面积，不能只画空白草地。\n${ground}\n${transDesc}${i2iSection}\n避免：${negClause}。`;

  return {
    version: COMPLETE_SCENE_PROMPT_VERSION,
    style,
    scene: description,
    boundaries: '单张完整场景；纯白外背景；Alpha 与锚点待验证',
    positive,
    negative: negClause,
    segments: {
      scene_content: description.length,
      structure_rules: STRUCTURE_RULES.length,
      scale_rules: SCALE_RULES.length,
      style_package: style.length,
      transparency_rules: transDesc.length,
      i2i_reference_rules: i2iSection.length,
      negative_prohibitions: negClause.length
    }
  };
}
export function buildNativeScenePrompt(description, options={}) {
  const visual=description.replace(/纯白外背景|纯白背景|外部纯白|白色背景/g,'透明外背景');
  const style = options.style?.trim() || STYLE;
  const ground = options.groundRules?.trim() || GROUND_RULES;
  const refImages = Array.isArray(options.referenceImages) ? options.referenceImages : (Array.isArray(options.reference_images) ? options.reference_images : []);
  const i2iRules = options.i2iRules || options.i2i_rules;
  const roleGuide = buildI2IRoleGuidance(refImages);
  const i2iSection = (options.mode === 'image_to_image' && refImages.length > 0)
    ? `\n【参考图指导】包含 ${refImages.length} 张参考图。${roleGuide ? roleGuide + '；' : ''}${i2iRules?.roleInstructions || ''}；${i2iRules?.preservationRules || ''}；${i2iRules?.variationRules || ''}；${i2iRules?.prohibitions || ''}`
    : '';
  const negClause = `${NEGATIVE}${options.negativeRules?.trim() ? `，${options.negativeRules.trim()}` : ''}，空白草地，没有主体，日记文字，说明卡片，厚重土壤剖面，左右底座厚度不一致，锥形悬浮岛，翘边，卷边，底板弯曲${options.mode === 'image_to_image' ? '，复制参考图边框，复制参考图UI，复制参考图水印' : ''}`;
  const transDesc = '主景、建筑、树木、人物、地面、道路及整个菱形底座全部保留，组成一个完整场景。底座和内部场景不透明，只有整个地块外部透明。完整主体留在画布内并保留边距，不单独提取建筑，不裁切底座。地块外不画白底、彩色底、棋盘格、投影或天空。只画插画，不要文字、字母、数字、标签、UI 或水印。';
  const positive = `This is an RGBA image with transparency.\n${style}\n${visual}\n${ground}\n${transDesc}\n避免：${negClause}。\nThe image has alpha channel and the background is transparent.${i2iSection}`;

  return {
    version: NATIVE_SCENE_PROMPT_VERSION,
    style,
    scene: visual,
    boundaries: '原生 RGBA；整块地形保留；外部透明；薄且等厚底座，地表基准待核验',
    positive,
    negative: '',
    segments: {
      scene_content: visual.length,
      structure_rules: STRUCTURE_RULES.length,
      scale_rules: SCALE_RULES.length,
      style_package: style.length,
      transparency_rules: transDesc.length,
      i2i_reference_rules: i2iSection.length,
      negative_prohibitions: negClause.length
    }
  };
}
export class CompleteTerrainGeneration {
  constructor(settings,{storageRoot=join(PROJECT_ROOT,'.local/terrain-candidates'),adapter}={}){this.settings=settings;this.storageRoot=storageRoot;this.adapter=adapter;this.queue=Promise.resolve();}
  service(config=this.settings.imageConfig(), labConfig={}){
    const promptBuilder = (desc) => (config.generationRoute==='native-alpha' ? buildNativeScenePrompt(desc, labConfig) : buildCompleteScenePrompt(desc, labConfig));
    return new ImageGenerationService(config,{storageRoot:this.storageRoot,promptBuilder,...(this.adapter?{adapter:this.adapter}:{})});
  }
  generate(input){
    if(!input || !['candidate_1','candidate_2'].includes(input.candidate_id) || typeof input.planning_run_id!=='string' || !input.planning_run_id || input.planning_run_id.length>200 || typeof input.snapshot?.input_text!=='string')throw new ImageCardError('INPUT_INVALID','候选需要当天快照与独立批次。',400);
    const description=completeSceneDescription(input);
    const id=input.client_request_id||stableRequestId(`${input.planning_run_id}:${input.candidate_id}`);
    if(!validId(id))throw new ImageCardError('INPUT_INVALID','生成请求 ID 无效。',400);
    const config=this.settings.terrainConfig(input.image_pipeline);
    const labConfig = input.lab_config || {};
    const operation=this.queue.then(async()=>{
      // Read immutable old jobs before preflight: switching settings never reprocesses/rebills them.
      let record;try{record=await this.service(config, labConfig).record(id);}catch(e){if(e.code!=='NOT_FOUND')throw e;}
      if(record)return {job:jobFromTerrainRecord(record,input)};
      if(input.model_config?.provider!=='mock'&&config.generationRoute==='qwen-851'&&!this.settings.backgroundConfig().apiToken)throw new ImageCardError('REPLICATE_KEY_MISSING','请先配置 Replicate Token，再使用普通生成＋851 Labs；尚未提交生图。',503);
      return {job:jobFromTerrainRecord(await this.service(config, labConfig).generate({requestId:id,description,count:1,mode:input.model_config?.provider==='mock'?'mock':'real',labConfig}),input)};
    });
    this.queue=operation.then(()=>undefined,()=>undefined);return operation;
  }
  async query(input){return {...jobFromTerrainRecord(await this.service().record(input.provider_task_id),input),job_id:input.job_id};}
  image(id){return this.service().image(id);}
}
