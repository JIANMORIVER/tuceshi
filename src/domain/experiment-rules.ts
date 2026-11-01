export const DEFAULT_STYLE = '温柔、清爽、精致的纯 2D 像素画。像素簇和边缘清晰，统一约 128×128 逻辑像素的细节密度，低饱和自然配色。固定从东南方向俯看约 30 度的等距视角，左上方柔和日光。';
export const DEFAULT_STRUCTURE_RULES = '整个场景为一个正方形 2.5D 等距菱形地块，地表投影宽高约 1.68:1，四角笔直平整无翘边；外边缘保留窄平衔接带并带有相邻地块的道路连接口；底座为等厚清晰侧边，厚度约地表宽度的 3%，左右一致，无层叠堆土或锥形悬浮岛。';
export const DEFAULT_SCALE_RULES = '物体与建筑保持等距像素插画的标准比例尺，房屋、树木、生活物件与人物相对大小自然协调，符合微观生活箱景比例，主体与配景层次分明。';
export const DEFAULT_GROUND_RULES = `${DEFAULT_STRUCTURE_RULES} ${DEFAULT_SCALE_RULES}`;
export const DEFAULT_NEGATIVE = '顶视平面 tilemap，拼装图集，棋盘格背景，3D 写实，黏土，低多边形模型，模糊像素滤镜，过度装饰，密集建筑，文字，日期，水印，卡框，资源图标，宣传海报，裁断主体';

export type ReferenceImageRole = 'structure' | 'scale' | 'style' | 'content';

export const REFERENCE_ROLE_LABELS: Record<ReferenceImageRole, { label: string; desc: string }> = {
  structure: {
    label: '结构底图 (structure)',
    desc: '决定地块形状、外轮廓与相邻地块连接口走向'
  },
  scale: {
    label: '尺度参考图 (scale)',
    desc: '只提供物体相对大小与比例参考，严格不影响画风与色彩'
  },
  style: {
    label: '风格参考图 (style)',
    desc: '规定颜色、材质、像素感、氛围与细节密度'
  },
  content: {
    label: '内容参考图 (content)',
    desc: '指定某种物件、建筑或场景元素的视觉参考'
  }
};

export interface ReferenceImage {
  id: string;
  name: string;
  role: ReferenceImageRole;
  dataUrl: string;
  sizeBytes?: number;
}

export interface ImageToImageRules {
  roleInstructions: string;
  preservationRules: string;
  variationRules: string;
  prohibitions: string;
}

export const DEFAULT_I2I_RULES: ImageToImageRules = {
  roleInstructions: '结构图(structure)决定地块外形轮廓与连接口走向；尺度图(scale)只提供物体相对大小与比例参考，严格不影响画风；风格图(style)提供色彩与像素感；内容图(content)提供物件与建筑造型。',
  preservationRules: '严格保留约30度等距俯视视角、地表基准面、薄而等厚底座侧边，以及边缘平整闭合。',
  variationRules: '根据日记内容调整主体细节与生活配景，允许微调植被与道路转角细节，不逐像素生硬复制。',
  prohibitions: '严禁将参考图中的文字、UI、框线、水印或黑白棋盘格复制到输出中；不要破坏边缘平直轮廓；不要将主体裁断在画布外。'
};

export type StyleScope = 'color' | 'lighting' | 'atmosphere' | 'pixel_density' | 'architecture' | 'decoration' | 'texture';

export const STYLE_SCOPE_LABELS: Record<StyleScope, string> = {
  color: '色彩搭配',
  lighting: '光照方向',
  atmosphere: '场景氛围',
  pixel_density: '像素细节密度',
  architecture: '建筑造型倾向',
  decoration: '装饰丰富度',
  texture: '地表材质质感'
};

export interface StylePackage {
  style_id: string;
  style_name: string;
  style_description: string;
  style_text_rules: string;
  style_negative_rules: string;
  style_reference_images: ReferenceImage[];
  style_scope: StyleScope[];
}

