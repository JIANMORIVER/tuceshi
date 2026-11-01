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
  DEFAULT_I2I_RULES,
  breakdownPromptSegments
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

function createSampleInput(overrides = {}) {
  return {
    candidate_id: 'candidate_1',
    planning_run_id: 'test-audit-run-id',
    client_request_id: '88888888-4444-4333-8222-111111111111',
    snapshot: {
      input_text: '今天在湖边散步，阳光洒在水面上，我坐在木椅上喝着热咖啡。'
    },
    candidate_plan: {
      primary_subject: '湖边木长椅与热咖啡',
      scene_description: '画面中央有一个质朴的木质长椅，长椅旁边放着一杯冒着热气的咖啡，周围是平整的草地和小径，近处有野花点缀，远处有宁静的湖水与微风泛起的粼粼波光，整体构成温馨宁静的日常画面。',
      terrain: { name: '湖畔草地与碎石路' }
    },
    model_config: { provider: 'mock' },
    image_pipeline: { route: 'native-alpha', model: 'qwen-image-2.1-turbo' },
    ...overrides
  };
}

test('Scenario 1: 纯文字生成 (Pure text-to-image)', async () => {
  const input = createSampleInput();
  const prompt = buildNativeScenePrompt(
    `画面中必须清楚呈现${input.candidate_plan.primary_subject}。${input.candidate_plan.scene_description}地面材质为${input.candidate_plan.terrain.name}。`,
    { mode: 'text_to_image' }
  );

  // 1. 验证正向 Prompt 结构与核心要素
  assert.ok(prompt.positive.includes('This is an RGBA image with transparency.'));
  assert.ok(prompt.positive.includes('湖边木长椅与热咖啡'));
  assert.ok(prompt.positive.includes('湖畔草地与碎石路'));
  assert.ok(prompt.positive.includes('统一地表与底座规范'));
  assert.ok(prompt.positive.includes('避免：顶视平面 tilemap'));
  // 负向词已合并进正向，且顶层 negative 为空
  assert.equal(prompt.negative, '');
  // 不包含日记原始全文与无关字段
  assert.ok(!prompt.positive.includes('今天在湖边散步，阳光洒在水面上'));

  // 2. 验证各段长度审计
  assert.ok(prompt.segments.scene_content > 50);
  assert.ok(prompt.segments.structure_rules > 50);
  assert.ok(prompt.segments.scale_rules > 30);
  assert.ok(prompt.segments.style_package > 30);
  assert.ok(prompt.segments.transparency_rules > 50);
  assert.equal(prompt.segments.i2i_reference_rules, 0);
  assert.ok(prompt.segments.negative_prohibitions > 20);

  // 3. 执行端到端调用生成并检查 audit_report
  const settings = new ModelSettings();
  const dir = await mkdtemp(join(tmpdir(), 'audit-test-t2i-'));
  const terrain = new CompleteTerrainGeneration(settings, {
    storageRoot: dir,
    adapter: {
      async generate() {
        return { bytes: mockFixturePng(), requestId: 'mock-req-t2i' };
      }
    }
  });

  const result = await terrain.generate(input);
  const audit = result.job.audit_report;
  assert.ok(audit, '生成审计报告存在');
  assert.equal(audit.stage, 'completed');
  assert.equal(audit.images_meta.count, 0);
  assert.equal(audit.images_meta.details.length, 0);
  assert.equal(audit.http_meta.status_code, 200);
  assert.ok(audit.total_prompt_chars > 300 && audit.total_prompt_chars < 1500, '总字数在安全窗口内');
});

test('Scenario 2: 文字＋结构图 (Text + Structure reference)', async () => {
  const structureImg = {
    id: 'ref-struct-1',
    name: 'terrain-contour.png',
    role: 'structure',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    sizeBytes: 1024
  };

  const input = createSampleInput({
    lab_config: {
      mode: 'image_to_image',
      reference_images: [structureImg],
      i2i_rules: DEFAULT_I2I_RULES
    }
  });

  const prompt = buildNativeScenePrompt(
    `画面中必须清楚呈现${input.candidate_plan.primary_subject}。${input.candidate_plan.scene_description}`,
    input.lab_config
  );

  // 验证包含结构图专属规则
  assert.ok(prompt.positive.includes('【结构图规则】：决定地块形状、等距菱形轮廓与道路连接口走向'));
  assert.ok(!prompt.positive.includes('【尺度图规则】'));
  assert.ok(prompt.segments.i2i_reference_rules > 0);

  // 执行端到端调用并检查 audit_report
  const settings = new ModelSettings();
  const dir = await mkdtemp(join(tmpdir(), 'audit-test-struct-'));
  const terrain = new CompleteTerrainGeneration(settings, {
    storageRoot: dir,
    adapter: {
      async generate() {
        return { bytes: mockFixturePng(), requestId: 'mock-req-struct' };
      }
    }
  });

  const result = await terrain.generate(input);
  const audit = result.job.audit_report;
  assert.ok(audit);
  assert.equal(audit.images_meta.count, 1);
  assert.equal(audit.images_meta.details[0].role, 'structure');
  assert.equal(audit.images_meta.details[0].name, 'terrain-contour.png');
  // 必须没有完整 Base64 暴露在审计详情中
  assert.equal(audit.images_meta.details[0].dataUrl, undefined);
  assert.ok(audit.images_meta.estimated_request_payload_bytes > 0);
});

