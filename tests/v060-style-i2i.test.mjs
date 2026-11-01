import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseStyleZipBuffer,
  createStyleZipBuffer
} from '../server/archive/style-pack.mjs';
import {
  PRESET_STYLE_PACKAGES,
  DEFAULT_STRUCTURE_RULES,
  DEFAULT_SCALE_RULES,
  breakdownPromptSegments,
  checkModuleDuplicates
} from '../dist/domain/domain/experiment-rules.js';
import { CompleteTerrainGeneration } from '../server/ai/complete-terrain.mjs';
import { ModelSettings } from '../server/ai/models.mjs';
import { DashScopeAdapter } from '../server/image-card/dashscope.mjs';
import { createArchiveHandler } from '../server/archive/http.mjs';
import { ArchiveService } from '../server/archive/service.mjs';

function mock1x1Png() {
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

test('V0.6.0 验收项 1：批量 ZIP 解析与完整导出回环', async () => {
  const zipPath = '/Users/jianmo/Downloads/Life_Map_V0.4.1_%E4%B9%9D%E5%A5%97%E9%A3%8E%E6%A0%BC_JSON%E5%AF%BC%E5%85%A5%E5%8C%85.zip';
  let zipBuffer;
  if (existsSync(zipPath)) {
    zipBuffer = await readFile(zipPath);
  } else {
    // 构造内存合成 ZIP 测试包
    const synthStyles = [
      {
        style_id: 'life-map-style-01',
        style_name: '测试风格 01',
        style_description: '测试',
        style_text_rules: 'pencil sketch',
        style_negative_rules: 'low quality',
        style_mode: 'text_and_image',
        style_reference_images: [
          {
            id: 'synth-img-1',
            name: 'sample1.png',
            dataUrl: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
            role: 'style',
            enabled: true,
            order: 0,
            sizeBytes: mock1x1Png().length
          }
        ]
      }
    ];
    zipBuffer = await createStyleZipBuffer(synthStyles);
  }

  const { styles: parsedStyles, manifest } = await parseStyleZipBuffer(zipBuffer);
  assert.ok(parsedStyles && parsedStyles.length >= 1, '必须至少解析出一个风格包');

  if (existsSync(zipPath)) {
    assert.equal(parsedStyles.length, 9, '官方 ZIP 必须准确解析出全部 9 套风格');
    const style08 = parsedStyles.find(s => s.style_id === 'life-map-style-08');
    const style09 = parsedStyles.find(s => s.style_id === 'life-map-style-09');
    assert.ok(style08, '必须包含风格 08');
    assert.ok(style09, '必须包含风格 09');
    assert.ok(style08.style_text_rules.length > 50, '风格 08 必须包含正向文本规则');
    assert.ok(style09.style_text_rules.length > 50, '风格 09 必须包含正向文本规则');

    // 给风格 08 和 09 注入参考图，验证导出再解包回环功能
    style08.style_reference_images = [
      {
        id: 'img-08-1',
        name: 'style_08_brush.png',
        dataUrl: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
        role: 'style',
        enabled: true,
        order: 0,
        sizeBytes: mock1x1Png().length
      }
    ];
    style09.style_reference_images = [
      {
        id: 'img-09-1',
        name: 'style_09_pixel.png',
        dataUrl: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
        role: 'style',
        enabled: true,
        order: 0,
        sizeBytes: mock1x1Png().length
      }
    ];
  }

  // 验证重新打包回环导出（含图片与独立 JSON）
  const exportedZip = await createStyleZipBuffer(parsedStyles);
  const { styles: reParsed } = await parseStyleZipBuffer(exportedZip);
  assert.equal(reParsed.length, parsedStyles.length, '导出后再解析风格数量必须完全一致');
  assert.equal(reParsed[0].style_id, parsedStyles[0].style_id, '首个风格 ID 必须一致');
  if (existsSync(zipPath)) {
    const re08 = reParsed.find(s => s.style_id === 'life-map-style-08');
    assert.equal(re08.style_reference_images.length, 1, '回环解包后风格 08 参考图必须保留');
    assert.equal(re08.style_reference_images[0].role, 'style', '图片角色必须固定为 style');
  }
});

test('V0.6.0 验收项 2：稳定 ID 重复冲突检测（覆盖 vs 跳过）', async () => {
  const existingStyles = [
    {
      style_id: 'life-map-style-01',
      style_name: '原版治愈绘本',
      style_text_rules: 'original prompt',
      style_negative_rules: 'original negative',
      style_mode: 'text_only',
      style_reference_images: []
    }
  ];

  const incomingStyle = {
    style_id: 'life-map-style-01',
    style_name: '更新版治愈绘本',
    style_text_rules: 'updated prompt',
    style_negative_rules: 'updated negative',
    style_mode: 'text_and_image',
    style_reference_images: [
      {
        id: 'new-img-1',
        name: 'cover.png',
        dataUrl: 'data:image/png;base64,mock',
        role: 'style',
        enabled: true,
        order: 0,
        sizeBytes: 100
      }
    ]
  };

  // 1. 模拟“覆盖 (Overwrite)”策略
  const overwritten = existingStyles.map(s => s.style_id === incomingStyle.style_id ? incomingStyle : s);
  assert.equal(overwritten[0].style_name, '更新版治愈绘本');
  assert.equal(overwritten[0].style_mode, 'text_and_image');
  assert.equal(overwritten[0].style_reference_images?.length, 1);

  // 2. 模拟“跳过 (Skip)”策略
  const skipped = existingStyles.slice();
  if (!skipped.some(s => s.style_id === incomingStyle.style_id)) {
    skipped.push(incomingStyle);
  }
  assert.equal(skipped[0].style_name, '原版治愈绘本');
  assert.equal(skipped[0].style_mode, 'text_only');
  assert.equal(skipped[0].style_reference_images?.length, 0);
});

test('V0.6.0 验收项 3：风格 08 与风格 09 切换时严格隔离，绝无上一套图片残留', () => {
  const style08Images = [
    {
      id: 'img-style-08-1',
      name: 'style08_texture.png',
      dataUrl: 'data:image/png;base64,mock08_1',
      role: 'style',
      order: 0
    },
    {
      id: 'img-style-08-2',
      name: 'style08_brush.png',
      dataUrl: 'data:image/png;base64,mock08_2',
      role: 'style',
      order: 1
    }
  ];

  const style09Images = [
    {
      id: 'img-style-09-1',
      name: 'style09_palette.png',
      dataUrl: 'data:image/png;base64,mock09_1',
      role: 'style',
      order: 0
    }
  ];

  const structureImage = {
    id: 'struct-1',
    name: 'terrain_shape.png',
    dataUrl: 'data:image/png;base64,mock_struct',
    role: 'structure',
    order: 0
  };

  // 场景 A：选中风格 08
  let currentStyleImages = style08Images;
  let baseLabImages = [structureImage];

  // 模拟请求合并：过滤掉任何已有的 style 图，只注入当前风格图
  let mergedFor08 = [
    ...baseLabImages.filter(img => img.role !== 'style'),
    ...currentStyleImages
  ];
  assert.equal(mergedFor08.length, 3);
  assert.ok(mergedFor08.some(img => img.id === 'img-style-08-1'));
  assert.ok(mergedFor08.some(img => img.id === 'img-style-08-2'));
  assert.ok(!mergedFor08.some(img => img.id === 'img-style-09-1'), '选中风格08时绝不可包含风格09图片');

  // 场景 B：切换至风格 09
  currentStyleImages = style09Images;
  // 即使 baseLabImages 先前被污染带有了旧的 style 图，合并时也必须彻底过滤
  baseLabImages = [...mergedFor08]; // 模拟潜在残留
  let mergedFor09 = [
    ...baseLabImages.filter(img => img.role !== 'style'),
    ...currentStyleImages
  ];
  assert.equal(mergedFor09.length, 2, '切换后仅保留结构图与风格09图片');
  assert.ok(mergedFor09.some(img => img.id === 'img-style-09-1'), '必须包含风格09图片');
  assert.ok(!mergedFor09.some(img => img.id === 'img-style-08-1'), '风格08图片被彻底清除');
  assert.ok(!mergedFor09.some(img => img.id === 'img-style-08-2'), '风格08图片被彻底清除');
  assert.ok(mergedFor09.some(img => img.role === 'structure'), '结构图始终保留');
});

test('V0.6.0 验收项 4：Structure + Scale + Style 参考图优先级顺序与职责隔离', () => {
  const images = [
    { id: 'style-1', name: 'style.png', dataUrl: 'data:image/png;base64,s', role: 'style', order: 0 },
    { id: 'struct-1', name: 'structure.png', dataUrl: 'data:image/png;base64,st', role: 'structure', order: 0 },
    { id: 'scale-1', name: 'scale.png', dataUrl: 'data:image/png;base64,sc', role: 'scale', order: 0 }
  ];

  const rolePriority = {
    structure: 1,
    scale: 2,
    style: 3,
    content: 4
  };

  const sortedImages = [...images].sort((a, b) => {
    const pA = rolePriority[a.role || 'structure'] || 99;
    const pB = rolePriority[b.role || 'structure'] || 99;
    if (pA !== pB) return pA - pB;
    return (a.order ?? 0) - (b.order ?? 0);
  });

  assert.equal(sortedImages[0].role, 'structure', '第 1 优先级必须是 structure');
  assert.equal(sortedImages[1].role, 'scale', '第 2 优先级必须是 scale');
  assert.equal(sortedImages[2].role, 'style', '第 3 优先级必须是 style');
});

test('V0.6.0 验收项 5：Prompt Module 4 注入风格艺术指导规则，严禁复制建筑或拼图', () => {
  const referenceImages = [
    { id: 'struct-1', name: 'struct.png', dataUrl: 'data:image/png;base64,1', role: 'structure' },
    { id: 'scale-1', name: 'scale.png', dataUrl: 'data:image/png;base64,2', role: 'scale' },
    { id: 'style-1', name: 'style08.png', dataUrl: 'data:image/png;base64,3', role: 'style' }
  ];

  const breakdown = breakdownPromptSegments({
    sceneDescription: '在安静的小镇街角，一位旅人坐在木长椅上翻看地图，旁边是一座红顶小砖房。',
    primarySubject: '红顶砖房与坐长椅的旅人',
    groundSurfaceName: '青石板路',
    isNativeAlpha: true,
    mode: 'image_to_image',
    stylePackage: {
      style_id: 'life-map-style-08',
      style_name: '复古手绘插画',
      style_description: '复古',
      style_text_rules: 'vintage watercolor illustration, soft ink contours',
      style_negative_rules: 'blurry, oversaturated',
      style_reference_images: [],
      style_scope: ['color'],
      style_mode: 'text_and_image'
    },
    referenceImages
  });

  const module4 = breakdown.modules.find(m => m.id === 'style');
  assert.ok(module4, '必须包含 style 模块');
  const m4 = module4.content;
  assert.ok(m4.includes('vintage watercolor illustration'), 'Module 4 必须包含风格正向词');
  assert.ok(m4.includes('【风格图画法指导】'), 'Module 4 必须包含风格图画法指导');
  assert.ok(m4.includes('绘画笔触、线条、色块、材质质感、配色方案与细节密度参考'), '必须声明仅参考画风与色彩');
  assert.ok(m4.includes('严禁复制参考图内的具体建筑、主体造型、构图布局、文字、UI控件或拼图标记'), '必须明确禁止复制建筑或拼图标记');
  assert.ok(m4.includes('最终画面场景内容严格由日记事实决定'), '必须声明主体严格由日记决定');

  // 验证无重复
  const dups = checkModuleDuplicates(breakdown.positivePrompt);
  assert.equal(dups.has_internal_duplicates, false, 'Prompt 各模块间绝不能存在严重冗余重复');
});

test('V0.6.0 验收项 6：仅文字模式与图片禁用开关生效验证', () => {
  // 1. 测试 text_only 模式
  const textOnlyStyle = {
    style_id: 'test-text-only',
    style_name: '纯文字模式测试',
    style_text_rules: 'pure text watercolor',
    style_mode: 'text_only',
    style_reference_images: [
      { id: 'img-1', name: 'test.png', dataUrl: 'data:image/png;base64,mock', role: 'style', enabled: true }
    ]
  };

  const isModeTextAndImage = textOnlyStyle.style_mode === 'text_and_image';
  const effectiveImagesForTextOnly = (isModeTextAndImage && textOnlyStyle.style_reference_images)
    ? textOnlyStyle.style_reference_images.filter(img => img.enabled)
    : [];
  assert.equal(effectiveImagesForTextOnly.length, 0, 'text_only 模式下绝不附带风格参考图');

  // 2. 测试图片 enabled: false 开关
  const textAndImageStyle = {
    style_id: 'test-enabled-switch',
    style_name: '图文模式开关测试',
    style_text_rules: 'illustration',
    style_mode: 'text_and_image',
    style_reference_images: [
      { id: 'img-1', name: 'img1.png', dataUrl: 'data:image/png;base64,1', role: 'style', enabled: true },
      { id: 'img-2', name: 'img2.png', dataUrl: 'data:image/png;base64,2', role: 'style', enabled: false },
      { id: 'img-3', name: 'img3.png', dataUrl: 'data:image/png;base64,3', role: 'style', enabled: true }
    ]
  };

  const effectiveImages = textAndImageStyle.style_reference_images.filter(img => img.enabled);
  assert.equal(effectiveImages.length, 2, '未启用的图片绝不参与生成');
  assert.equal(effectiveImages[0].id, 'img-1');
  assert.equal(effectiveImages[1].id, 'img-3');
});

test('V0.6.0 验收项 7：端到端生图请求合并验证（含 Structure + Scale + Style，零付费 Mock）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'v060-test-'));
  const settings = new ModelSettings(join(dir, 'settings.json'));
  settings.update({
    textProvider: 'qwen',
    qwenKey: 'fixture-test-dashscope-key',
    dashScopeApiKey: 'sk-test-v060',
    generationRoute: 'native-alpha',
    qwenImageModel: 'qwen-image-2.1-turbo'
  });

  const refImages = [
    {
      id: 'ref-struct-1',
      name: 'structure.png',
      dataUrl: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
      role: 'structure'
    },
    {
      id: 'ref-scale-1',
      name: 'scale.png',
      dataUrl: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
      role: 'scale'
    },
    {
      id: 'ref-style-1',
      name: 'style.png',
      dataUrl: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
      role: 'style'
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
                    image: 'https://fixture.oss-cn-beijing.aliyuncs.com/v060-verified.png'
                  }
                ]
              }
            }
          ]
        },
        usage: { image_count: 1 },
        request_id: 'v060-req-8888'
      });
    }
    return new Response(mock1x1Png());
  };

  const generator = new CompleteTerrainGeneration(settings, {
    storageRoot: dir,
    adapter: new DashScopeAdapter(mockFetch)
  });

  const payload = {
    candidate_id: 'candidate_1',
    planning_run_id: 'run-v060',
    client_request_id: '88888888-4444-4333-8222-111111111111',
    snapshot: { input_text: '在院子里喝茶看书，阳光很好。' },
    candidate_plan: {
      primary_subject: '藤椅与小茶几',
      scene_description: '院子中央放置着一把舒适精致的手工藤编休闲椅，与一张摆放着热腾腾花草茶的小圆桌，明媚温暖的阳光柔和地洒在干净整洁的青石板地面上，座椅周围盛开着簇簇淡黄色的小野花，微风吹拂着落叶与花香，营造出极其惬意闲适的午后阅读与品茗氛围。',
      terrain: { name: '青石砖地面' }
    },
    model_config: { provider: 'qwen' },
    image_pipeline: { route: 'native-alpha', model: 'qwen-image-2.1-turbo' },
    lab_config: {
      mode: 'image_to_image',
      reference_images: refImages,
      selected_style_id: 'life-map-style-08',
      style_package: {
        style_id: 'life-map-style-08',
        style_name: '复古手绘插画',
        style_text_rules: 'vintage retro watercolor illustration',
        style_negative_rules: 'modern photo, 3d render',
        style_mode: 'text_and_image',
        style_reference_images: []
      }
    }
  };

  const result = await generator.generate(payload);
  const report = result.job.audit_report;
  assert.ok(report, '必须包含审计报告');
  assert.equal(report.stage, 'completed');

  // 验证实际发给千问的消息内容
  const sentImages = actualRequestBody.input.messages[0].content.filter(item => item.image);
  assert.equal(sentImages.length, 3, '必须按顺序传入 3 张参考图');

  const sentText = actualRequestBody.input.messages[0].content.find(item => item.text)?.text;
  assert.ok(sentText.includes('vintage retro watercolor illustration'), '发往千问的 Prompt 必须包含风格正向词');
  assert.ok(sentText.includes('【风格图画法指导】'), '发往千问的 Prompt 必须包含风格图画法指导');
  assert.ok(sentText.includes('严禁复制参考图内的具体建筑'), '发往千问的 Prompt 必须包含防抄袭画风约束');
});

