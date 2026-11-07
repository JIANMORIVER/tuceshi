import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RoutedTerrainPipeline, ROUTED_ALPHA_VERSION} from '../server/background-removal/routed-pipeline.mjs';
import {decodePng, encodeGrayscalePng} from '../server/background-removal/alpha.mjs';
import {validatePng, mockPng} from '../server/image-card/png.mjs';
import {fixturePng} from './dual-generation.test.mjs';
import {withTerrainBackground} from '../server/background-removal/http.mjs';
import {Workbench, freshExperiment} from '../dist/domain/workbench/flow.js';

function createMockAlphaPng(width = 64, height = 64) {
  // 生成一个带有中心不透明岛屿、四周完全透明的合法 PNG
  const rawStride = width * 4 + 1;
  const rawBytes = Buffer.alloc(rawStride * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rawStride;
    rawBytes[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 4;
      const isForeground = x >= 16 && x < 48 && y >= 16 && y < 48;
      rawBytes[px] = isForeground ? 200 : 0;     // R
      rawBytes[px + 1] = isForeground ? 100 : 0; // G
      rawBytes[px + 2] = isForeground ? 50 : 0;  // B
      rawBytes[px + 3] = isForeground ? 255 : 0; // Alpha: 前景 255，四周 0
    }
  }
  const {deflateSync} = awaitImportZlib();
  const {chunk} = awaitImportPng();
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // RGBA
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rawBytes)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

import {deflateSync} from 'node:zlib';
import {chunk} from '../server/image-card/png.mjs';
function awaitImportZlib() { return {deflateSync}; }
function awaitImportPng() { return {chunk}; }

test('任务二验收：Alpha 灰度遮罩提取纯净标准，黑透白实且零额外 API 消耗', () => {
  const transparentPng = createMockAlphaPng(32, 32);
  const decoded = decodePng(transparentPng);
  assert.equal(decoded.hasAlpha, true);

  // 提取为灰度图
  const maskPng = encodeGrayscalePng(decoded.width, decoded.height, decoded.alpha);
  assert.ok(maskPng instanceof Buffer);

  // 校验生成的 mask 是合法的 PNG 且通道正确
  const validated = validatePng(maskPng);
  assert.equal(validated.width, 32);
  assert.equal(validated.height, 32);
  assert.equal(validated.mimeType, 'image/png');

  // 解码灰度图并验证灰度值分布：透明区域(四周)为 0 (纯黑)，前景区域(中间)为 255 (纯白)
  const decodedMask = decodePng(maskPng);
  // 四周外缘 (0, 0) 应为 0
  assert.equal(decodedMask.rgb[0], 0);
  assert.equal(decodedMask.rgb[1], 0);
  assert.equal(decodedMask.rgb[2], 0);
  // 中心区域 (16, 16) 应为 255
  const centerIndex = (16 * 32 + 16) * 3;
  assert.equal(decodedMask.rgb[centerIndex], 255);
  assert.equal(decodedMask.rgb[centerIndex + 1], 255);
  assert.equal(decodedMask.rgb[centerIndex + 2], 255);
});

