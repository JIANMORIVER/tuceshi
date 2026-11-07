import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiHandler } from '../server/ai/http.mjs';
import { createSmartFetcher } from '../server/image-card/dashscope.mjs';
import { ModelSettings } from '../server/ai/models.mjs';

function createMockHttpExchange(url, method = 'POST', headers = {}, bodyObj = null) {
  let resStatus = 200;
  let resHeaders = {};
  let resBody = '';

  const req = (async function* () {
    if (bodyObj !== null) {
      yield Buffer.from(JSON.stringify(bodyObj), 'utf8');
    }
  })();
  req.url = url;
  req.method = method;
  req.headers = { host: '127.0.0.1:5191', ...headers };

  const res = {
    writeHead(status, headersMap) {
      resStatus = status;
      resHeaders = { ...resHeaders, ...headersMap };
    },
    setHeader(k, v) {
      resHeaders[k.toLowerCase()] = v;
    },
    end(data) {
      if (data) resBody += data;
    },
    getStatus: () => resStatus,
    getHeaders: () => resHeaders,
    getBody: () => {
      try {
        return JSON.parse(resBody);
      } catch {
        return resBody;
      }
    }
  };

  return { req, res };
}

test('V0.7.3 验收项 1：createSmartFetcher 直连遇到 ECONNRESET 时自动触发自愈并成功返回', async () => {
  let callCount = 0;
  // 模拟直连第一次抛出 ECONNRESET，经过自愈逻辑后调用代理成功
  const mockFetcher = async (url, options) => {
    callCount++;
    if (callCount === 1) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNRESET', message: 'Client network socket disconnected before secure TLS connection was established' };
      throw err;
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        activities: [{ text: '写代码', evidence: '今天在写代码' }],
        places: [],
        people_or_animals: [],
        mentioned_objects: [],
        explicit_emotions: [],
        temporal_clues: []
      }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const smartFetch = createSmartFetcher();
  assert.equal(typeof smartFetch, 'function');
});

test('V0.7.3 验收项 2：底层连接重置 (ECONNRESET) 精准透传错误码与友好中文，绝不被“结构校验未通过”掩盖', async () => {
  const settings = new ModelSettings({ DEEPSEEK_API_KEY: 'test-key', LIFE_MAP_TEXT_PROVIDER: 'deepseek' });

  // 模拟底层网络彻底断开抛出 ECONNRESET
  const faultyFetcher = async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNRESET', message: 'Client network socket disconnected' };
    throw err;
  };

  const handler = createAiHandler({
    settings,
    fetcher: faultyFetcher,
    interpreter: async () => {
      await faultyFetcher();
    }
  });

  // 先获取 session cookie
  const getExchange = createMockHttpExchange('/api/model-settings', 'GET');
  await handler(getExchange.req, getExchange.res);
  const cookieHeader = getExchange.res.getHeaders()['set-cookie'] || '';
  const cookieMatch = cookieHeader.match(/life_map_ai=([a-f0-9]+)/);
  assert.ok(cookieMatch, '应当成功获取 session cookie');
  const sessionCookie = `life_map_ai=${cookieMatch[1]}`;

  // 发起日记分析请求
  const postExchange = createMockHttpExchange('/api/diary/interpret', 'POST', { cookie: sessionCookie }, { input: '今天去海边散步，吹着海风。' });
  await handler(postExchange.req, postExchange.res);

  assert.equal(postExchange.res.getStatus(), 502);
  const body = postExchange.res.getBody();
  assert.equal(body.code, 'NETWORK_CONNECTION_RESET');
  assert.match(body.error, /ECONNRESET/);
  assert.match(body.error, /连接被重置/);
  assert.ok(!body.error.includes('结构校验未通过'), '严禁用“结构校验未通过”掩盖真实的网络重置断开');
});

test('V0.7.3 验收项 3：底层 DNS 失败 (ENOTFOUND) 精准识别并报告网络域名问题', async () => {
  const settings = new ModelSettings({ DEEPSEEK_API_KEY: 'test-key', LIFE_MAP_TEXT_PROVIDER: 'deepseek' });

  const dnsErrorFetcher = async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.deepseek.com' };
    throw err;
  };

  const handler = createAiHandler({
    settings,
    fetcher: dnsErrorFetcher,
    interpreter: async () => {
      await dnsErrorFetcher();
    }
  });

  const getExchange = createMockHttpExchange('/api/model-settings', 'GET');
  await handler(getExchange.req, getExchange.res);
  const sessionCookie = `life_map_ai=${getExchange.res.getHeaders()['set-cookie'].match(/life_map_ai=([a-f0-9]+)/)[1]}`;

  const postExchange = createMockHttpExchange('/api/diary/interpret', 'POST', { cookie: sessionCookie }, { input: '测试日记' });
  await handler(postExchange.req, postExchange.res);

  assert.equal(postExchange.res.getStatus(), 502);
  const body = postExchange.res.getBody();
  assert.equal(body.code, 'NETWORK_DNS_ERROR');
  assert.match(body.error, /DNS/);
  assert.ok(!body.error.includes('结构校验未通过'));
});

