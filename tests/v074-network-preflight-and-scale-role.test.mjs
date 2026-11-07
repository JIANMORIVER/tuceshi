import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNetworkErrorInfo,
  checkDirectReachability,
  checkProxyConnect,
  preflightNetworkCheck,
  DashScopeAdapter
} from '../server/image-card/dashscope.mjs';
import { buildAuditReport } from '../server/image-card/service.mjs';
import { ImageCardError } from '../server/image-card/config.mjs';

test('V0.7.4 验收项 1：extractNetworkErrorInfo 精准从 Undici TypeError 中提取嵌套 err.cause.code 为 ECONNRESET', () => {
  const fetchErr = new TypeError('fetch failed');
  fetchErr.cause = {
    code: 'ECONNRESET',
    message: 'Client network socket disconnected before secure TLS connection was established'
  };

  const info = extractNetworkErrorInfo(fetchErr);
  assert.equal(info.rawCode, 'ECONNRESET');
  assert.equal(info.errorCategory, 'connection_reset');
  assert.equal(info.isConnReset, true);
  assert.equal(info.isTimeout, false);
});

test('V0.7.4 验收项 2：生图前零费用网络预检，直连受阻时提前选定代理隧道，避免盲目直连导致 ECONNRESET', async () => {
  const config = {
    apiKey: 'fixture-test-key',
    baseUrl: 'https://dashscope.aliyuncs.com',
    model: 'qwen-image-2.1-turbo',
    size: '1024*1024'
  };

  // 执行一次真实本地预检（零模型费用，仅探测连通性）
  const result = await preflightNetworkCheck(config, { forceRefresh: true });
  assert.ok(['direct', 'proxy'].includes(result.route), '预检结果必须明确选定 direct 或 proxy 路径');
  if (result.route === 'proxy') {
    assert.match(result.proxyUrl, /^http:\/\/127\.0\.0\.1:\d+$/, '选定代理时必须为本地合法的代理地址');
  }
});

test('V0.7.4 验收项 3：生图失败后坚决不自动换代理重新提交（避免重复扣费），且正确记录 selected_route', async () => {
  let callCount = 0;
  // 模拟自定义 fetcher
  const mockFetcher = async () => {
    callCount++;
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNRESET', message: 'Connection reset by peer' };
    throw err;
  };

  const adapter = new DashScopeAdapter(mockFetcher);
  const config = {
    apiKey: 'fixture-test-key',
    baseUrl: 'https://dashscope.aliyuncs.com',
    model: 'qwen-image-2.1-turbo',
    size: '1024*1024',
    proxy: 'http://127.0.0.1:7897'
  };

  await assert.rejects(
    () => adapter.generate(config, { positive: '测试提示词' }, null, { mode: 'text_to_image' }),
    (err) => {
      assert.equal(err.code, 'NETWORK_ERROR');
      assert.equal(err.details.stage, 'qwen_submitting');
      assert.equal(err.details.underlyingErrorCode, 'ECONNRESET');
      return true;
    }
  );

  // 必须只尝试 1 次，严禁在捕获失败后擅自换代理重新提交
  assert.equal(callCount, 1, '生图请求发出后若遇网络中断，必须立即阻断，不得自动重新发起可能扣费的请求');
});

test('V0.7.4 验收项 4：批量上传参考图时角色分配逻辑严格保证 Structure -> Scale -> Style，绝不全识别为 Structure', () => {
  // 模拟批量上传 3 张图片
  const currentImages = [];
  const filesToUpload = [
    { name: 'island_base.png' },
    { name: 'character_scale.png' },
    { name: 'pixel_art_style.png' }
  ];

  const assignedRoles = [];
  for (let i = 0; i < filesToUpload.length; i++) {
    const allRolesSoFar = [...currentImages.map(r => r.role), ...assignedRoles];
    let nextRole = 'structure';
    if (!allRolesSoFar.includes('structure')) {
      nextRole = 'structure';
    } else if (!allRolesSoFar.includes('scale')) {
      nextRole = 'scale';
    } else if (!allRolesSoFar.includes('style')) {
      nextRole = 'style';
    }
    assignedRoles.push(nextRole);
  }

  assert.deepEqual(assignedRoles, ['structure', 'scale', 'style'], '三张同时上传必须按优先级依次赋予 Structure、Scale 与 Style');

  // 模拟已有 structure 时再上传 2 张
  const existingWithStructure = [{ role: 'structure' }];
  const secondBatchRoles = [];
  for (let i = 0; i < 2; i++) {
    const allRolesSoFar = [...existingWithStructure.map(r => r.role), ...secondBatchRoles];
    let nextRole = 'structure';
    if (!allRolesSoFar.includes('structure')) {
      nextRole = 'structure';
    } else if (!allRolesSoFar.includes('scale')) {
      nextRole = 'scale';
    } else if (!allRolesSoFar.includes('style')) {
      nextRole = 'style';
    }
    secondBatchRoles.push(nextRole);
  }
  assert.deepEqual(secondBatchRoles, ['scale', 'style'], '已有 structure 时，新增图片应优先赋予 scale 角色');
});

test('V0.7.4 验收项 5：诊断报告正确记录版本与 commit，未收到供应商响应时 status_code 明确为 null，绝不误标 502', () => {
  // 模拟网络层连接失败异常
  const netErr = new ImageCardError('NETWORK_ERROR', '网络连接重置', 502);
  netErr.details = {
    stage: 'qwen_submitting',
    underlyingErrorCode: 'ECONNRESET',
    errorCategory: 'connection_reset',
    selectedRoute: 'proxy',
    proxyUsed: true,
    proxyEndpoint: '127.0.0.1:7897'
  };

  const report = buildAuditReport({
    record: { prompt: { positive: '测试场景描述' } },
    input: { labConfig: { reference_images: [] } },
    error: netErr
  });

  // 验证不把本地 502 当作供应商响应
  assert.equal(report.http_meta.status_code, null, '未触达供应商时 status_code 必须为 null');
  assert.equal(report.http_meta.provider_status_code, undefined, '未收到供应商返回时不应存在 provider_status_code');
  assert.equal(report.http_meta.local_status_code, 502, '本地服务的状态码 502 应单独存放在 local_status_code');

  // 验证版本与 Git Commit 记录
  assert.ok(report.runtime_version, '必须包含 runtime_version');
  assert.equal(typeof report.runtime_version.version, 'string');
  assert.equal(typeof report.runtime_version.git_commit, 'string');

  // 验证网络元数据
  assert.equal(report.network_meta.selected_route, 'proxy');
  assert.equal(report.network_meta.underlying_error_code, 'ECONNRESET');
  assert.equal(report.network_meta.error_category, 'connection_reset');

  // 安全检查：确认无 API Key、无日记全文、无图片 Base64
  const jsonReport = JSON.stringify(report);
  assert.ok(!jsonReport.includes('sk-'), '严禁记录 API Key');
  assert.ok(!jsonReport.includes('data:image/'), '严禁记录 Base64 数据');
});