export const PRESET_STYLE_PACKAGES: StylePackage[] = [
  {
    style_id: 'preset-gentle-pixel',
    style_name: '温柔清爽纯像素（经典基准）',
    style_description: '默认基准风格，2D 清爽等距像素，低饱和自然采光。',
    style_text_rules: '温柔、清爽、精致的纯 2D 像素画。像素簇和边缘清晰，统一约 128×128 逻辑像素的细节密度，低饱和自然配色。固定从东南方向俯看约 30 度的等距视角，左上方柔和日光。',
    style_negative_rules: '3D写实，油画质感，噪点滤镜，过度高光，刺眼荧光色',
    style_reference_images: [],
    style_scope: ['color', 'lighting', 'atmosphere', 'pixel_density']
  },
  {
    style_id: 'preset-golden-dusk',
    style_name: '黄昏暖金微光',
    style_description: '暖橙金黄夕阳光影，长阴影与宁静治愈的傍晚氛围。',
    style_text_rules: '温馨治愈的黄昏暮色 2D 等距像素画。夕阳金色暖光斜射，长长的柔和侧影，暖橙、琥珀与深靛蓝的天空环境色反射，窗户微弱暖光点缀。约 128×128 逻辑像素。',
    style_negative_rules: '正午白光，冰冷色调，刺眼泛光，高对比死黑',
    style_reference_images: [],
    style_scope: ['color', 'lighting', 'atmosphere']
  },
  {
    style_id: 'preset-retro-arcade',
    style_name: '复古厚重街机像素',
    style_description: '颗粒感更强、黑边勾线清晰、对比鲜明的复古掌机游戏画风。',
    style_text_rules: '浓郁复古 16-bit 街机等距像素画。轮廓有清晰深色像素描边，纯色块分层过渡，颗粒感明显，色彩鲜明有活力，带有经典复古掌机游戏质感。',
    style_negative_rules: '现代平滑矢量，无描边渐变，模糊抗锯齿，写实光影',
    style_reference_images: [],
    style_scope: ['pixel_density', 'texture', 'color', 'architecture']
  },
  {
    style_id: 'preset-pastel-dream',
    style_name: '梦幻粉彩微风',
    style_description: '马卡龙柔和粉彩，低对比度，空气感与童话绘本质感。',
    style_text_rules: '梦幻柔美的粉彩马卡龙色调等距像素画。薄荷绿、奶油白、淡桃粉与婴儿蓝交织，光线散射柔和，轻盈空气感，如同童话插画绘本。约 128×128 逻辑像素密度。',
    style_negative_rules: '暗黑系，高饱和红黑，重金属，工业生硬线条',
    style_reference_images: [],
    style_scope: ['color', 'atmosphere', 'texture', 'decoration']
  }
];

export interface LayeredInterventionView {
  rawInput: {
    notes: string[];
    focusTitles: string[];
    answers: Array<{ question: string; answer: string }>;
  };
  scenePlanning: {
    primarySubject: string;
    sceneDescription: string;
    groundSurface: string;
    translationRationale: string;
  };
  styleLayer: {
    styleId: string;
    styleName: string;
    textRules: string;
    negativeRules: string;
    referenceImages: ReferenceImage[];
    scopes: StyleScope[];
  };
  groundRulesLayer: {
    groundRules: string;
    aspectRatio: string;
    baseThickness: string;
    edgeRules: string;
  };
  imageToImageLayer: {
    mode: 'text_to_image' | 'image_to_image';
    referenceImages: ReferenceImage[];
    i2iRules: ImageToImageRules;
  };
  finalSubmission: {
    positivePrompt: string;
    negativePrompt: string;
    effectiveRoute: string;
    imageCount: number;
  };
}

export interface PromptBreakdownResult {
  positivePrompt: string;
  negativePrompt: string;
  totalChars: number;
  segments: {
    scene_content: number;
    structure_rules: number;
    scale_rules: number;
    style_package: number;
    transparency_rules: number;
    i2i_reference_rules: number;
    negative_prohibitions: number;
  };
}

export function buildI2IRoleGuidance(referenceImages?: ReferenceImage[]): string {
  if (!referenceImages || referenceImages.length === 0) return '';
  const lines: string[] = [];
  const hasStructure = referenceImages.some(img => img.role === 'structure');
  const hasScale = referenceImages.some(img => img.role === 'scale');
  const hasStyle = referenceImages.some(img => img.role === 'style');
  const hasContent = referenceImages.some(img => img.role === 'content');

  if (hasStructure) {
    lines.push('【结构图规则】：决定地块正方形等距菱形轮廓与道路连接口走向，严禁复制参考图内的具体纹理或UI。');
  }
  if (hasScale) {
    lines.push('【尺度图规则】：仅作为建筑、物体与角色的相对大小和比例尺参考，严格禁止借用其画风、材质或色彩，不改变画面风格。');
  }
  if (hasStyle) {
    lines.push('【风格图规则】：提供像素质感、色彩基调与光影氛围参考。');
  }
  if (hasContent) {
    lines.push('【内容图规则】：提供特定建筑或生活物品的视觉造型参考。');
  }
  return lines.join('\n');
}

export function assembleLayeredPositivePrompt(options: {
  sceneDescription: string;
  primarySubject?: string;
  groundSurfaceName?: string;
  stylePackage?: StylePackage;
  customStyleText?: string;
  groundRules?: string;
  isNativeAlpha?: boolean;
  mode?: 'text_to_image' | 'image_to_image';
  referenceImages?: ReferenceImage[];
  i2iRules?: ImageToImageRules;
}): string {
  return breakdownPromptSegments(options).positivePrompt;
}

