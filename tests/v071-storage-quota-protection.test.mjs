import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuotaExceededError,
  dehydrateExperiment,
  rehydrateExperiment,
  SafeWorkbenchStorage,
  saveWorkbenchBlob,
  getWorkbenchBlob
} from '../dist/domain/domain/workbench-storage.js';
import { Workbench, STORAGE_KEY } from '../dist/domain/workbench/flow.js';
import { interpretLifeEntry } from '../dist/domain/services/life-interpretation-service.js';

function createMockStorage(options = {}) {
  const store = new Map();
  let quotaCount = options.quotaUntilSuccess || 0;

  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => {
      if (options.alwaysFail) {
        throw new Error('Disk full or persistent storage failure');
      }
      if (quotaCount > 0) {
        quotaCount--;
        const err = new Error('Failed to execute setItem on Storage: exceeded the quota.');
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
      if (options.quotaIfLarge && value.length > 5000) {
        const err = new Error('Failed to execute setItem on Storage: Setting the value exceeded the quota.');
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
      store.set(key, value);
    },
    removeItem: (key) => store.delete(key),
    get store() {
      return store;
    }
  };
}

test('V0.7.1 验收项 1：isQuotaExceededError 精确匹配主流浏览器的配额超限异常特征', () => {
  // Chrome / Edge
  assert.equal(isQuotaExceededError({ name: 'QuotaExceededError', code: 22 }), true);
  // Firefox
  assert.equal(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED', code: 1014 }), true);
  // 消息包含 quota 或 exceeded
  assert.equal(isQuotaExceededError(new Error('Setting the value of key exceeded the quota.')), true);
  assert.equal(isQuotaExceededError({ message: 'The quota has been exceeded' }), true);
  // 非配额错误
  assert.equal(isQuotaExceededError(new Error('Network error')), false);
  assert.equal(isQuotaExceededError(null), false);
  assert.equal(isQuotaExceededError(undefined), false);
  assert.equal(isQuotaExceededError({ name: 'TypeError' }), false);
});

test('V0.7.1 验收项 2：dehydrateExperiment 正确脱水超大 Base64 参考图并保留精简元数据', () => {
  const largeBase64 = 'data:image/png;base64,' + 'A'.repeat(50000);
  const smallBase64 = 'data:image/png;base64,' + 'B'.repeat(500);

  const mockExp = {
    version: 1,
    id: 'exp-test-01',
    date: '2026-11-07',
    stage: 'write',
    notes: ['今天完成了实验台升级。'],
    answers: {},
    extra: '',
    candidates: [],
    lab: {
      mode: 'image_to_image',
      selectedStyleId: 'preset-gentle-pixel',
      referenceImages: [
        {
          id: 'ref-large-1',
          name: 'structure.png',
          role: 'structure',
          dataUrl: largeBase64,
          sizeBytes: 50000,
          updatedAt: Date.now()
        },
        {
          id: 'ref-small-2',
          name: 'scale.png',
          role: 'scale',
          dataUrl: smallBase64,
          sizeBytes: 500,
          updatedAt: Date.now()
        }
      ]
    }
  };

  const { dehydrated, largeBlobs } = dehydrateExperiment(mockExp);

  // 大图被脱水，小图保持原样
  assert.equal(largeBlobs.length, 1);
  assert.equal(largeBlobs[0].id, 'ref-large-1');
  assert.equal(largeBlobs[0].dataUrl, largeBase64);

  const dehydratedImages = dehydrated.lab.referenceImages;
  assert.equal(dehydratedImages[0].dataUrl, 'idb://ref-large-1');
  assert.equal(dehydratedImages[1].dataUrl, smallBase64);

  // 原始对象未被污染改变
  assert.equal(mockExp.lab.referenceImages[0].dataUrl, largeBase64);
});

test('V0.7.1 验收项 3：rehydrateExperiment 异步从资产存储中恢复完整 Base64 图片', async () => {
  const blobId = 'ref-blob-restore-01';
  const originalDataUrl = 'data:image/png;base64,ORIGINAL_IMAGE_DATA_RESTORE_TEST';

  await saveWorkbenchBlob(blobId, originalDataUrl);
  const fetched = await getWorkbenchBlob(blobId);
  assert.equal(fetched, originalDataUrl);

  const dehydratedExp = {
    version: 1,
    id: 'exp-restore-test',
    date: '2026-11-07',
    stage: 'write',
    notes: [],
    answers: {},
    extra: '',
    candidates: [],
    lab: {
      mode: 'image_to_image',
      selectedStyleId: 'preset-gentle-pixel',
      referenceImages: [
        {
          id: blobId,
          name: 'structure.png',
          role: 'structure',
          dataUrl: `idb://${blobId}`,
          sizeBytes: 1234,
          updatedAt: Date.now()
        }
      ]
    }
  };

  const restored = await rehydrateExperiment(dehydratedExp);
  assert.equal(restored.lab.referenceImages[0].dataUrl, originalDataUrl);
});

test('V0.7.1 验收项 4：SafeWorkbenchStorage 捕获 QuotaExceededError 并通过脱水成功存入', () => {
  // 设置当内容超过 5000 字符时抛出 QuotaExceededError
  const rawStorage = createMockStorage({ quotaIfLarge: true });
  const safeStorage = new SafeWorkbenchStorage(rawStorage);

  const largeBase64 = 'data:image/png;base64,' + 'X'.repeat(60000);
  const expWithLargeImage = {
    version: 1,
    id: 'exp-quota-test',
    date: '2026-11-07',
    stage: 'write',
    notes: ['测试超大图片配额超限保护。'],
    answers: {},
    extra: '',
    candidates: [],
    lab: {
      mode: 'image_to_image',
      selectedStyleId: 'preset-gentle-pixel',
      referenceImages: [
        {
          id: 'ref-big-image',
          name: 'structure.png',
          role: 'structure',
          dataUrl: largeBase64,
          sizeBytes: 60000,
          updatedAt: Date.now()
        }
      ]
    }
  };

  const payload = JSON.stringify(expWithLargeImage);
  assert.ok(payload.length > 5000);

  // 原生 storage 写入超限报错
  assert.throws(() => rawStorage.setItem('test-key', payload), /exceeded the quota/);

  // safeStorage 写入：捕获配额超限，自动脱水，脱水后的紧凑 JSON 成功写入底层 storage
  assert.doesNotThrow(() => safeStorage.setItem('test-key', payload));

  const savedRaw = rawStorage.getItem('test-key');
  assert.ok(savedRaw !== null);
  const parsedSaved = JSON.parse(savedRaw);
  assert.equal(parsedSaved.lab.referenceImages[0].dataUrl, 'idb://ref-big-image');
});

test('V0.7.1 验收项 5：Workbench 支持对未发出的 unknown 候选方案执行 retrySubmit 安全重试', async () => {
  const storage = createMockStorage();
  const calls = [];
  const api = {
    async call(path, body) {
      calls.push({ path, body });
      if (path === '/api/model-settings') {
        return { textProvider: 'mock', image: { model: 'qwen-image-2.0' }, generationRoute: 'native-alpha', nativeImageModel: 'qwen-image-2.1-turbo' };
      }
      if (path === '/api/diary/interpret') {
        return interpretLifeEntry(body.input, { provider: 'mock' });
      }
      if (path === '/api/terrain/generate') {
        return {
          job: {
            job_id: 'terrain:' + body.client_request_id,
            provider: 'mock',
            request_status: 'succeeded',
            provider_task_id: body.client_request_id,
            image_url: '/fixture.png'
          }
        };
      }
      assert.fail(path);
    }
  };

  const workbench = new Workbench(storage, api);
  workbench.edit({ notes: ['日记内容：今天测试生图重试。'] });
  await workbench.analyze();
  await workbench.inquire();
  await workbench.generate();

  assert.equal(workbench.state.stage, 'results');
  assert.equal(workbench.state.candidates.length, 2);

  // 模拟某候选因外部存储突发中断导致处于 unknown 状态（无 job 关联）
  const candidateId = 'candidate_1';
  workbench.patchCandidate(candidateId, { status: 'unknown', job: undefined });
  assert.equal(workbench.state.candidates[0].status, 'unknown');

  const prevCallsCount = calls.filter(c => c.path === '/api/terrain/generate').length;

  // 调用 retrySubmit 重新安全提交
  await workbench.retrySubmit(candidateId);

  // 验证重新发起了生图请求，并且该候选方案成功恢复为 known 状态
  const newCallsCount = calls.filter(c => c.path === '/api/terrain/generate').length;
  assert.equal(newCallsCount, prevCallsCount + 1);
  assert.equal(workbench.state.candidates[0].status, 'known');
  assert.equal(workbench.state.candidates[0].job.request_status, 'succeeded');
});

test('V0.7.1 验收项 6：持久化底层真正损坏时如实阻断生图，维持数据一致性安全契约', async () => {
  const badStorage = createMockStorage();
  const generateCalls = [];
  const workbench = new Workbench(badStorage, {
    async call(path, body) {
      if (path === '/api/model-settings') {
        return { textProvider: 'mock', image: { model: 'qwen-image-2.0' }, generationRoute: 'native-alpha', nativeImageModel: 'qwen-image-2.1-turbo' };
      }
      if (path === '/api/diary/interpret') {
        return interpretLifeEntry(body.input, { provider: 'mock' });
      }
      if (path === '/api/terrain/generate') {
        generateCalls.push(body);
        return { job: { job_id: 'mock', request_status: 'succeeded' } };
      }
      assert.fail(path);
    }
  });

  workbench.edit({ notes: ['测试存储完全不可用时的安全阻断'] });
  await workbench.analyze();
  await workbench.inquire();

  // 模拟即将生图时持久化介质发生致命损坏（如磁盘完全故障或不可恢复的严重异常）
  badStorage.setItem = () => {
    throw new Error('Disk full or persistent storage failure');
  };

  // 尝试生图，因底层存储抛出持久化不可用错误，安全阻断且绝不调用生图接口
  await workbench.generate();
  assert.match(workbench.error, /Disk full|storage failure/i);
  assert.equal(generateCalls.length, 0);
  assert.equal(workbench.state.stage, 'inquiry');
});
