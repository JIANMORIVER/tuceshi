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
  // 场景规划中与统一地块规范冲突的底座描述，以统一地块规范为准进行清洗
  const cleanDesc = plan.scene_description.replace(/(厚重|厚实|高耸|巨大)的?(底座|基座|土壤剖面|台阶悬空)/g, '').trim();
  // Only visual composition reaches Qwen: never append raw diary, titles or survey transcripts.
  return `画面中必须清楚呈现${plan.primary_subject.trim()}。${cleanDesc}${plan.terrain?.name?`地面材质为${String(plan.terrain.name).slice(0,100)}。`:''}`;
}

export function estimateTokens(text = '') {
  if (!text) return 0;
  const cjkMatches = text.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkText = text.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g, ' ');
  const words = nonCjkText.trim().split(/\s+/).filter(Boolean);
  return Math.round(cjkCount * 1.3 + words.length * 1.2);
}

export function checkModuleDuplicates(content = '') {
  const phrasePatterns = [
    '正方形等距菱形地块',
    '1.68:1',
    'This is an RGBA image with transparency',
    '仅地块外部完全透明',
    '只画插画，任何位置都不要文字',
    '严格以尺度参考图为准',
    '严格遵循结构参考图'
  ];
  const duplicates = [];
  for (const phrase of phrasePatterns) {
    const count = content.split(phrase).length - 1;
    if (count > 1) {
      duplicates.push(`短语重复: "${phrase}"(${count}次)`);
    }
  }

  const thresholdMap = {
    '菱形': 4,
    '等距': 4,
    '底座': 6,
    '厚度': 4,
    '透明': 3,
    '纯白': 3,
    '像素': 4
  };

  for (const [kw, limit] of Object.entries(thresholdMap)) {
    const count = content.split(kw).length - 1;
    if (count > limit) {
      duplicates.push(`异常高频: ${kw}(${count}次)`);
    }
  }

  return {
    has_internal_duplicates: duplicates.length > 0,
    duplicate_keywords: duplicates
  };
}

