import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  exportDiaryInputSnapshot,
  validateAndParseDiarySnapshot,
  DIARY_INPUT_SCHEMA_VERSION
} from '../dist/domain/domain/diary-snapshot.js';
import { Workbench } from '../dist/domain/workbench/flow.js';
import { ArchiveService, ARCHIVE_SCHEMA_VERSION } from '../server/archive/service.mjs';
import { createZip, parseZip } from '../server/archive/zip.mjs';
import { createArchiveHandler } from '../server/archive/http.mjs';

function createMockStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => map.set(k, String(v))
  };
}

test('功能 A1：日记输入快照导出内容纯净，且包含独立的 schema_version', () => {
  const snapshot = exportDiaryInputSnapshot({
    date: '2026-11-01',
    notes: ['今天在海边散步，吹着海风喝了一杯咖啡。', '下午重构了几个模块的代码。'],
    focuses: [
      {
        event_id: 'focus_coffee',
        title: '海边咖啡小憩',
        summary: '海边喝咖啡',
        focus_kind: 'event',
        evidence: '吹着海风喝了一杯咖啡',
        related_fact_ids: [],
        event_type: 'activity',
        suggested_priority: 1,
        visual_cue_hint: '白色的咖啡杯'
      },
      {
        event_id: 'focus_dev',
        title: '代码重构攻坚',
        summary: '重构代码',
        focus_kind: 'event',
        evidence: '下午重构了几个模块的代码',
        related_fact_ids: [],
        event_type: 'activity',
        suggested_priority: 1,
        visual_cue_hint: '键盘和显示屏'
      }
    ],
    focusIds: ['focus_coffee'],
    answers: [
      {
        question_id: 'q1',
        target_event_id: 'focus_coffee',
        question_text: '咖啡杯是什么样子的？',
        final_answer: '复古陶瓷杯，冒着热气',
        answered_at: new Date().toISOString()
      }
    ],
    extra: '希望阳光是温暖的橙黄色。'
  });

  // 1. 独立 schema_version
  assert.equal(snapshot.schema_version, 'diary-input-v1');
  assert.equal(snapshot.diary_date, '2026-11-01');
  assert.equal(snapshot.notes.length, 2);

  // 2. 仅包含选中的 1 项重点
  assert.equal(snapshot.selected_focuses.length, 1);
  assert.equal(snapshot.selected_focuses[0].event_id, 'focus_coffee');
  assert.equal(snapshot.selected_focuses[0].evidence, '吹着海风喝了一杯咖啡');

  // 3. 追问与补充
  assert.equal(snapshot.supplemental_answers.length, 1);
  assert.equal(snapshot.supplemental_answers[0].final_answer, '复古陶瓷杯，冒着热气');
  assert.equal(snapshot.extra_detail, '希望阳光是温暖的橙黄色。');

  // 4. 纯净性保证：不得包含生图 Prompt、图片、模型分析结果或 API 密钥
  const rawJson = JSON.stringify(snapshot);
  assert.ok(!rawJson.includes('prompt'));
  assert.ok(!rawJson.includes('image_url'));
  assert.ok(!rawJson.includes('apiKey'));
  assert.ok(!rawJson.includes('envelope'));
});

