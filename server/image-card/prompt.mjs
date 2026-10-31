export const PROMPT_VERSION = "isometric-image-card-v2";
export const STYLE = "温柔、清爽、精致的纯 2D 像素画。像素簇和边缘清晰，统一约 128×128 逻辑像素的细节密度，低饱和自然配色。固定从东南方向俯看约 30 度的等距视角，左上方柔和日光。";
export const BOUNDARIES = "完整 2.5D 等距像素插画，含一个菱形草地底座及厚度、一个主要主体和少量相关物件。地面宽高目标比例 1.68:1、目标中心 (50%,56%)，仍需人工核验。采用已验证的纯白背景构图；不保证模型原生透明，透明边缘处理仍待接入。画面完整，无文字、UI、图集、棋盘格或背景投影。不进行资产拼装，不把构图目标冒充自动标定结果。";
export const NEGATIVE = "顶视平面 tilemap，拼装图集，棋盘格背景，3D 写实，黏土，低多边形模型，模糊像素滤镜，过度装饰，密集建筑，文字，日期，水印，卡框，资源图标，宣传海报，裁断主体";
export function buildPrompt(description) {
  return { version: PROMPT_VERSION, style: STYLE, scene: description, boundaries: BOUNDARIES,
    // Exact white-background composition used in the second real diagnostic. PNG alpha is not promised.
    positive: `${STYLE}\n完整的 2.5D 等距像素插画，一个正方形菱形草地底座，薄而清楚的底座厚度，统一自然色和像素块。地面宽高约 1.68:1，地面中心在画布宽 50%、高 56% 附近。\n${description}\n画面主体完整，无文字、无 UI、无图集。地块外所有区域必须是均匀的纯白色，包含四个角；背景颜色 RGB(255,255,255)，无地平线、无光照渐变、无背景投影。`, negative: NEGATIVE };
}