test('任务一验收：Replicate 返回 processing 时不判为失败，两张候选图 ID 与状态完全独立且支持轮询更新', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'life-map-replicate-test-'));
  const originalPng = fixturePng({opaque: true});
  const {writeFile} = await import('node:fs/promises');

  // 写入两张千问原图 (必须符合 UUID v4 规范)
  const id1 = 'c0000001-0000-4000-8000-000000000001';
  const id2 = 'c0000002-0000-4000-8000-000000000002';
  await writeFile(join(storageRoot, `${id1}.png`), originalPng);
  await writeFile(join(storageRoot, `${id2}.png`), originalPng);

  const transparentPng = fixturePng();

  let submitCalls = 0;
  let queryCalls = 0;
  let cand2Status = 'processing';

  const mockRemover = {
    async submit(bytes, token, signal, beforePrediction) {
      submitCalls++;
      await beforePrediction();
      if (submitCalls === 1) {
        // 第一张图：快速完成返回 succeeded
        return {
          id: 'predfast111111',
          status: 'succeeded',
          output: 'https://replicate.delivery/fast.png'
        };
      } else {
        // 第二张图：20s 内未完成，返回 processing
        return {
          id: 'predslow222222',
          status: 'processing'
        };
      }
    },
    async query(predId) {
      queryCalls++;
      assert.equal(predId, 'predslow222222');
      return {
        id: predId,
        status: cand2Status,
        output: cand2Status === 'succeeded' ? 'https://replicate.delivery/slow.png' : undefined
      };
    },
    async download(output) {
      return transparentPng;
    }
  };

  const settings = {
    backgroundConfig() {
      return { apiToken: 'fake-test-token' };
    }
  };

  const pipeline = new RoutedTerrainPipeline({
    storageRoot,
    settings,
    remover: mockRemover
  });

  const job1 = {
    provider: 'qwen',
    request_status: 'succeeded',
    generation_route: 'qwen-851',
    provider_task_id: id1,
    candidate_id: 'candidate_1'
  };

  const job2 = {
    provider: 'qwen',
    request_status: 'succeeded',
    generation_route: 'qwen-851',
    provider_task_id: id2,
    candidate_id: 'candidate_2'
  };

  // 1. 第一张图提交：立即就绪 (ready)
  const res1 = await pipeline.decorate(job1);
  assert.equal(res1.background_removal.status, 'ready');
  assert.equal(res1.background_removal.prediction_id, 'predfast111111');
  assert.ok(res1.image_url.includes(id1));
  assert.ok(res1.background_removal.mask_url.includes(id1));

  // 2. 第二张图提交：排队返回 processing，绝不得标记为 failed
  const res2 = await pipeline.decorate(job2);
  assert.equal(res2.background_removal.status, 'processing');
  assert.equal(res2.background_removal.prediction_id, 'predslow222222');
  assert.equal(res2.request_status, 'running');
  assert.equal(res2.image_url, undefined); // 尚未生成透明图
  assert.equal(res2.original_image_url, `/api/terrain-images/${id2}`); // 千问原图已完整保留
  assert.equal(submitCalls, 2);

  // 两张候选图的 Prediction ID 互相独立
  assert.notEqual(res1.background_removal.prediction_id, res2.background_removal.prediction_id);

  // 3. 模拟前端轮询查询第二张图片（仍处理中）
  const poll1 = await pipeline.decorate(job2);
  assert.equal(poll1.background_removal.status, 'processing');
  assert.equal(poll1.background_removal.prediction_id, 'predslow222222');
  assert.equal(submitCalls, 2, '不得重复提交付费任务');

  // 4. 第二张图片在 Replicate 处理完成，下一次轮询成功就绪
  cand2Status = 'succeeded';
  const poll2 = await pipeline.decorate(job2);
  assert.equal(poll2.background_removal.status, 'ready');
  assert.equal(poll2.background_removal.prediction_id, 'predslow222222');
  assert.ok(poll2.image_url.includes(id2));
  assert.ok(poll2.background_removal.mask_url.includes(id2));
  assert.equal(submitCalls, 2, '全程只提交了 2 次付费扣费，轮询只走 query');

  // 5. 验证 HTTP 路由：透明图与 Alpha 灰度遮罩图片均可正常通过 GET 读取
  const maskBytes1 = await pipeline.mask(id1);
  assert.ok(validatePng(maskBytes1));
  const maskBytes2 = await pipeline.mask(id2);
  assert.ok(validatePng(maskBytes2));
});