test('功能 A2 & A3：快照校验与导入能够独立构建合法的生图上下文，且无需 analysis', () => {
  const validJson = JSON.stringify({
    schema_version: 'diary-input-v1',
    diary_case_id: 'case_test_001',
    diary_date: '2026-11-02',
    notes: ['早晨在阳台给绿植浇水，发现开了两朵黄色小花。'],
    selected_focuses: [
      {
        event_id: 'focus_plants',
        title: '阳台绿植浇水',
        focus_kind: 'event',
        evidence: '给绿植浇水，发现开了两朵黄色小花'
      }
    ],
    supplemental_answers: [
      {
        question_id: 'q_flower',
        target_event_id: 'focus_plants',
        question_text: '花盆是什么形状的？',
        final_answer: '红陶圆形小盆'
      }
    ],
    extra_detail: '背景能看到清晨的朝霞。'
  });

  const parsed = validateAndParseDiarySnapshot(validJson);
  assert.equal(parsed.schema_version, 'diary-input-v1');
  assert.equal(parsed.selected_focuses[0].title, '阳台绿植浇水');

  // 格式异常校验
  assert.throws(() => validateAndParseDiarySnapshot('invalid json'), /不是合法的 JSON/);
  assert.throws(() => validateAndParseDiarySnapshot(JSON.stringify({ schema_version: 'v0.2.0' })), /不支持的日记快照版本/);
  assert.throws(() => validateAndParseDiarySnapshot(JSON.stringify({ schema_version: 'diary-input-v1', notes: [] })), /未包含有效的日记便签内容/);
  assert.throws(() => validateAndParseDiarySnapshot(JSON.stringify({ schema_version: 'diary-input-v1', notes: ['有便签'], selected_focuses: [] })), /缺少确认的重点事项列表/);

  // 导入进 Workbench
  const storage = createMockStorage();
  const flow = new Workbench(storage, { call: async () => ({}) });
  const oldId = flow.state.id;

  flow.importDiarySnapshot(validJson);

  // 1. 分配了新实验 ID
  assert.notEqual(flow.state.id, oldId);
  // 2. 还原了便签、重点与追问回答
  assert.equal(flow.state.notes[0], '早晨在阳台给绿植浇水，发现开了两朵黄色小花。');
  assert.equal(flow.state.focusIds.length, 1);
  assert.equal(flow.state.focusIds[0], 'focus_plants');
  assert.equal(flow.state.answers['q_flower']?.text, '红陶圆形小盆');
  assert.equal(flow.state.extra, '背景能看到清晨的朝霞。');
  // 3. 跳过分析与追问，直接进入生图准备 stage: 'inquiry'
  assert.equal(flow.state.stage, 'inquiry');
  // 4. analysis 保持 undefined，不伪造旧版模型分析结果
  assert.equal(flow.state.analysis, undefined);

  // 5. 解耦验证：调用 flow.exportDiarySnapshot 正常工作
  const exported = flow.exportDiarySnapshot();
  assert.ok(exported.includes('diary-input-v1'));
  assert.ok(exported.includes('阳台绿植浇水'));
});

test('纯 Node.js ZIP 打包与解压模块完整性测试', () => {
  const files = [
    { name: 'hello.txt', data: Buffer.from('Hello Life Map Archive!', 'utf8') },
    { name: 'nested/folder/data.json', data: Buffer.from(JSON.stringify({ ok: true, version: 1 }), 'utf8') }
  ];

  const zipBuffer = createZip(files);
  assert.ok(zipBuffer.length > 50, 'ZIP buffer generated');

  const parsed = parseZip(zipBuffer);
  assert.equal(parsed.length, 2);

  const f1 = parsed.find(f => f.name === 'hello.txt');
  assert.ok(f1);
  assert.equal(f1.data.toString('utf8'), 'Hello Life Map Archive!');

  const f2 = parsed.find(f => f.name === 'nested/folder/data.json');
  assert.ok(f2);
  const json = JSON.parse(f2.data.toString('utf8'));
  assert.equal(json.ok, true);
  assert.equal(json.version, 1);
});

