export const DEFAULT_STYLE = '温柔、清爽、精致的纯 2D 像素画。像素簇和边缘清晰，统一约 128×128 逻辑像素的细节密度，低饱和自然配色。固定从东南方向俯看约 30 度的等距视角，左上方柔和日光。';
export const DEFAULT_GROUND_RULES = '统一地表与底座规范（优先于场景中关于厚底座或高台的描述）：整个场景只有一个正方形等距菱形地块，地表投影宽高约 1.68:1；地表占画布宽约 83%，地表菱形中心位于画布宽 50%、高 55.3% 附近，不能用建筑外轮廓或土层底端代替地表中心。底座仅为薄而清晰的等厚侧边，屏幕竖直厚度约为地表宽度的 3%，左右两侧厚度一致，底座下缘与对应的地表边缘平行；不画厚重土壤剖面、层层堆土、锥形悬浮岛或不规则岩柱。地表外轮廓是四条笔直边与四个平整角，不画翘边、卷边、翻折、碗状凹陷或向上弯曲的底板，不能通过扭曲外边缘表现透视。地表外边界的四个角与四条边保持同一基准面，并在边缘保留一圈窄的平缓衔接带，供相邻地块拼接。山地、丘陵、坡面或不平整地形可以在地块内部高于这一基准面，保留真实起伏和生活主景，不通过加厚底座表现海拔；不要把所有内部地形压平。完整保留建筑、树木、人物、道路及场景细节，不裁断主体，不重复叠加第二层底座。';
export const DEFAULT_NEGATIVE = '顶视平面 tilemap，拼装图集，棋盘格背景，3D 写实，黏土，低多边形模型，模糊像素滤镜，过度装饰，密集建筑，文字，日期，水印，卡框，资源图标，宣传海报，裁断主体';

export type ReferenceImageRole = 'structure' | 'style' | 'content';

export const REFERENCE_ROLE_LABELS: Record<ReferenceImageRole, { label: string; desc: string }> = {
  structure: {
    label: '底图 / 结构图',
    desc: '规定基本构图、地块形状、道路走向、主体位置与视角'
  },
  style: {
    label: '风格参考图',
    desc: '规定颜色、材质、像素感、氛围与细节密度'
  },
  content: {
    label: '内容参考图',
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
  roleInstructions: '底图(structure)提供整体地块菱形轮廓与主体大致方位；风格图(style)提供色彩搭配与像素质感；内容图(content)提供物件与建筑造型参考。',
  preservationRules: '保留约30度等距俯视视角；保留地块中心基准面；保留薄而等厚的底座侧边；保留边缘无翘边平整闭合。',
  variationRules: '根据日记内容调整主体细节与配饰；根据风格包调整色彩明暗与冷暖；允许微调植被与道路转角细节，不逐像素死板复制。',
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
  const styleText = options.customStyleText?.trim() || options.stylePackage?.style_text_rules?.trim() || DEFAULT_STYLE;
  const groundText = options.groundRules?.trim() || DEFAULT_GROUND_RULES;
  const visualDesc = options.isNativeAlpha
    ? options.sceneDescription.replace(/纯白外背景|纯白背景|外部纯白|白色背景/g, '透明外背景')
    : options.sceneDescription;

  const parts: string[] = [];

  if (options.isNativeAlpha) {
    parts.push('This is an RGBA image with transparency.');
  }

  // 1. 风格层
  parts.push(`【画风与氛围规范】\n${styleText}`);

  // 2. 场景主体层
  let subjectClause = '';
  if (options.primarySubject?.trim()) {
    subjectClause = `画面中必须清楚呈现${options.primarySubject.trim()}。主景占据主要视觉面积，不能只画空白草地。\n`;
  }
  const surfaceClause = options.groundSurfaceName ? `地面材质为${options.groundSurfaceName}。\n` : '';
  parts.push(`【场景生活构图】\n${subjectClause}${visualDesc}\n${surfaceClause}`.trim());

  // 3. 空间与地块几何层
  if (options.isNativeAlpha) {
    parts.push(
      `【等距地块与透明要求】\n主景、建筑、树木、人物、地面、道路及整个菱形底座全部保留，组成一个完整场景。底座和内部场景不透明，只有整个地块外部透明。\n${groundText}\n地块外不画白底、彩色底、棋盘格、投影或天空。`
    );
  } else {
    parts.push(
      `【等距地块与外背景规范】\n${groundText}\n地块外为均匀 RGB(255,255,255) 纯白背景，无投影、渐变或棋盘格。只画插画；任何位置都不要文字、字母、数字、日记、标题、标签、水印或说明卡片。屏幕和便签仅用无字色块表达。`
    );
  }

  // 4. 图生图与参考图层
  if (options.mode === 'image_to_image' && options.referenceImages && options.referenceImages.length > 0) {
    const rules = options.i2iRules || DEFAULT_I2I_RULES;
    const imageListDesc = options.referenceImages
      .map((img, i) => `参考图${i + 1}（${REFERENCE_ROLE_LABELS[img.role].label}）：${img.name}`)
      .join('；');

    parts.push(
      `【多参考图协同指导】\n本次包含 ${options.referenceImages.length} 张参考图（${imageListDesc}）。\n- 角色指导：${rules.roleInstructions}\n- 严格保留：${rules.preservationRules}\n- 允许重构：${rules.variationRules}\n- 禁止事项：${rules.prohibitions}`
    );
  }

  if (options.isNativeAlpha) {
    parts.push('The image has alpha channel and the background is transparent.');
  }

  return parts.join('\n\n');
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