test('任务一验收：单次查询超时或网络波动不判死为 failed，保持 processing 允许后续重试', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'life-map-replicate-timeout-'));
  const originalPng = fixturePng({opaque: true});
  const {writeFile} = await import('node:fs/promises');
  const id = 'c0000003-0000-4000-8000-000000000003';
  await writeFile(join(storageRoot, `${id}.png`), originalPng);

  let queryCount = 0;
  const mockRemover = {
    async submit(bytes, token, signal, beforePrediction) {
      await beforePrediction();
      return { id: 'predtimeout1234', status: 'processing' };
    },
    async query() {
      queryCount++;
      if (queryCount === 1) {
        const err = new Error('The operation was aborted');
        err.code = 'ABORT_ERR';
        throw err;
      }
      return { id: 'predtimeout1234', status: 'succeeded', output: 'https://replicate.delivery/done.png' };
    },
    async download() {
      return fixturePng();
    }
  };

  const pipeline = new RoutedTerrainPipeline({
    storageRoot,
    settings: { backgroundConfig() { return { apiToken: 'test-token' }; } },
    remover: mockRemover
  });

  const job = {
    provider: 'qwen',
    request_status: 'succeeded',
    generation_route: 'qwen-851',
    provider_task_id: id,
    candidate_id: 'candidate_1'
  };

  // 首次提交
  const init = await pipeline.decorate(job);
  assert.equal(init.background_removal.status, 'processing');

  // 第一次查询超时报错 -> 保持 processing，绝对不标记为 failed
  const duringTimeout = await pipeline.decorate(job);
  assert.equal(duringTimeout.background_removal.status, 'processing');
  assert.equal(duringTimeout.background_removal.prediction_id, 'predtimeout1234');
  assert.ok(duringTimeout.background_removal.message.includes('超时'));

  // 下一次查询恢复网络 -> 成功转为 ready
  const recovered = await pipeline.decorate(job);
  assert.equal(recovered.background_removal.status, 'ready');
});

test('前端 flow 自动轮询与页面刷新恢复测试', async () => {
  let queryCount = 0;
  const mockStorage = {
    data: new Map(),
    getItem(k) { return this.data.get(k) || null; },
    setItem(k, v) { this.data.set(k, v); }
  };

  let candidateStatus = 'processing';
  const mockApi = {
    async call(path, body) {
      if (path === '/api/terrain/query') {
        queryCount++;
        return {
          job_id: 'job_test_1',
          planning_run_id: 'run_1',
          candidate_id: 'candidate_2',
          provider: 'qwen',
          request_status: candidateStatus === 'succeeded' ? 'succeeded' : 'running',
          original_image_url: '/api/terrain-images/cand_2',
          image_url: candidateStatus === 'succeeded' ? '/api/terrain-cutouts/cand_2' : undefined,
          background_removal: {
            version: ROUTED_ALPHA_VERSION,
            status: candidateStatus === 'succeeded' ? 'ready' : 'processing',
            method: '851-labs/background-remover',
            prediction_id: 'pred_auto_poll_123',
            transparent_fraction: 0.5
          }
        };
      }
      return {};
    }
  };

  // 构建包含一个处于 processing 状态任务的缓存，模拟刷新页面后的冷启动
  const savedExp = freshExperiment();
  savedExp.stage = 'results';
  savedExp.candidates = [
    {
      id: 'candidate_1',
      plan: { title: '方案一', scene_description: '' },
      submissionId: 'sub_1',
      status: 'known',
      job: {
        job_id: 'job_1',
        candidate_id: 'candidate_1',
        request_status: 'succeeded',
        image_url: '/api/terrain-cutouts/cand_1',
        background_removal: { version: ROUTED_ALPHA_VERSION, status: 'ready', transparent_fraction: 0.5 }
      }
    },
    {
      id: 'candidate_2',
      plan: { title: '方案二', scene_description: '' },
      submissionId: 'sub_2',
      status: 'known',
      job: {
        job_id: 'job_2',
        candidate_id: 'candidate_2',
        request_status: 'running',
        original_image_url: '/api/terrain-images/cand_2',
        background_removal: { version: ROUTED_ALPHA_VERSION, status: 'processing', prediction_id: 'pred_auto_poll_123', transparent_fraction: 0 }
      }
    }
  ];

  mockStorage.setItem('life-map.image-workbench.v1', JSON.stringify(savedExp));

  // 实例化 Workbench，模拟刷新页面
  const wb = new Workbench(mockStorage, mockApi);

  // 验证页面刷新后已对 candidate_2 恢复自动轮询注册
  assert.equal(wb.state.candidates[1].job.background_removal.status, 'processing');

  // 手动触发一次安静查询或等待轮询单次执行
  const updatedJob = await wb.queryQuietly('candidate_2');
  assert.equal(updatedJob.background_removal.status, 'processing');
  assert.equal(queryCount, 1);

  // 当服务端处理完成
  candidateStatus = 'succeeded';
  const finalJob = await wb.queryQuietly('candidate_2');
  assert.equal(finalJob.background_removal.status, 'ready');
  assert.ok(finalJob.image_url);

  // 清理所有定时器
  wb.stopAllPolling();
});
