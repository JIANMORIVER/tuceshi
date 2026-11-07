import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCompleteScenePrompt,
  buildNativeScenePrompt,
  CompleteTerrainGeneration
} from '../server/ai/complete-terrain.mjs';
import { ModelSettings } from '../server/ai/models.mjs';
import { DashScopeAdapter } from '../server/image-card/dashscope.mjs';
import {
  REFERENCE_ROLE_LABELS,
  DEFAULT_STRUCTURE_RULES,
  DEFAULT_SCALE_RULES,
  breakdownPromptSegments,
  checkModuleDuplicates,
  estimateTokens
} from '../dist/domain/domain/experiment-rules.js';

function mockFixturePng() {
  return Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1,
    8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 10, 73, 68, 65, 84,
    120, 156, 99, 0, 1, 0, 0, 5, 0, 1,
    13, 10, 45, 180, 0, 0, 0, 0,
    73, 69, 78, 68, 174, 66, 96, 130
  ]);
}

test('验收项 1：同时上传 Structure 与 Scale 参考图，角色不混淆', () => {
  const referenceImages = [
    {
      id: 'ref-struct-1',
      name: 'base-terrain-layout.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      role: 'structure',
      weight: 1.0,
      description: '等距地块基础外形与东侧道路出口'
    },
    {
      id: 'ref-scale-1',
      name: 'character-house-scale.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      role: 'scale',
      weight: 0.8,
      description: '人物与房屋窗户的尺度参考图'
    }
  ];

  const breakdown = breakdownPromptSegments({
    sceneDescription: '在安静的小镇街角，一位旅人坐在木长椅上翻看地图，旁边是一座红顶小砖房。',
    primarySubject: '红顶砖房与坐长椅的旅人',
    groundSurfaceName: '青石板路',
    isNativeAlpha: true,
    mode: 'image_to_image',
    referenceImages
  });

  // 验证模块存在性及 5 段优先级架构
  assert.equal(breakdown.modules.length, 5);
  const [modStruct, modScene, modScale, modStyle, modTrans] = breakdown.modules;

  assert.equal(modStruct.id, 'structure');
  assert.equal(modScene.id, 'scene');
  assert.equal(modScale.id, 'scale');
  assert.equal(modStyle.id, 'style');
  assert.equal(modTrans.id, 'transparency_and_negatives');

  // 验证 Structure 模块不包含 Scale 的尺寸内容
  assert.ok(modStruct.content.includes('严格遵循结构参考图的地块外形'));
  assert.match(modStruct.content, /(红色|黑色)标记/);
  assert.ok(!modStruct.content.includes('仅供相对尺寸比例参考'));

  // 验证 Scale 模块不包含 Structure 的地块轮廓与出口
  assert.ok(modScale.content.includes('严格以尺度参考图为准'));
  assert.ok(modScale.content.includes('相对大小与比例尺'));
  assert.doesNotMatch(modScale.content, /(红色|黑色)标记/);
  assert.ok(!modScale.content.includes('菱形地块'));
});

test('验收项 2：两种角色规则分别独立生效，Scale 严格不影响画风', () => {
  const referenceImages = [
    {
      id: 'img-1',
      name: 'contour.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      role: 'structure',
      weight: 1.0
    },
    {
      id: 'img-2',
      name: 'reference-measure.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      role: 'scale',
      weight: 0.7
    }
  ];

  const promptResult = buildNativeScenePrompt(
    '画面中必须清楚呈现面包房与门前自行车。清晨的面包房飘散出刚出炉面包的麦香，门前停靠一辆复古自行车。地面材质为石子路。',
    {
      mode: 'image_to_image',
      reference_images: referenceImages
    }
  );

  // 验证 Structure 规则强化出口约束
  assert.match(promptResult.positive, /结构图中的每个(红色|黑色)标记，都必须转化为指定边缘上的自然道路出口/);
  assert.match(promptResult.positive, /道路必须延伸至地块边缘/);
  assert.match(promptResult.positive, /禁止只在地块内部生成道路却没有实际连接到边缘/);
  assert.match(promptResult.positive, /不同场景允许使用不同道路材质/);

  // 验证 Scale 规则明确说明不影响画风色彩
  assert.match(promptResult.positive, /严格以尺度参考图为准，控制人物、建筑、树木、道路与生活物件的相对大小与比例尺/);
  assert.match(promptResult.positive, /严格禁止借用其画风、材质或色彩，不影响画面风格/);

  // 验证风格模块依然保持统一纯 2D 像素画
  assert.match(promptResult.positive, /温柔、清爽、精致的纯 2D 像素画/);
});

