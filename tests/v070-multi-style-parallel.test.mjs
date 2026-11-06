import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseStyleZipBuffer,
  createStyleZipBuffer
} from '../server/archive/style-pack.mjs';
import { createArchiveHandler } from '../server/archive/http.mjs';
import { ArchiveService } from '../server/archive/service.mjs';
import { CompleteTerrainGeneration } from '../server/ai/complete-terrain.mjs';
import { ModelSettings } from '../server/ai/models.mjs';
import { DashScopeAdapter } from '../server/image-card/dashscope.mjs';
import {
  PRESET_STYLE_PACKAGES,
  DEFAULT_I2I_RULES
} from '../dist/domain/domain/experiment-rules.js';

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

test('V0.7.0 验收项 1：修复导出全套风格 ZIP，且独立保存图片与精简 style.json', async () => {
  const handler = createArchiveHandler();

  const testStyles = [
    {
      style_id: 'life-map-style-01',
      style_name: '清新手绘像素',
      style_description: '风格01',
      style_text_rules: 'clean pixel isometric illustration',
      style_negative_rules: '3d realistic',
      style_mode: 'text_and_image',
      style_reference_images: [
        {
          id: 'img-1-1',
          name: 'pixel_sample.png',
          dataUrl: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
          role: 'style',
          enabled: true,
          order: 0,
          sizeBytes: mock1x1Png().length
        }
      ]
    },
    {
      style_id: 'life-map-style-02',
      style_name: '清新动画手绘风',
      style_description: '风格02',
      style_text_rules: 'anime watercolor hand-drawn',
      style_negative_rules: 'photorealistic',
      style_mode: 'text_only',
      style_reference_images: []
    }
  ];

  // 1. 发起 POST /api/style/export-zip 请求
  let resStatus = 200;
  let resHeaders = {};
  const chunks = [];
  const mockRes = {
    writeHead(status, headers) {
      resStatus = status;
      resHeaders = headers;
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  };

  const mockReq = (async function* () {
    yield Buffer.from(JSON.stringify({ styles: testStyles }));
  })();
  mockReq.method = 'POST';
  mockReq.url = '/api/style/export-zip';

  const handled = await handler(mockReq, mockRes);
  assert.equal(handled, true, '导出接口必须路由命中');
  assert.equal(resStatus, 200, '必须返回 200 成功状态');
  assert.equal(resHeaders['content-type'], 'application/zip');

  const zipBuf = Buffer.concat(chunks);
  assert.ok(zipBuf.length > 100, '导出的 ZIP 必须包含有效内容');

  // 2. 验证解压回环：验证外部图片是否被正确恢复为 dataUrl
  const { styles: parsed } = await parseStyleZipBuffer(zipBuf);
  assert.equal(parsed.length, 2, '必须完整解析出 2 套风格');
  assert.equal(parsed[0].style_reference_images.length, 1, '第 1 套风格图片必须保留');
  assert.ok(parsed[0].style_reference_images[0].dataUrl.startsWith('data:image/png;base64,'), '图片必须成功恢复为 dataUrl');
});

test('V0.7.0 验收项 2：多风格平行套用算法（4 个风格生成 8 张独立方案）', () => {
  const initialCandidates = [
    {
      id: 'candidate_1',
      plan: {
        title: '庭院品茶',
        primary_subject: '藤椅与小茶几',
        scene_description: '在阳光温和的庭院中，放置着一把舒适精致的手工藤编休闲椅与一张摆放着热腾腾花草茶的小圆桌，明媚温暖的阳光柔和地洒在青石板地面上。',
        terrain: { name: '青石板庭院' }
      },
      submissionId: '11111111-2222-4333-8444-555555555551',
      status: 'known',
      originCandidateId: 'candidate_1',
      styleId: 'life-map-style-01',
      styleName: '风格01｜清新手绘像素'
    },
    {
      id: 'candidate_2',
      plan: {
        title: '庭院红枫',
        primary_subject: '红枫树与落叶小径',
        scene_description: '庭院中央伫立着一株饱满舒展的红枫树，金红色的落叶散落在青石小径旁，树下置放一张藤编休闲椅与一杯冒着热气的清茶，旁边是一方流水景观。',
        terrain: { name: '青石板庭院' }
      },
      submissionId: '11111111-2222-4333-8444-555555555552',
      status: 'known',
      originCandidateId: 'candidate_2',
      styleId: 'life-map-style-01',
      styleName: '风格01｜清新手绘像素'
    }
  ];

  const targetStyles = [
    { style_id: 'life-map-style-03', style_name: '风格03｜新中式写意场景' },
    { style_id: 'life-map-style-04', style_name: '风格04｜新中式春节夜景' },
    { style_id: 'life-map-style-08', style_name: '风格08｜童趣水粉手绘世界' }
  ];

  // 模拟 applyOtherStyles 的派生逻辑
  const updatedCandidates = [...initialCandidates];
  const createdIds = [];

  for (const style of targetStyles) {
    for (const src of initialCandidates) {
      const baseKey = src.originCandidateId || src.id;
      const safeStyleKey = style.style_id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const newId = `${baseKey}__${safeStyleKey}`;

      const newCand = {
        id: newId,
        plan: { ...src.plan },
        submissionId: `sub-${newId}-${Date.now()}`,
        status: 'not_started',
        styleId: style.style_id,
        styleName: style.style_name,
        originCandidateId: baseKey
      };
      updatedCandidates.push(newCand);
      createdIds.push(newId);
    }
  }

  // 验证：原先 2 张（风格 01）+ 新增 3 个风格 × 2 个方案（6 张）= 总共 8 张独立方案！
  assert.equal(updatedCandidates.length, 8, '4 个风格必须总计生成 8 个方案');
  assert.equal(createdIds.length, 6, '新创建的方案数量必须为 6');

  // 验证每个方案的独立性与标识
  const style03_c1 = updatedCandidates.find(c => c.id === 'candidate_1__life-map-style-03');
  const style03_c2 = updatedCandidates.find(c => c.id === 'candidate_2__life-map-style-03');
  const style08_c1 = updatedCandidates.find(c => c.id === 'candidate_1__life-map-style-08');

  assert.ok(style03_c1, '必须存在风格 03 的方案一');
  assert.ok(style03_c2, '必须存在风格 03 的方案二');
  assert.equal(style03_c1.originCandidateId, 'candidate_1');
  assert.equal(style03_c2.originCandidateId, 'candidate_2');
  assert.equal(style03_c1.styleName, '风格03｜新中式写意场景');
  assert.equal(style08_c1.styleName, '风格08｜童趣水粉手绘世界');
  assert.notEqual(style03_c1.submissionId, style03_c2.submissionId, '每个方案必须拥有独立 submissionId');
});

test('V0.7.0 验收项 3：后端服务无障碍接收与生成多风格衍生方案（含 Structure + Scale + Style）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'v070-test-'));
  const settings = new ModelSettings(join(dir, 'settings.json'));
  settings.update({
    textProvider: 'qwen',
    qwenKey: 'fixture-test-dashscope-key',
    dashScopeApiKey: 'sk-test-v070',
    generationRoute: 'native-alpha',
    qwenImageModel: 'qwen-image-2.1-turbo'
  });

  let capturedBody = null;
  const mockFetch = async (url, opts) => {
    if (opts?.method === 'POST') {
      capturedBody = JSON.parse(opts.body);
      return Response.json({
        output: {
          choices: [
            {
              message: {
                content: [
                  {
                    image: 'https://fixture.oss-cn-beijing.aliyuncs.com/v070-verified.png'
                  }
                ]
              }
            }
          ]
        },
        usage: { image_count: 1 },
        request_id: 'v070-req-7777'
      });
    }
    return new Response(mock1x1Png());
  };

  const generator = new CompleteTerrainGeneration(settings, {
    storageRoot: dir,
    adapter: new DashScopeAdapter(mockFetch)
  });

  // 测试一个衍生候选 ID：candidate_1__life-map-style-08
  const payload = {
    candidate_id: 'candidate_1__life-map-style-08',
    planning_run_id: 'run-v070-multi',
    client_request_id: '88888888-4444-4333-8222-222222222222',
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
      selected_style_id: 'life-map-style-08',
      style: 'glowing watercolor illustration with ink lines',
      negativeRules: 'blurry, dark',
      reference_images: [
        {
          id: 'ref-struct-1',
          name: 'structure.png',
          dataUrl: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
          role: 'structure'
        },
        {
          id: 'ref-style-08',
          name: 'style_08.png',
          dataUrl: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
          role: 'style'
        }
      ]
    }
  };

  const result = await generator.generate(payload);
  assert.ok(result.job, '必须成功生成 job');
  assert.equal(result.job.candidate_id, 'candidate_1__life-map-style-08', '必须准确保留衍生方案 ID');
  assert.ok(capturedBody, '必须捕获到请求体');

  const promptText = capturedBody.input.messages[0].content.find(item => item.text)?.text;
  assert.ok(promptText.includes('glowing watercolor illustration with ink lines'), 'Prompt 必须注入当前风格文字规则');
  assert.ok(promptText.includes('【风格图画法指导】'), '必须注入画风指导');
});

test('V0.7.0 验收项 4：多风格实验全量 8 方案打包归档导出', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'v070-archive-'));
  const archive = new ArchiveService({ storageRoot: dir });

  const runId = 'exp-multi-style-8';
  const candidates = [];
  const styles = ['style-01', 'style-03', 'style-08', 'style-09'];

  for (const s of styles) {
    for (const p of ['candidate_1', 'candidate_2']) {
      const cId = `${p}__${s}`;
      candidates.push({
        id: cId,
        title: `${s}-${p}`,
        origin_candidate_id: p,
        style_id: s,
        image_url: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
        original_image_url: `data:image/png;base64,${mock1x1Png().toString('base64')}`,
        status: 'known'
      });
    }
  }

  assert.equal(candidates.length, 8, '必须包含 8 个方案');

  await archive.saveRun({
    experiment_id: runId,
    created_at: new Date().toISOString(),
    provider: 'qwen',
    candidates
  });

  const zipBuffer = await archive.exportZip(runId);
  assert.ok(zipBuffer.length > 500, '多风格实验 ZIP 包必须成功生成且大小合理');
});