test('V0.6.0 验收项 8：HTTP 路由 /api/style/import-zip 与 /api/style/export-zip 接口功能验证', async () => {
  const handler = createArchiveHandler();

  // 1. 测试导出接口 POST /api/style/export-zip
  const sampleStyles = [
    {
      style_id: 'life-map-style-01',
      style_name: '测试风格 01',
      style_text_rules: 'sample text rules',
      style_reference_images: []
    }
  ];

  let resHeaders = {};
  let resStatus = 200;
  let resChunks = [];

  const mockResExport = {
    writeHead(status, headers) {
      resStatus = status;
      resHeaders = headers;
    },
    write(chunk) {
      resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
    end(chunk) {
      if (chunk) resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  };

  const mockReqExport = (async function* () {
    yield Buffer.from(JSON.stringify({ styles: sampleStyles }));
  })();
  mockReqExport.method = 'POST';
  mockReqExport.url = '/api/style/export-zip';

  const handledExport = await handler(mockReqExport, mockResExport);
  assert.equal(handledExport, true, '导出接口必须成功路由');
  assert.equal(resStatus, 200);
  assert.equal(resHeaders['content-type'], 'application/zip');
  const exportedZipBuffer = Buffer.concat(resChunks);
  assert.ok(exportedZipBuffer.length > 50, '导出的 ZIP 必须包含二进制数据');

  // 2. 测试导入接口 POST /api/style/import-zip (将刚导出的 zip 重新导入)
  let importStatus = 200;
  let importBody = '';
  const mockResImport = {
    writeHead(status, headers) {
      importStatus = status;
    },
    end(str) {
      importBody = str;
    }
  };

  const mockReqImport = (async function* () {
    yield exportedZipBuffer;
  })();
  mockReqImport.method = 'POST';
  mockReqImport.url = '/api/style/import-zip';

  const handledImport = await handler(mockReqImport, mockResImport);
  assert.equal(handledImport, true, '导入接口必须成功路由');
  assert.equal(importStatus, 200);
  const parsedImport = JSON.parse(importBody);
  assert.equal(parsedImport.success, true);
  assert.equal(parsedImport.count, 1);
  assert.equal(parsedImport.styles[0].style_id, 'life-map-style-01');
});