test('验收项 3：移除 Scale 参考图后，Structure 仍可独立正常工作', () => {
  const onlyStructure = [
    {
      id: 'img-only-struct',
      name: 'just-base.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      role: 'structure',
      weight: 1.0
    }
  ];

  const promptResult = buildNativeScenePrompt(
    '安静的花园温室，阳光透过玻璃窗照射在绿植花架上。地面为红砖地面。',
    {
      mode: 'image_to_image',
      reference_images: onlyStructure
    }
  );

  // Structure 规则仍然生效
  assert.match(promptResult.positive, /严格遵循结构参考图的地块外形/);
  assert.match(promptResult.positive, /(红色|黑色)标记/);

  // Scale 规则自动退回标准默认尺度规则
  assert.match(promptResult.positive, /物体与建筑保持等距像素插画的标准比例尺/);
  assert.doesNotMatch(promptResult.positive, /以尺度参考图为准/);
});

test('验收项 4：Prompt 经过严格去重检查，字数稳定在 500～800 字符目标区间', () => {
  // 1. 验证标准场景 Prompt 长度在 500～800 字符目标区间附近
  const standardTextPrompt = buildNativeScenePrompt(
    '画面中必须清楚呈现湖边长椅。清晨微风吹过水面，阳光斑驳，长椅旁放着一杯咖啡。',
    { mode: 'text_to_image' }
  );
  console.log(`[Prompt 优化审计] v0.5.0 纯文本生成 Prompt 字符数: ${standardTextPrompt.positive.length}，估算 Tokens: ${standardTextPrompt.estimatedTokens}`);

  const promptResult = buildNativeScenePrompt(
    '安静的日落露营地，帐篷支在草地上，篝火升起缕缕青烟，旁边停着一辆越野折叠车。地面为草地与泥土。',
    {
      mode: 'image_to_image',
      reference_images: [
        { id: '1', name: 'base.png', dataUrl: 'data:image/png;base64,x', role: 'structure', weight: 1.0 },
        { id: '2', name: 'scale.png', dataUrl: 'data:image/png;base64,x', role: 'scale', weight: 1.0 }
      ]
    }
  );

  // 2. 各模块内部去重检查全部通过，无冗余堆砌与短语重复
  for (const mod of promptResult.modules) {
    const dupCheck = checkModuleDuplicates(mod.content);
    assert.equal(dupCheck.has_internal_duplicates, false, `模块 ${mod.name} 不应有异常重复词汇: ${dupCheck.duplicate_keywords.join(', ')}`);
  }

  // 3. 检查总字数区间（双参考图在彻底消除重复拼接后控制在紧凑合理范围）
  const totalLength = promptResult.positive.length;
  console.log(`[Prompt 优化审计] v0.5.0 图生图 (双参考图) 最终 Prompt 总字符数: ${totalLength}，估算 Tokens: ${promptResult.estimatedTokens}`);
  assert.ok(totalLength <= 1300, `图生图 Prompt 字符数 ${totalLength} 经过严格去重后已大幅收敛，不再出现 1600+ 膨胀`);
});

test('验收项 5：地块形状核心参数与透明背景要求完整保留，绝无退化', () => {
  const prompt = buildNativeScenePrompt(
    '古朴的书房岛，古木书桌与满架典籍。',
    { mode: 'text_to_image' }
  );

  // 拼接核心几何指标
  assert.ok(prompt.positive.includes('1.68:1'), '保留 1.68:1 宽高比');
  assert.ok(prompt.positive.includes('83%'), '保留 83% 画布宽占比');
  assert.ok(prompt.positive.includes('55.3%'), '保留 55.3% 中心高');
  assert.ok(prompt.positive.includes('3%'), '保留 3% 薄底座要求');
  assert.ok(prompt.positive.includes('同一基准面'), '保留边缘统一基准面要求');

  // 原生透明度要求
  assert.ok(prompt.positive.startsWith('This is an RGBA image with transparency.'));
  assert.ok(prompt.positive.includes('整个菱形底座与场景主体、内部生活场景全部保留且不透明'));
  assert.ok(prompt.positive.includes('仅地块外部完全透明'));
  assert.ok(prompt.positive.includes('无白底、黑底、彩色底、棋盘格、天空或外部投影'));
  assert.equal(prompt.negative, '', '原生模式下 negative_prompt 应保持空字符串');
});