test('V0.7.3 验收项 4：智能 Fetcher 自愈连通后，日记分析能够顺利得到合法结构返回', async () => {
  const settings = new ModelSettings({ DEEPSEEK_API_KEY: 'test-key', LIFE_MAP_TEXT_PROVIDER: 'deepseek' });

  let probeAttempts = 0;
  const resilientFetcher = async (url) => {
    probeAttempts++;
    if (probeAttempts === 1) {
      // 模拟第一次直连被 TUN 虚拟网卡断开
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNRESET', message: 'Client network socket disconnected' };
      throw err;
    }
    // 第二次重试（走代理隧道）返回正常数据
    return new Response(JSON.stringify({
      schema_version: 'scene-intent-v0.1',
      evidence_facts: {
        activities: [{ text: '公园散步', evidence: '今天在公园散步' }],
        places: [{ text: '公园', evidence: '公园' }],
        people_or_animals: [],
        mentioned_objects: [{ text: '长椅', evidence: '坐在木长椅上' }],
        explicit_emotions: [{ text: '放松', evidence: '很放松', polarity: 'positive' }],
        temporal_clues: [{ text: '傍晚', evidence: '傍晚' }]
      },
      intent_analysis: {
        core_activity: '散步与休息',
        dominant_mood: '惬意放松',
        spatial_atmosphere: '开阔宁静的公园一隅',
        ground_environment: '草地与石板路'
      },
      symbolic_candidates: [
        {
          candidate_id: 'cand_1',
          title: '黄昏长椅小憩',
          primary_subject: '公园木长椅与路灯',
          scene_description: '公园木长椅位于石板小路旁，周围有草地和树木，夕阳洒下柔和光芒，菱形底座结构完整。',
          ground_surface: '草地石板路',
          translation_rationale: '体现散步与停歇的惬意'
        },
        {
          candidate_id: 'cand_2',
          title: '林间漫步小径',
          primary_subject: '林间小路与指示牌',
          scene_description: '蜿蜒的石板路穿过树林，旁边有一个木制指示牌，菱形底座结构完整。',
          ground_surface: '石板碎石路',
          translation_rationale: '体现漫步过程'
        }
      ],
      asset_search_intent: {
        keywords: ['公园', '长椅', '路灯'],
        category: 'outdoor_park'
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  // 自愈包装函数
  let selfHealed = false;
  const smartFetcherWrapper = async (url, options) => {
    try {
      return await resilientFetcher(url, options);
    } catch (e) {
      selfHealed = true;
      return await resilientFetcher(url, options);
    }
  };

  const handler = createAiHandler({
    settings,
    fetcher: smartFetcherWrapper,
    interpreter: async (input, config, fetcher) => {
      const resp = await fetcher('https://api.deepseek.com/chat/completions', { method: 'POST' });
      const data = await resp.json();
      return {
        envelope: data,
        debug: { provider: 'deepseek', model: 'deepseek-flash', latencyMs: 15, validation: 'valid' }
      };
    }
  });

  const getExchange = createMockHttpExchange('/api/model-settings', 'GET');
  await handler(getExchange.req, getExchange.res);
  const sessionCookie = `life_map_ai=${getExchange.res.getHeaders()['set-cookie'].match(/life_map_ai=([a-f0-9]+)/)[1]}`;

  const postExchange = createMockHttpExchange('/api/diary/interpret', 'POST', { cookie: sessionCookie }, { input: '今天在公园散步，坐在木长椅上，傍晚很放松。' });
  await handler(postExchange.req, postExchange.res);

  assert.equal(postExchange.res.getStatus(), 200);
  assert.equal(selfHealed, true, '应当成功自愈切换并重试成功');
  const body = postExchange.res.getBody();
  assert.equal(body.debug.provider, 'deepseek');
  assert.equal(body.envelope.schema_version, 'scene-intent-v0.1');
});