export function buildCompleteScenePrompt(description, options={}) {
  const stylePkg = options.stylePackage || options.style_package;
  const style = options.style?.trim() || stylePkg?.style_text_rules?.trim() || stylePkg?.style_prompt?.trim() || STYLE;
  const refImages = Array.isArray(options.referenceImages) ? options.referenceImages : (Array.isArray(options.reference_images) ? options.reference_images : []);
  const i2iRules = options.i2iRules || options.i2i_rules;
  const structImgs = refImages.filter(img => img?.role === 'structure');
  const scaleImgs = refImages.filter(img => img?.role === 'scale');
  const styleImgs = refImages.filter(img => img?.role === 'style');
  const roleGuide = buildI2IRoleGuidance(refImages);

  const i2iParts = [
    i2iRules?.roleInstructions,
    i2iRules?.preservationRules,
    i2iRules?.variationRules,
    i2iRules?.prohibitions
  ].filter(Boolean);
  const i2iSection = (options.mode === 'image_to_image' && refImages.length > 0 && i2iParts.length > 0)
    ? `\n【参考图指导】包含 ${refImages.length} 张参考图。${i2iParts.join('；')}`
    : '';

  // Module 1: 地块结构与连接口（保留核心几何参数，强化道路出口约束）
  // Module 1: 地块结构与连接口（保留核心几何参数，强化道路出口约束）
  let structureText = options.groundRules?.trim() || GROUND_RULES;
  if (structImgs.length > 0) {
    structureText += '\n【结构图规则】：决定地块形状、等距菱形轮廓与道路连接口走向，严禁复制参考图内的具体纹理或UI。严格遵循结构参考图的地块外形、基本视角与道路连接口。结构图中的每个黑色标记，都必须转化为指定边缘上的自然道路出口；道路必须延伸至地块边缘，允许穿过围墙或边缘装饰，但不能改变整体轮廓；禁止只在地块内部生成道路却没有实际连接到边缘；不同场景允许使用不同道路材质；严禁复制参考图边框或UI。';
  }
  if (i2iSection) {
    structureText += i2iSection;
  }
  const module1 = {
    id: 'structure',
    name: '地块结构与连接口',
    content: `【地块结构与连接口规范】\n${structureText}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module1.char_count = module1.content.length;
  module1.duplicate_check = checkModuleDuplicates(module1.content);

  // Module 2: 场景主体与生活内容
  const cleanScene = description.replace(/(厚重|厚实|高耸|巨大)的?(底座|基座|土壤剖面|台阶悬空)/g, '').trim();
  const sceneClause = `${cleanScene}场景细节紧扣生活日记事实展开，主景占据主要视觉面积，不画空白无主体地面。`;
  const module2 = {
    id: 'scene',
    name: '场景主体与生活内容',
    content: `【场景生活构图】\n${sceneClause}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module2.char_count = module2.content.length;
  module2.duplicate_check = checkModuleDuplicates(module2.content);

  // Module 3: 相对尺度
  let scaleContent = '';
  if (scaleImgs.length > 0) {
    scaleContent = '【尺度图规则】：仅作为物体、建筑与角色的相对大小和比例尺参考，严格禁止借用其画风、材质或色彩，不影响画面风格。严格以尺度参考图为准，控制人物、建筑、树木、道路与生活物件的相对大小与比例尺，人物与门窗、树木比例协调，符合微观生活箱景比例。';
  } else {
    scaleContent = options.scaleRules?.trim() || SCALE_RULES;
  }
  const module3 = {
    id: 'scale',
    name: '相对尺度规范',
    content: `【物体尺度与比例】\n${scaleContent}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module3.char_count = module3.content.length;
  module3.duplicate_check = checkModuleDuplicates(module3.content);

  // Module 4: 风格包
  let styleRules = style;
  if (styleImgs.length > 0) {
    styleRules += '\n【风格图画法指导】：严格以风格参考图为绘画笔触、线条、色块、材质质感、配色方案与细节密度参考，仅学习其艺术画法与风格表达；严禁复制参考图内的具体建筑、主体造型、构图布局、文字、UI控件或拼图标记；最终画面场景内容严格由日记事实决定，不得覆盖地块结构与尺度约束。';
  }
  const module4 = {
    id: 'style',
    name: '渲染风格与氛围',
    content: `【画风与氛围规范】\n${styleRules}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module4.char_count = module4.content.length;
  module4.duplicate_check = checkModuleDuplicates(module4.content);

  // Module 5: 外背景规范与禁止事项
  const rawNegatives = [
    NEGATIVE,
    options.negativeRules?.trim(),
    stylePkg?.style_negative_rules?.trim(),
    refImages.length > 0 ? '复制参考图边框，复制参考图UI控件' : ''
  ].filter(Boolean);
  const dedupedNeg = Array.from(new Set(rawNegatives.join('，').split(/[,，]\s*/)))
    .filter(Boolean)
    .filter(term => !['厚重土壤剖面', '左右底座厚度不一致', '锥形悬浮岛', '翘边', '卷边', '底板弯曲', '翻折地块', '日记文字', '说明文字', '信息面板'].includes(term))
    .join('，');
  const transDesc = `地块外为均匀 RGB(255,255,255) 纯白背景，无投影、渐变或棋盘格。只画插画；任何位置都不要文字、字母、数字、日记、标题、标签、水印或说明卡片。避免：${dedupedNeg}。`;
  const module5 = {
    id: 'transparency_and_negatives',
    name: '外背景规范与禁止事项',
    content: `【外背景规范与禁止事项】\n${transDesc}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module5.char_count = module5.content.length;
  module5.duplicate_check = checkModuleDuplicates(module5.content);

  const modules = [module1, module2, module3, module4, module5];
  const positive = modules.map(m => m.content).join('\n\n');

  return {
    version: COMPLETE_SCENE_PROMPT_VERSION,
    style,
    scene: description,
    boundaries: '单张完整场景；纯白外背景；Alpha 与锚点待验证',
    positive,
    negative: dedupedNeg,
    modules,
    estimatedTokens: estimateTokens(positive),
    segments: {
      structure_rules: module1.char_count,
      scene_content: module2.char_count,
      scale_rules: module3.char_count,
      style_package: module4.char_count,
      transparency_rules: module5.char_count,
      i2i_reference_rules: (structImgs.length > 0 || scaleImgs.length > 0) ? (module1.char_count + module3.char_count) : 0,
      negative_prohibitions: dedupedNeg.length
    }
  };
}

export function buildNativeScenePrompt(description, options={}) {
  const visual=description.replace(/纯白外背景|纯白背景|外部纯白|白色背景/g,'透明外背景');
  const stylePkg = options.stylePackage || options.style_package;
  const style = options.style?.trim() || stylePkg?.style_text_rules?.trim() || stylePkg?.style_prompt?.trim() || STYLE;
  const refImages = Array.isArray(options.referenceImages) ? options.referenceImages : (Array.isArray(options.reference_images) ? options.reference_images : []);
  const i2iRules = options.i2iRules || options.i2i_rules;
  const structImgs = refImages.filter(img => img?.role === 'structure');
  const scaleImgs = refImages.filter(img => img?.role === 'scale');
  const styleImgs = refImages.filter(img => img?.role === 'style');
  const roleGuide = buildI2IRoleGuidance(refImages);

  const i2iParts = [
    i2iRules?.roleInstructions,
    i2iRules?.preservationRules,
    i2iRules?.variationRules,
    i2iRules?.prohibitions
  ].filter(Boolean);
  const i2iSection = (options.mode === 'image_to_image' && refImages.length > 0 && i2iParts.length > 0)
    ? `\n【参考图指导】包含 ${refImages.length} 张参考图。${i2iParts.join('；')}`
    : '';

  // Module 1: 地块结构与连接口（保留核心几何参数，强化道路出口约束）
  let structureText = options.groundRules?.trim() || GROUND_RULES;
  if (structImgs.length > 0) {
    structureText += '\n【结构图规则】：决定地块形状、等距菱形轮廓与道路连接口走向，严禁复制参考图内的具体纹理或UI。严格遵循结构参考图的地块外形、基本视角与道路连接口。结构图中的每个黑色标记，都必须转化为指定边缘上的自然道路出口；道路必须延伸至地块边缘，允许穿过围墙或边缘装饰，但不能改变整体轮廓；禁止只在地块内部生成道路却没有实际连接到边缘；不同场景允许使用不同道路材质；严禁复制参考图边框或UI。';
  }
  if (i2iSection) {
    structureText += i2iSection;
  }
  const module1 = {
    id: 'structure',
    name: '地块结构与连接口',
    content: `【地块结构与连接口规范】\n${structureText}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module1.char_count = module1.content.length;
  module1.duplicate_check = checkModuleDuplicates(module1.content);

  // Module 2: 场景主体与生活内容
  const cleanScene = visual.replace(/(厚重|厚实|高耸|巨大)的?(底座|基座|土壤剖面|台阶悬空)/g, '').trim();
  const sceneClause = `${cleanScene}场景细节紧扣生活日记事实展开，主景占据主要视觉面积，不画空白无主体地面。`;
  const module2 = {
    id: 'scene',
    name: '场景主体与生活内容',
    content: `【场景生活构图】\n${sceneClause}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module2.char_count = module2.content.length;
  module2.duplicate_check = checkModuleDuplicates(module2.content);

  // Module 3: 相对尺度
  let scaleContent = '';
  if (scaleImgs.length > 0) {
    scaleContent = '【尺度图规则】：仅作为物体、建筑与角色的相对大小和比例尺参考，严格禁止借用其画风、材质或色彩，不影响画面风格。严格以尺度参考图为准，控制人物、建筑、树木、道路与生活物件的相对大小与比例尺，人物与门窗、树木比例协调，符合微观生活箱景比例。';
  } else {
    scaleContent = options.scaleRules?.trim() || SCALE_RULES;
  }
  const module3 = {
    id: 'scale',
    name: '相对尺度规范',
    content: `【物体尺度与比例】\n${scaleContent}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module3.char_count = module3.content.length;
  module3.duplicate_check = checkModuleDuplicates(module3.content);

  // Module 4: 风格包
  let styleRules = style;
  if (styleImgs.length > 0) {
    styleRules += '\n【风格图画法指导】：严格以风格参考图为绘画笔触、线条、色块、材质质感、配色方案与细节密度参考，仅学习其艺术画法与风格表达；严禁复制参考图内的具体建筑、主体造型、构图布局、文字、UI控件或拼图标记；最终画面场景内容严格由日记事实决定，不得覆盖地块结构与尺度约束。';
  }
  const module4 = {
    id: 'style',
    name: '渲染风格与氛围',
    content: `【画风与氛围规范】\n${styleRules}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module4.char_count = module4.content.length;
  module4.duplicate_check = checkModuleDuplicates(module4.content);

  // Module 5: 透明背景与禁止事项（权威声明，不重复）
  const rawNegatives = [
    NEGATIVE,
    options.negativeRules?.trim(),
    stylePkg?.style_negative_rules?.trim(),
    refImages.length > 0 ? '复制参考图边框，复制参考图UI控件' : ''
  ].filter(Boolean);
  const dedupedNeg = Array.from(new Set(rawNegatives.join('，').split(/[,，]\s*/)))
    .filter(Boolean)
    .filter(term => !['厚重土壤剖面', '左右底座厚度不一致', '锥形悬浮岛', '翘边', '卷边', '底板弯曲', '翻折地块', '日记文字', '说明文字', '信息面板'].includes(term))
    .join('，');
  const transDesc = `整个菱形底座与场景主体、内部生活场景全部保留且不透明，仅地块外部完全透明，无白底、黑底、彩色底、棋盘格、天空或外部投影。The image has alpha channel and the background is transparent. 只画插画，任何位置都不要文字、字母、数字、日记、标题、说明卡片、UI 或水印。避免：${dedupedNeg}。`;
  const module5 = {
    id: 'transparency_and_negatives',
    name: '透明背景与禁止事项',
    content: `【透明背景与禁止事项】\n${transDesc}`,
    char_count: 0,
    duplicate_check: { has_internal_duplicates: false, duplicate_keywords: [] }
  };
  module5.char_count = module5.content.length;
  module5.duplicate_check = checkModuleDuplicates(module5.content);

  const modules = [module1, module2, module3, module4, module5];
  const positive = `This is an RGBA image with transparency.\n\n${modules.map(m => m.content).join('\n\n')}`;

  return {
    version: NATIVE_SCENE_PROMPT_VERSION,
    style,
    scene: visual,
    boundaries: '原生 RGBA；整块地形保留；外部透明；薄且等厚底座，地表基准待核验',
    positive,
    negative: '',
    modules,
    estimatedTokens: estimateTokens(positive),
    segments: {
      structure_rules: module1.char_count,
      scene_content: module2.char_count,
      scale_rules: module3.char_count,
      style_package: module4.char_count,
      transparency_rules: module5.char_count,
      i2i_reference_rules: (structImgs.length > 0 || scaleImgs.length > 0) ? (module1.char_count + module3.char_count) : 0,
      negative_prohibitions: dedupedNeg.length
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
