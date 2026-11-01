import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompleteScenePrompt,
  buildNativeScenePrompt,
  GROUND_RULES
} from '../server/ai/complete-terrain.mjs';
import {
  PRESET_STYLE_PACKAGES,
  DEFAULT_I2I_RULES,
  assembleLayeredPositivePrompt,
  assembleLayeredNegativePrompt
} from '../dist/domain/domain/experiment-rules.js';
import { freshExperiment } from '../dist/domain/workbench/flow.js';

test('style package injection correctly overrides default style and appends custom negative rules', () => {
  const duskStyle = PRESET_STYLE_PACKAGES.find(s => s.style_id === 'preset-golden-dusk');
  assert.ok(duskStyle, 'preset-golden-dusk exists');

  const prompt = buildCompleteScenePrompt('林间小屋与长椅', {
    style: duskStyle.style_text_rules,
    negativeRules: duskStyle.style_negative_rules
  });

  assert.ok(prompt.positive.includes('黄昏暮色'), 'contains dusk style positive prompt');
  assert.ok(prompt.negative.includes('正午白光'), 'contains dusk negative rule');
  assert.ok(prompt.positive.includes(GROUND_RULES), 'preserves ground footprint rules');
});

test('image-to-image mode appends reference image role guidance and prohibitions', () => {
  const refImages = [
    { id: 'ref-1', name: 'structure.png', role: 'structure', dataUrl: 'data:image/png;base64,mock1' },
    { id: 'ref-2', name: 'palette.png', role: 'style', dataUrl: 'data:image/png;base64,mock2' }
  ];

  const prompt = buildCompleteScenePrompt('海边小木屋', {
    mode: 'image_to_image',
    referenceImages: refImages,
    i2iRules: DEFAULT_I2I_RULES
  });

  assert.ok(prompt.positive.includes('【参考图指导】包含 2 张参考图'), 'has reference image count header');
  assert.ok(prompt.positive.includes(DEFAULT_I2I_RULES.roleInstructions), 'has role instructions');
  assert.ok(prompt.positive.includes(DEFAULT_I2I_RULES.preservationRules), 'has preservation rules');
  assert.ok(prompt.negative.includes('复制参考图边框'), 'adds i2i specific negative prompt');
});

test('layered prompt assembly mirrors both native-alpha and standard routes', () => {
  const layeredWhite = assembleLayeredPositivePrompt({
    sceneDescription: '湖畔钓鱼平台',
    primarySubject: '木质钓鱼平台',
    isNativeAlpha: false
  });
  assert.ok(layeredWhite.includes('【画风与氛围规范】'));
  assert.ok(layeredWhite.includes('RGB(255,255,255) 纯白背景'));

  const layeredNative = assembleLayeredPositivePrompt({
    sceneDescription: '白色背景下的湖畔钓鱼平台',
    primarySubject: '木质钓鱼平台',
    isNativeAlpha: true
  });
  assert.ok(layeredNative.startsWith('This is an RGBA image with transparency.'));
  assert.ok(!layeredNative.includes('纯白背景'));
  assert.ok(layeredNative.includes('The image has alpha channel and the background is transparent.'));
});

test('freshExperiment initializes default lab configuration with preset style and i2i rules', () => {
  const exp = freshExperiment();
  assert.equal(exp.version, 1);
  assert.ok(exp.lab, 'lab config is initialized');
  assert.equal(exp.lab.mode, 'text_to_image');
  assert.equal(exp.lab.selectedStyleId, 'preset-gentle-pixel');
  assert.deepEqual(exp.lab.referenceImages, []);
  assert.ok(exp.lab.i2iRules.roleInstructions.length > 0);
});