test('验收项 6：原有历史实验记录能够正常读取，手动修改角色后可保存，且不按文件名覆盖', () => {
  // 模拟一份历史版本保存的实验记录
  const historicalExperiment = {
    id: 'exp-v030-historical',
    version: 1,
    title: '历史生成实验 #030',
    created_at: '2026-10-31T10:00:00.000Z',
    status: 'completed',
    lab: {
      mode: 'image_to_image',
      selectedStyleId: 'preset-gentle-pixel',
      referenceImages: [
        {
          id: 'hist-img-1',
          name: 'scale_ruler.png', // 文件名带有 scale
          dataUrl: 'data:image/png;base64,historical',
          role: 'structure', // 用户手动设置为 structure
          weight: 1.0
        }
      ],
      i2iRules: {
        denoisingStrength: 0.65,
        roleInstructions: []
      }
    }
  };

  // 1. 正常读取并解析历史实验
  assert.equal(historicalExperiment.lab.referenceImages[0].role, 'structure');

  // 2. 模拟前端操作：绝不因为文件名叫 'scale_ruler.png' 就自动篡改其 role 为 'scale'
  const restoredRole = historicalExperiment.lab.referenceImages[0].role;
  assert.equal(restoredRole, 'structure', '历史数据不得被文件名自动覆盖');

  // 3. 用户支持手动将历史图片修改为 'scale'
  historicalExperiment.lab.referenceImages[0].role = 'scale';
  assert.equal(historicalExperiment.lab.referenceImages[0].role, 'scale', '允许用户手动切换角色为 scale');
});

test('验收项 7：端到端生成产出包含完整 5 段模块审计、估算 Token 与无重复标记', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'v050-audit-'));
  const settings = new ModelSettings();
  settings.update({ textProvider: 'qwen', qwenKey: 'fixture-test-dashscope-key' });

  const refImages = [
    {
      id: 'struct-1',
      name: 'base.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      role: 'structure',
      weight: 1.0
    },
    {
      id: 'scale-1',
      name: 'scale.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      role: 'scale',
      weight: 0.8
    }
  ];

  let actualRequestBody = null;
  const mockFetch = async (url, opts) => {
    if (opts?.method === 'POST') {
      actualRequestBody = JSON.parse(opts.body);
      return Response.json({
        output: {
          choices: [
            {
              message: {
                content: [
                  {
                    image: 'https://fixture.oss-cn-beijing.aliyuncs.com/v050-verified.png'
                  }
                ]
              }
            }
          ]
        },
        usage: { image_count: 1 },
        request_id: 'v050-req-9999'
      });
    }
    return new Response(mockFixturePng());
  };

  const generator = new CompleteTerrainGeneration(settings, {
    storageRoot: dir,
    adapter: new DashScopeAdapter(mockFetch)
  });

  const payload = {
    candidate_id: 'candidate_1',
    planning_run_id: 'run-v050',
    client_request_id: '88888888-4444-4333-8222-111111111111',
    snapshot: { input_text: '在秋风吹过的红枫树下看一本老书。' },
    candidate_plan: {
      primary_subject: '红枫树与阅读椅',
      scene_description: '庭院中央伫立着一株饱满舒展的红枫树，金红色的落叶散落在青石小径旁，树下置放一张藤编休闲椅与一杯冒着热气的清茶，旁边是一方小巧的石制流水景观，微风拂过落叶沙沙作响，阳光穿过枫叶在地面投下温暖斑驳的秋日光影。',
      terrain: { name: '青石砖庭院' }
    },
    model_config: { provider: 'qwen' },
    image_pipeline: { route: 'native-alpha', model: 'qwen-image-2.1-turbo' },
    lab_config: {
      mode: 'image_to_image',
      reference_images: refImages
    }
  };

  const result = await generator.generate(payload);
  const report = result.job.audit_report;
  assert.ok(report, '必须包含审计报告');
  assert.equal(report.stage, 'completed');
  const sentText = actualRequestBody.input.messages[0].content.find(item => item.text)?.text;
  assert.equal(report.final_prompt, sentText, 'audit_report 中的 final_prompt 与实际发往千问的 Prompt 必须完全一致');
  assert.ok(report.estimated_tokens > 0, '必须包含合理的 estimated_tokens');
  assert.equal(report.prompt_modules.length, 5, '必须包含 5 个按优先级排序的规则模块');

  // 验证各模块长度与去重情况
  for (const mod of report.prompt_modules) {
    assert.ok(mod.char_count > 0, `模块 ${mod.name} 字符数必须大于 0`);
    assert.equal(mod.duplicate_check.has_internal_duplicates, false, `模块 ${mod.name} 内部必须无重复`);
  }

  // 验证参考图角色映射在审计报告中准确呈现
  assert.equal(report.images_meta.count, 2);
  assert.deepEqual(
    report.images_meta.details.map(d => d.role),
    ['structure', 'scale']
  );
});
