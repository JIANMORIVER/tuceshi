import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DashScopeAdapter,
  classifyNetworkError,
  createTunneledFetch
} from '../server/image-card/dashscope.mjs';
import { buildAuditReport } from '../server/image-card/service.mjs';
import { ImageCardError } from '../server/image-card/config.mjs';

test('V0.7.2 验收项 1：classifyNetworkError 精准识别 DNS 解析异常 (dns_failure)', () => {
  const dnsErr = new Error('getaddrinfo ENOTFOUND dashscope.aliyuncs.com');
  dnsErr.code = 'ENOTFOUND';
  const classified = classifyNetworkError(dnsErr, null, 15, { baseUrl: 'https://dashscope.aliyuncs.com' });

  assert.equal(classified.code, 'NETWORK_ERROR');
  assert.equal(classified.details.errorCategory, 'dns_failure');
  assert.equal(classified.details.underlyingErrorCode, 'ENOTFOUND');
  assert.equal(classified.details.targetHost, 'dashscope.aliyuncs.com');
  assert.equal(classified.details.stage, 'qwen_submitting');
  assert.equal(classified.details.elapsedMs, 15);
  // 严禁包含敏感 key
  assert.doesNotMatch(JSON.stringify(classified.details), /apiKey|Bearer/i);
});

test('V0.7.2 验收项 2：classifyNetworkError 精准识别连接重置异常 (connection_reset)', () => {
  const resetErr = new Error('Client network socket disconnected before secure TLS connection was established');
  resetErr.code = 'ECONNRESET';
  const classified = classifyNetworkError(resetErr, null, 250, { baseUrl: 'https://dashscope.aliyuncs.com' });

  assert.equal(classified.details.errorCategory, 'connection_reset');
  assert.equal(classified.details.underlyingErrorCode, 'ECONNRESET');
  assert.equal(classified.details.elapsedMs, 250);
});

test('V0.7.2 验收项 3：classifyNetworkError 精准识别网络超时异常 (timeout)', () => {
  const controller = new AbortController();
  controller.abort(new Error('The operation was aborted due to timeout'));
  const timeoutErr = new Error('socket timeout');
  timeoutErr.code = 'ETIMEDOUT';
  const classified = classifyNetworkError(timeoutErr, controller.signal, 120000, { baseUrl: 'https://dashscope.aliyuncs.com' });

  assert.equal(classified.details.errorCategory, 'timeout');
  assert.equal(classified.details.elapsedMs, 120000);
});

test('V0.7.2 验收项 4：classifyNetworkError 精准识别代理连接异常 (proxy_error)', () => {
  const proxyErr = new Error('Proxy CONNECT 隧道建立失败，状态码: 502');
  proxyErr.code = 'PROXY_CONNECT_FAILED';
  const classified = classifyNetworkError(proxyErr, null, 30, { baseUrl: 'https://dashscope.aliyuncs.com' }, true, 'http://127.0.0.1:7897');

  assert.equal(classified.details.errorCategory, 'proxy_error');
  assert.equal(classified.details.proxyUsed, true);
  assert.equal(classified.details.proxyEndpoint, '127.0.0.1:7897');
});

test('V0.7.2 验收项 5：buildAuditReport 完整包含 network_meta，且绝不泄露 API Key 与 Base64', () => {
  const mockError = new ImageCardError('NETWORK_ERROR', '连接断开', 502, {
    stage: 'qwen_submitting',
    underlyingErrorCode: 'ECONNRESET',
    errorCategory: 'connection_reset',
    elapsedMs: 310,
    targetHost: 'dashscope.aliyuncs.com',
    proxyUsed: true,
    proxyEndpoint: '127.0.0.1:7897'
  });

  const report = buildAuditReport({
    record: { prompt: { positive: '正面提示词' } },
    input: {
      labConfig: {
        reference_images: [
          { id: '1', name: 'img1.png', role: 'structure', dataUrl: 'data:image/png;base64,' + 'A'.repeat(50000), sizeBytes: 37500 },
          { id: '2', name: 'img2.png', role: 'scale', dataUrl: 'data:image/png;base64,' + 'B'.repeat(50000), sizeBytes: 37500 },
          { id: '3', name: 'img3.png', role: 'style', dataUrl: 'data:image/png;base64,' + 'C'.repeat(50000), sizeBytes: 37500 }
        ]
      }
    },
    error: mockError
  });

  assert.ok(report.network_meta);
  assert.equal(report.network_meta.underlying_error_code, 'ECONNRESET');
  assert.equal(report.network_meta.error_category, 'connection_reset');
  assert.equal(report.network_meta.stage, 'qwen_submitting');
  assert.equal(report.network_meta.elapsed_ms, 310);
  assert.equal(report.network_meta.proxy_used, true);
  assert.equal(report.network_meta.proxy_endpoint, '127.0.0.1:7897');
  assert.equal(report.images_meta.count, 3);
  assert.ok(report.images_meta.estimated_request_payload_bytes > 100000);

  // 严禁泄露密钥与全量 Base64
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /sk-[a-zA-Z0-9]{20,}/);
  assert.doesNotMatch(serialized, /data:image\/png;base64,A{10,}/);
});

test('V0.7.2 验收项 6：三张参考图正确组装入 messages content 且角色分离', async () => {
  let capturedBody = null;
  const mockFetcher = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: (async function* () {
        yield Buffer.from(JSON.stringify({
          request_id: 'test-req-123',
          output: { choices: [{ message: { content: [{ image: 'https://dashscope-result.aliyuncs.com/file.png' }] } }] }
        }));
      })()
    };
  };

  const adapter = new DashScopeAdapter(mockFetcher);
  const config = {
    apiKey: 'mock-key',
    baseUrl: 'https://dashscope.aliyuncs.com',
    model: 'qwen-image-2.1-turbo',
    size: '1024*1024'
  };

  const refImages = [
    { id: 'ref-1', name: 'structure.png', role: 'structure', dataUrl: 'data:image/png;base64,AAA' },
    { id: 'ref-2', name: 'scale.png', role: 'scale', dataUrl: 'data:image/png;base64,BBB' },
    { id: 'ref-3', name: 'style.png', role: 'style', dataUrl: 'data:image/png;base64,CCC' }
  ];

  // 模拟图片下载
  const downloadFetcher = async () => ({
    ok: true,
    headers: new Headers({ 'content-length': '10' }),
    body: (async function* () { yield Buffer.from('mockpngbytes'); })()
  });
  adapter.fetcher = async (url, options) => {
    if (url.includes('/generation')) return mockFetcher(url, options);
    return downloadFetcher();
  };

  await adapter.generate(config, { positive: '场景提示词' }, new AbortController().signal, {
    mode: 'image_to_image',
    referenceImages: refImages
  });

  assert.ok(capturedBody);
  const contents = capturedBody.input.messages[0].content;
  // 3 张参考图 + 1 个文本
  assert.equal(contents.length, 4);
  assert.equal(contents[0].image, 'data:image/png;base64,AAA');
  assert.equal(contents[1].image, 'data:image/png;base64,BBB');
  assert.equal(contents[2].image, 'data:image/png;base64,CCC');
  assert.equal(contents[3].text, '场景提示词');
  // 验证不传递 negative_prompt 参数
  assert.equal(capturedBody.parameters.negative_prompt, undefined);
});