test('Scenario 3: 文字＋结构图＋尺度图 (Text + Structure + Scale reference)', async () => {
  const structureImg = {
    id: 'ref-struct-1',
    name: 'terrain-boundary.png',
    role: 'structure',
    dataUrl: 'data:image/png;base64,mockStructBase64',
    sizeBytes: 2048
  };
  const scaleImg = {
    id: 'ref-scale-1',
    name: 'object-proportions.png',
    role: 'scale',
    dataUrl: 'data:image/png;base64,mockScaleBase64',
    sizeBytes: 4096
  };

  const input = createSampleInput({
    lab_config: {
      mode: 'image_to_image',
      reference_images: [structureImg, scaleImg],
      i2i_rules: DEFAULT_I2I_RULES
    }
  });

  const prompt = buildNativeScenePrompt(
    `画面中必须清楚呈现${input.candidate_plan.primary_subject}。${input.candidate_plan.scene_description}`,
    input.lab_config
  );

  // 验证同时精准包含结构图与尺度图指导，尺度图明确不影响画风
  assert.ok(prompt.positive.includes('【结构图规则】：决定地块形状、等距菱形轮廓与道路连接口走向'));
  assert.ok(prompt.positive.includes('【尺度图规则】：仅作为物体、建筑与角色的相对大小和比例尺参考，严格禁止借用其画风、材质或色彩，不影响画面风格'));

  // 执行端到端调用并检查 audit_report
  const settings = new ModelSettings();
  const dir = await mkdtemp(join(tmpdir(), 'audit-test-both-'));
  const terrain = new CompleteTerrainGeneration(settings, {
    storageRoot: dir,
    adapter: {
      async generate() {
        return { bytes: mockFixturePng(), requestId: 'mock-req-both' };
      }
    }
  });

  const result = await terrain.generate(input);
  const audit = result.job.audit_report;
  assert.ok(audit);
  assert.equal(audit.images_meta.count, 2);
  assert.equal(audit.images_meta.details[0].role, 'structure');
  assert.equal(audit.images_meta.details[1].role, 'scale');
  assert.equal(audit.images_meta.details[0].dataUrl, undefined);
  assert.equal(audit.images_meta.details[1].dataUrl, undefined);
  assert.equal(audit.http_meta.status_code, 200);
  assert.equal(audit.stage, 'completed');
});

test('Scenario 4: 千问 2.1 Turbo 兼容性与 negative_prompt 移除', async () => {
  let capturedBody = null;
  const mockFetcher = async (url, options) => {
    if (String(url).includes('sample.png')) {
      return new Response(mockFixturePng(), { status: 200 });
    }
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      request_id: 'test-dashscope-req-123',
      output: {
        choices: [
          { message: { content: [{ image: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/sample.png' }] } }
        ]
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const adapter = new DashScopeAdapter(mockFetcher);
  const config = {
    apiKey: 'fixture-key',
    baseUrl: 'https://dashscope.aliyuncs.com',
    model: 'qwen-image-2.1-turbo',
    size: '1024*1024'
  };
  const prompt = {
    positive: 'This is an RGBA image with transparency.\n主景：小屋。\n避免：3D写实，文字，水印。',
    negative: '3D写实，文字，水印'
  };

  // 模拟下载图片
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('aliyuncs.com')) {
      return new Response(mockFixturePng(), { status: 200 });
    }
    return origFetch(url);
  };

  try {
    const res = await adapter.generate(config, prompt, new AbortController().signal, { mode: 'text_to_image' });
    assert.equal(res.requestId, 'test-dashscope-req-123');
    assert.ok(capturedBody, '成功捕获请求体');
    // 关键校验：在 parameters 中绝无 negative_prompt
    assert.equal(capturedBody.parameters.negative_prompt, undefined);
    assert.equal(capturedBody.parameters.prompt_extend, false);
    assert.equal(capturedBody.parameters.watermark, false);
    // 正向 Prompt 已经包含避免词
    assert.ok(capturedBody.input.messages[0].content[0].text.includes('避免：3D写实'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Scenario 5: Node HTTP 服务支持 >128KB Base64 请求体并始终返回标准 JSON', async () => {
  const { createWorkbenchServer } = await import('../server/index.mjs');
  const storageRoot = await mkdtemp(join(tmpdir(), 'i2i-large-body-'));
  const settings = new ModelSettings({
    LIFE_MAP_TEXT_PROVIDER: 'mock',
    LIFE_MAP_GENERATION_ROUTE: 'native-alpha',
    DASHSCOPE_API_KEY: 'fixture-key',
    LIFE_MAP_IMAGE_SIZE: '512*512'
  });
  const server = await createWorkbenchServer({ storageRoot, settings });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // 建立 session
    const info = await fetch(base + '/api/model-settings');
    const cookie = info.headers.get('set-cookie').split(';')[0];

    // 构造约 500KB 大小的 Base64 图片输入（远超原来的 128KB 限制）
    const largeDummyData = 'data:image/png;base64,' + 'A'.repeat(500 * 1024);
    const input = createSampleInput({
      client_request_id: '99999999-4444-4333-8222-111111111111',
      lab_config: {
        mode: 'image_to_image',
        reference_images: [
          {
            id: 'ref-large-1',
            name: 'large-structure.png',
            role: 'structure',
            dataUrl: largeDummyData,
            sizeBytes: 500 * 1024
          }
        ],
        i2i_rules: DEFAULT_I2I_RULES
      }
    });

    const response = await fetch(base + '/api/terrain/generate', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(input)
    });

    // 关键断言：绝对不应发生服务未返回 JSON 或 413
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes('application/json'));
    const result = await response.json();
    assert.ok(result.job);
    assert.equal(result.job.audit_report.images_meta.count, 1);
    assert.ok(result.job.audit_report.images_meta.estimated_request_payload_bytes > 500 * 1024);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