export function breakdownPromptSegments(options: {
  sceneDescription: string;
  primarySubject?: string;
  groundSurfaceName?: string;
  stylePackage?: StylePackage;
  customStyleText?: string;
  structureRules?: string;
  scaleRules?: string;
  groundRules?: string;
  isNativeAlpha?: boolean;
  mode?: 'text_to_image' | 'image_to_image';
  referenceImages?: ReferenceImage[];
  i2iRules?: ImageToImageRules;
  customNegativeText?: string;
}): PromptBreakdownResult {
  const styleText = options.customStyleText?.trim() || options.stylePackage?.style_text_rules?.trim() || DEFAULT_STYLE;
  const structureText = options.structureRules?.trim() || DEFAULT_STRUCTURE_RULES;
  const scaleText = options.scaleRules?.trim() || DEFAULT_SCALE_RULES;
  const visualDesc = options.isNativeAlpha
    ? options.sceneDescription.replace(/纯白外背景|纯白背景|外部纯白|白色背景/g, '透明外背景')
    : options.sceneDescription;

  // 1. 风格层
  const styleClause = `【画风与氛围规范】\n${styleText}`;

  // 2. 场景主体层
  let subjectClause = '';
  if (options.primarySubject?.trim()) {
    subjectClause = `画面中必须清楚呈现${options.primarySubject.trim()}。主景占据主要视觉面积，不能只画空白地面。\n`;
  }
  const surfaceClause = options.groundSurfaceName ? `地面材质为${options.groundSurfaceName}。\n` : '';
  const sceneClause = `【场景生活构图】\n${subjectClause}${visualDesc}\n${surfaceClause}`.trim();

  // 3. 结构规则（决定地块形状和连接口）
  const structureClause = `【结构与地块几何】\n${structureText}`;

  // 4. 尺度规则（物体相对大小，不影响画风）
  const scaleClause = `【物体尺度与比例】\n${scaleText}`;

  // 5. 透明背景与外轮廓
  const transparencyClause = options.isNativeAlpha
    ? '【背景透明规范】\nThis is an RGBA image with transparency. 整块地块主体、底座与内部生活场景全部保留且不透明，仅地块外部完全透明，无白底、黑底、彩色底、棋盘格、天空或投影。'
    : '【外背景规范】\n地块外为均匀 RGB(255,255,255) 纯白背景，无投影、渐变或棋盘格。';

  // 6. 图生图与参考图层（区分 structure 和 scale）
  let i2iClause = '';
  if (options.mode === 'image_to_image' && options.referenceImages && options.referenceImages.length > 0) {
    const roleGuidance = buildI2IRoleGuidance(options.referenceImages);
    const rules = options.i2iRules || DEFAULT_I2I_RULES;
    const imageListDesc = options.referenceImages
      .map((img, i) => `图${i + 1}（${REFERENCE_ROLE_LABELS[img.role].label}）：${img.name}`)
      .join('；');

    i2iClause = `【参考图指导】包含 ${options.referenceImages.length} 张参考图（${imageListDesc}）。\n${roleGuidance}\n- 协同说明：${rules.roleInstructions}\n- 严格保留：${rules.preservationRules}\n- 允许重构：${rules.variationRules}\n- 禁止事项：${rules.prohibitions}`;
  }

  // 7. 负向规则（统一合并进正向 Prompt）
  const negativeText = assembleLayeredNegativePrompt({
    customNegativeText: options.customNegativeText,
    stylePackage: options.stylePackage,
    mode: options.mode
  });
  const negativeClause = `避免：${negativeText}。只画插画，任何位置都不要文字、字母、数字、日记、标题、标签、水印或说明卡片。`;

  const positiveParts = [
    options.isNativeAlpha ? 'This is an RGBA image with transparency.' : '',
    styleClause,
    sceneClause,
    structureClause,
    scaleClause,
    transparencyClause,
    i2iClause,
    negativeClause,
    options.isNativeAlpha ? 'The image has alpha channel and the background is transparent.' : ''
  ].filter(Boolean);

  const finalPositive = positiveParts.join('\n\n');

  return {
    positivePrompt: finalPositive,
    negativePrompt: negativeText,
    totalChars: finalPositive.length,
    segments: {
      scene_content: sceneClause.length,
      structure_rules: structureClause.length,
      scale_rules: scaleClause.length,
      style_package: styleClause.length,
      transparency_rules: transparencyClause.length,
      i2i_reference_rules: i2iClause.length,
      negative_prohibitions: negativeClause.length
    }
  };
}

export function assembleLayeredNegativePrompt(options: {
  customNegativeText?: string;
  stylePackage?: StylePackage;
  mode?: 'text_to_image' | 'image_to_image';
}): string {
  const baseNegative = DEFAULT_NEGATIVE;
  const styleNegative = options.stylePackage?.style_negative_rules?.trim();
  const customNegative = options.customNegativeText?.trim();

  const list = [
    baseNegative,
    styleNegative,
    customNegative,
    '空白草地，没有主体，日记文字，文字排版，说明文字，信息面板，厚重土壤剖面，左右底座厚度不一致，锥形悬浮岛，翘边，卷边，底板弯曲，翻折地块'
  ].filter(Boolean);

  if (options.mode === 'image_to_image') {
    list.push('直接复制参考图水印，参考图边框，参考图UI控件，参考图文字批注');
  }

  return Array.from(new Set(list.join('，').split(/[,，]\s*/))).join('，');
}