test('功能 B：本地实验数据库 ArchiveService 持久化、原子写入、多维过滤与 ZIP 导出导入', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'archive-test-'));
  try {
    const archive = new ArchiveService({ storageRoot: tmpRoot });

    // 1. 保存实验记录
    const run1 = {
      experiment_id: 'exp_test_001',
      created_at: '2026-11-01T10:00:00.000Z',
      experiment_mode: 'text_to_image',
      status: 'completed',
      diary_case: {
        diary_case_id: 'case_001',
        diary_date: '2026-11-01',
        notes: ['测试日记便签内容'],
        focuses: [{ event_id: 'f1', title: '散步' }]
      },
      style_package: {
        style_id: 'preset-gentle-pixel',
        name: '温柔清爽纯像素'
      },
      candidates: [
        {
          id: 'candidate_1',
          status: 'known',
          prompt: '2D isometric pixel island',
          original_image_url: '/api/terrain-images/art_001',
          image_url: '/api/terrain-cutouts/art_001',
          review_status: 'approved',
          is_selected: true
        }
      ]
    };

    const run2 = {
      experiment_id: 'exp_test_002',
      created_at: '2026-11-01T11:00:00.000Z',
      experiment_mode: 'image_to_image',
      status: 'pending',
      style_package: {
        style_id: 'preset-golden-dusk',
        name: '落日余晖像素'
      },
      candidates: []
    };

    await archive.saveRun(run1);
    await archive.saveRun(run2);

    // 2. 读取实验
    const fetched = await archive.getRun('exp_test_001');
    assert.equal(fetched.experiment_id, 'exp_test_001');
    assert.equal(fetched.schema_version, ARCHIVE_SCHEMA_VERSION);
    assert.equal(fetched.candidates[0].review_status, 'approved');

    // 3. 过滤查询
    const all = await archive.listRuns();
    assert.equal(all.length, 2);

    const t2iList = await archive.listRuns({ mode: 'text_to_image' });
    assert.equal(t2iList.length, 1);
    assert.equal(t2iList[0].experiment_id, 'exp_test_001');

    const duskList = await archive.listRuns({ style_id: 'preset-golden-dusk' });
    assert.equal(duskList.length, 1);
    assert.equal(duskList[0].experiment_id, 'exp_test_002');

    // 4. 导出 ZIP
    const zip = await archive.exportZip('exp_test_001');
    assert.ok(zip.length > 50);
    const parsedZip = parseZip(zip);
    const meta = parsedZip.find(f => f.name === 'experiment-run.json');
    assert.ok(meta);
    const parsedMeta = JSON.parse(meta.data.toString('utf8'));
    assert.equal(parsedMeta.experiment_id, 'exp_test_001');

    // 5. 导入 ZIP 到另一个独立档案馆实例
    const tmpRoot2 = await mkdtemp(join(tmpdir(), 'archive-test2-'));
    try {
      const archive2 = new ArchiveService({ storageRoot: tmpRoot2 });
      const imported = await archive2.importZip(zip);
      assert.equal(imported.experiment_id, 'exp_test_001');

      const restored = await archive2.getRun('exp_test_001');
      assert.ok(restored);
      assert.equal(restored.experiment_id, 'exp_test_001');
    } finally {
      await rm(tmpRoot2, { recursive: true, force: true });
    }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('HTTP 路由：/api/archive/* 接口功能测试', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'archive-http-'));
  try {
    const archive = new ArchiveService({ storageRoot: tmpRoot });
    const handler = createArchiveHandler({ archive });

    // 1. POST /api/archive/runs 保存
    const runData = {
      experiment_id: 'exp_http_001',
      created_at: new Date().toISOString(),
      experiment_mode: 'text_to_image',
      status: 'completed',
      candidates: []
    };

    let resData = '';
    let resStatus = 0;
    const fakeRes = {
      writeHead(status, headers) { resStatus = status; },
      end(chunk) { if (chunk) resData += chunk; }
    };

    // 模拟 POST 请求
    const fakeReq = (async function* () {
      yield Buffer.from(JSON.stringify(runData), 'utf8');
    })();
    fakeReq.method = 'POST';
    fakeReq.url = '/api/archive/runs';

    const handled = await handler(fakeReq, fakeRes);
    assert.equal(handled, true);
    assert.equal(resStatus, 200);
    const saved = JSON.parse(resData);
    assert.equal(saved.experiment_id, 'exp_http_001');

    // 2. GET /api/archive/runs 列表
    let listData = '';
    const listRes = {
      writeHead(status) { resStatus = status; },
      end(chunk) { if (chunk) listData += chunk; }
    };
    const listReq = { method: 'GET', url: '/api/archive/runs' };
    await handler(listReq, listRes);
    assert.equal(resStatus, 200);
    const listResult = JSON.parse(listData);
    assert.equal(listResult.runs.length, 1);
    assert.equal(listResult.runs[0].experiment_id, 'exp_http_001');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('功能 A4 & B3：快照导入保留已有 provider、pipeline 与图生图 lab 配置', () => {
  const storage = createMockStorage();
  const flow = new Workbench(storage, { call: async () => ({}) });

  // 1. 设置在线配置与图生图模式
  flow.syncModelSettings({
    textProvider: 'deepseek',
    deepseek: { model: 'deepseek-chat', apiConfigured: true },
    qwen: { model: 'qwen-plus', apiConfigured: true },
    image: { model: 'qwen-image-2.0' },
    generationRoute: 'qwen-851',
    nativeImageModel: 'qwen-image-2.1-turbo',
    secretLifetime: 'server-session-only',
    pipeline: 'isometric-image-card-v1'
  });
  flow.setLab({
    mode: 'image_to_image',
    selectedStyleId: 'custom-style-xyz',
    referenceImages: [{ id: 'ref1', name: 'structure.png', role: 'structure', dataUrl: 'data:image/png;base64,mock' }]
  });

  assert.equal(flow.state.provider, 'deepseek');
  assert.equal(flow.state.pipeline.route, 'qwen-851');
  assert.equal(flow.state.lab.mode, 'image_to_image');

  // 2. 导入日记快照
  const validJson = JSON.stringify({
    schema_version: 'diary-input-v1',
    diary_date: '2026-11-03',
    notes: ['测试日记便签'],
    selected_focuses: [{ event_id: 'f1', title: '散步', focus_kind: 'event', evidence: '散步' }],
    supplemental_answers: []
  });

  flow.importDiarySnapshot(validJson);

  // 3. 验证保留了 provider、pipeline 和 lab 配置，没有被粗暴重置为离线 mock
  assert.equal(flow.state.provider, 'deepseek');
  assert.equal(flow.state.pipeline.route, 'qwen-851');
  assert.equal(flow.state.lab.mode, 'image_to_image');
  assert.equal(flow.state.lab.selectedStyleId, 'custom-style-xyz');
  assert.equal(flow.state.lab.referenceImages.length, 1);
});

test('功能 B4：导出 ZIP 包完整包含原始参考底图与图生图规则点文件', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'archive-i2i-zip-'));
  try {
    const archive = new ArchiveService({ storageRoot: tmpRoot });

    const runData = {
      experiment_id: 'exp_i2i_pack',
      created_at: new Date().toISOString(),
      experiment_mode: 'image_to_image',
      status: 'completed',
      reference_images: [
        {
          id: 'ref-base-1',
          name: 'island_base.png',
          role: 'structure',
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        }
      ],
      i2i_rules: {
        roleInstructions: '底图作为核心骨架',
        preservationRules: '保留等距视角',
        variationRules: '允许变化色彩',
        prohibitions: '严禁生成文字'
      },
      candidates: []
    };

    await archive.saveRun(runData);

    const zipBuffer = await archive.exportZip('exp_i2i_pack');
    const parsed = parseZip(zipBuffer);

    // 1. 验证 references/ 目录包含底图
    const refFile = parsed.find(f => f.name.startsWith('references/'));
    assert.ok(refFile, 'references folder exists in zip');
    assert.ok(refFile.name.includes('structure'));
    assert.ok(refFile.name.includes('island_base'));

    // 2. 验证包含 i2i-rules.txt 与 i2i-rules.json
    const rulesTxt = parsed.find(f => f.name === 'i2i-rules.txt');
    assert.ok(rulesTxt, 'i2i-rules.txt exists in zip');
    const content = rulesTxt.data.toString('utf8');
    assert.ok(content.includes('【B. 严格保留规则】'));
    assert.ok(content.includes('保留等距视角'));
    assert.ok(content.includes('island_base.png'));

    const rulesJson = parsed.find(f => f.name === 'i2i-rules.json');
    assert.ok(rulesJson, 'i2i-rules.json exists in zip');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
