import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import { ImageCardError } from "./config.mjs";

export function providerError(status, code = "") {
  if (status === 401 || /InvalidApiKey|InvalidAccessKey|Unauthorized/i.test(code)) return new ImageCardError("API_KEY_INVALID", "API Key 无效或与所选地域不匹配，请检查服务端配置。", 502);
  if (status === 403 || status === 404 || /ModelNotFound|AccessDenied|ModelAccess|ModelNotExist/i.test(code)) return new ImageCardError("MODEL_UNAVAILABLE", "模型不存在或账户无权限；请检查百炼控制台与地域。", 502);
  if (status === 429 || /Throttl|RateLimit/i.test(code)) return new ImageCardError("RATE_LIMITED", "供应商限流，请稍后手动重试。", 429);
  return new ImageCardError("PROVIDER_ERROR", "生图服务拒绝请求，请检查模型参数、额度或供应商状态。", 502);
}

export async function readBounded(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) throw new ImageCardError("INVALID_IMAGE", "供应商返回数据过大。");
  const chunks = []; let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > limit) throw new ImageCardError("INVALID_IMAGE", "供应商返回数据过大。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * 创建基于 HTTP CONNECT 的 HTTPS 隧道 fetcher
 */
export function createTunneledFetch(proxyUrl) {
  let proxyHost = '127.0.0.1';
  let proxyPort = 7897;
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      proxyHost = u.hostname;
      proxyPort = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    } catch {
      const [h, p] = proxyUrl.replace(/^https?:\/\//, '').split(':');
      proxyHost = h || '127.0.0.1';
      proxyPort = Number(p) || 7897;
    }
  }

  return async function tunneledFetch(urlStr, options = {}) {
    const url = new URL(urlStr);
    const method = options.method || 'GET';
    const headers = { ...(options.headers || {}) };
    const body = options.body;
    const signal = options.signal;

    if (body && typeof body === 'string' && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
    }

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(signal.reason);
      }

      const connectReq = http.request({
        host: proxyHost,
        port: proxyPort,
        method: 'CONNECT',
        path: `${url.hostname}:${url.port || 443}`,
        signal
      });

      const onAbort = () => {
        connectReq.destroy(signal.reason);
        reject(signal.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          signal?.removeEventListener('abort', onAbort);
          const err = new Error(`Proxy CONNECT 隧道建立失败，状态码: ${res.statusCode}`);
          err.code = 'PROXY_CONNECT_FAILED';
          return reject(err);
        }

        const tlsSocket = tls.connect({
          host: url.hostname,
          servername: url.hostname,
          socket
        }, () => {
          const req = https.request(url, {
            method,
            headers,
            createConnection: () => tlsSocket,
            signal
          }, (response) => {
            const chunks = [];
            response.on('data', c => chunks.push(c));
            response.on('end', () => {
              signal?.removeEventListener('abort', onAbort);
              const resBody = Buffer.concat(chunks);
              const headersObj = new Headers();
              for (const [k, v] of Object.entries(response.headers)) {
                if (Array.isArray(v)) {
                  v.forEach(val => headersObj.append(k, val));
                } else if (v !== undefined) {
                  headersObj.set(k, v);
                }
              }

              const fakeResponse = {
                ok: response.statusCode >= 200 && response.statusCode < 300,
                status: response.statusCode,
                statusText: response.statusMessage || '',
                headers: headersObj,
                text: async () => resBody.toString('utf8'),
                json: async () => JSON.parse(resBody.toString('utf8')),
                buffer: async () => resBody,
                body: (async function* () { yield resBody; })()
              };
              resolve(fakeResponse);
            });
          });

          req.on('error', (err) => {
            signal?.removeEventListener('abort', onAbort);
            reject(err);
          });

          if (body) {
            req.write(body);
          }
          req.end();
        });

        tlsSocket.on('error', (err) => {
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        });
      });

      connectReq.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      });

      connectReq.end();
    });
  };
}

/**
 * 统一提取错误链（包括 err, err.cause, 嵌套 cause 等）中的真实错误码与错误信息
 */
export function extractNetworkErrorInfo(err) {
  const codes = [];
  const messages = [];

  let curr = err;
  let depth = 0;
  while (curr && depth < 5) {
    if (curr.code) codes.push(String(curr.code));
    if (curr.status) codes.push(`HTTP_${curr.status}`);
    if (curr.name && curr.name !== 'Error' && curr.name !== 'TypeError') codes.push(String(curr.name));
    if (curr.message) messages.push(String(curr.message));
    curr = curr.cause;
    depth++;
  }

  const rawCode = codes.find(c => c !== 'TypeError' && c !== 'Error') || err?.name || 'NETWORK_ERROR';
  const combined = `${codes.join(' ')} ${messages.join(' ')}`;

  const isTimeout = /ETIMEDOUT|ESOCKETTIMEDOUT|timeout|AbortError/i.test(combined);
  const isDns = /ENOTFOUND|EAI_AGAIN|EAI_FAIL|getaddrinfo/i.test(combined);
  const isConnReset = /ECONNRESET|ECONNABORTED|EPIPE|UND_ERR_SOCKET|disconnected before secure TLS/i.test(combined);
  const isProxy = /PROXY|proxy|ECONNREFUSED/i.test(combined);
  const isTls = /CERT|TLS|SSL/i.test(combined);

  let errorCategory = "unknown_network_error";
  if (isTimeout) errorCategory = "timeout";
  else if (isDns) errorCategory = "dns_failure";
  else if (isConnReset) errorCategory = "connection_reset";
  else if (isProxy) errorCategory = "proxy_error";
  else if (isTls) errorCategory = "tls_error";

  return {
    rawCode: String(rawCode),
    combined,
    messages: messages.join('; '),
    errorCategory,
    isTimeout,
    isDns,
    isConnReset,
    isProxy,
    isTls
  };
}

/**
 * 零费用探测百炼直连是否可达
 */
export async function checkDirectReachability(targetUrl, timeoutMs = 2500) {
  let targetHost = 'dashscope.aliyuncs.com';
  let targetPort = 443;
  try {
    const u = new URL(targetUrl);
    targetHost = u.hostname;
    targetPort = Number(u.port) || (u.protocol === 'http:' ? 80 : 443);
  } catch {}

  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.request({
      host: targetHost,
      port: targetPort,
      path: '/',
      method: 'HEAD',
      timeout: timeoutMs
    }, (res) => {
      resolve({ ok: true, status: res.statusCode, elapsed: Date.now() - t0 });
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err, elapsed: Date.now() - t0 });
    });
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Direct reachability check timed out');
      err.code = 'ETIMEDOUT';
      resolve({ ok: false, error: err, elapsed: Date.now() - t0 });
    });
    req.end();
  });
}

/**
 * 探测代理是否真正支持 HTTPS CONNECT 隧道
 */
export async function checkProxyConnect(proxyUrl, targetHost, targetPort = 443, timeoutMs = 2000) {
  let proxyHost = '127.0.0.1';
  let proxyPort = 7897;
  try {
    const u = new URL(proxyUrl);
    proxyHost = u.hostname;
    proxyPort = Number(u.port) || 80;
  } catch {
    const [h, p] = String(proxyUrl).replace(/^https?:\/\//, '').split(':');
    proxyHost = h || '127.0.0.1';
    proxyPort = Number(p) || 7897;
  }

  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      timeout: timeoutMs
    });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve({ ok: res.statusCode === 200, status: res.statusCode, elapsed: Date.now() - t0 });
    });
    req.on('error', (err) => resolve({ ok: false, error: err, elapsed: Date.now() - t0 }));
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Proxy CONNECT timed out');
      err.code = 'ETIMEDOUT';
      resolve({ ok: false, error: err, elapsed: Date.now() - t0 });
    });
    req.end();
  });
}

let preflightCache = {
  key: "",
  result: null,
  timestamp: 0
};

/**
 * 生图前零费用网络预检，选定网络路径或提前阻断
 */
export async function preflightNetworkCheck(config, options = {}) {
  const forceRefresh = options.forceRefresh || false;
  let targetUrl = config.baseUrl || "https://dashscope.aliyuncs.com";
  let targetHost = "dashscope.aliyuncs.com";
  let targetPort = 443;
  try {
    const u = new URL(targetUrl);
    targetHost = u.hostname;
    targetPort = Number(u.port) || (u.protocol === 'http:' ? 80 : 443);
  } catch {}

  const cacheKey = `${targetHost}:${targetPort}:${config.proxy || ''}`;
  if (!forceRefresh && preflightCache.key === cacheKey && (Date.now() - preflightCache.timestamp < 30000)) {
    return preflightCache.result;
  }

  // 1. 如果配置了显式代理，优先预检显式代理是否支持 CONNECT
  const explicitProxy = config.proxy || process.env.LIFE_MAP_IMAGE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || "";
  if (explicitProxy) {
    const proxyCheck = await checkProxyConnect(explicitProxy, targetHost, targetPort, 2000);
    if (proxyCheck.ok) {
      const res = {
        route: "proxy",
        proxyUrl: explicitProxy,
        directOk: false,
        proxyOk: true,
        details: `已连通显式代理隧道 ${explicitProxy}`
      };
      preflightCache = { key: cacheKey, result: res, timestamp: Date.now() };
      return res;
    }
  }

  // 2. 预检直连是否可达（支持 TUN 模式或正常国内网络）
  const directCheck = await checkDirectReachability(targetUrl, 2500);
  if (directCheck.ok) {
    const res = {
      route: "direct",
      proxyUrl: null,
      directOk: true,
      proxyOk: false,
      details: "百炼接口直连通畅 (Direct/TUN 正常)"
    };
    preflightCache = { key: cacheKey, result: res, timestamp: Date.now() };
    return res;
  }

  // 3. 直连不可达（如遇到 TUN Fake-IP Client Hello 重置断开），探测本地 Clash HTTP/Mixed 代理
  const candidatePorts = [7897, 7890, 1087, 10808];
  for (const port of candidatePorts) {
    const candidateProxy = `http://127.0.0.1:${port}`;
    const proxyCheck = await checkProxyConnect(candidateProxy, targetHost, targetPort, 1500);
    if (proxyCheck.ok) {
      const res = {
        route: "proxy",
        proxyUrl: candidateProxy,
        directOk: false,
        proxyOk: true,
        details: `百炼直连受阻，已预检连通本地代理隧道 ${candidateProxy}`
      };
      preflightCache = { key: cacheKey, result: res, timestamp: Date.now() };
      return res;
    }
  }

  // 4. 直连与代理均不可达：预检失败，在发起付费提交前坚决阻断
  const directErrInfo = directCheck.error ? extractNetworkErrorInfo(directCheck.error) : { rawCode: 'CONNECTION_FAILED', errorCategory: 'connection_reset' };
  const netErr = new ImageCardError(
    "PREFLIGHT_NETWORK_FAILED",
    `生图前网络预检失败：百炼接口直连不可达 [${directErrInfo.rawCode}]，且本地未检测到可用的 HTTPS CONNECT 代理（已探测 7897/7890 等端口）。已阻止付费提交，请检查网络或开启代理客户端。`,
    502
  );
  netErr.details = {
    stage: "preflight_check",
    underlyingErrorCode: directErrInfo.rawCode,
    errorCategory: directErrInfo.errorCategory || "connection_reset",
    targetHost,
    proxyUsed: false
  };
  throw netErr;
}

/**
 * 探测本地标准代理端口是否存活
 */
export async function probeLocalProxy() {
  const candidatePorts = [7897, 7890, 1087, 10808];
  for (const port of candidatePorts) {
    try {
      const ok = await new Promise(resolve => {
        const sock = net.connect({ host: '127.0.0.1', port, timeout: 200 }, () => {
          sock.destroy();
          resolve(true);
        });
        sock.on('error', () => resolve(false));
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
      });
      if (ok) return `http://127.0.0.1:${port}`;
    } catch {}
  }
  return null;
}

let detectedProxyCache = null;

/**
 * 创建具备 TUN/代理自愈能力的智能 Fetcher
 * - 优先遵从 customProxy 或环境变量 (LIFE_MAP_IMAGE_PROXY / HTTPS_PROXY / HTTP_PROXY)
 * - 存在缓存代理时优先复用
 * - 直连遇到 ECONNRESET / TLS 断连时，自动探测本地代理端口 (7897, 7890 等) 并切换自愈重发
 */
export function createSmartFetcher(customProxy = "") {
  return async function smartFetch(urlStr, options = {}) {
    let effectiveProxy = customProxy || detectedProxyCache || process.env.LIFE_MAP_IMAGE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || "";

    if (effectiveProxy) {
      try {
        const tunneled = createTunneledFetch(effectiveProxy);
        return await tunneled(urlStr, options);
      } catch (proxyErr) {
        if (effectiveProxy === detectedProxyCache) {
          detectedProxyCache = null;
        }
        if (customProxy || process.env.LIFE_MAP_IMAGE_PROXY) {
          throw proxyErr;
        }
      }
    }

    try {
      return await globalThis.fetch(urlStr, options);
    } catch (err) {
      if (options.signal?.aborted) {
        throw err;
      }
      const errInfo = extractNetworkErrorInfo(err);
      if (errInfo.isConnReset) {
        const fallbackProxy = await probeLocalProxy();
        if (fallbackProxy) {
          console.warn(`[smartFetch] 检测到直连断开/被重置 (TUN 模式)，自愈切换至本地代理: ${fallbackProxy}`);
          detectedProxyCache = fallbackProxy;
          const tunneled = createTunneledFetch(fallbackProxy);
          return await tunneled(urlStr, options);
        }
      }
      throw err;
    }
  };
}

/**
 * 精准分析底层网络异常，分类归因
 */
export function classifyNetworkError(err, signal, elapsedMs, config = {}, proxyUsed = false, effectiveProxy = "", stage = "qwen_submitting") {
  const errInfo = extractNetworkErrorInfo(err);
  let errCategory = errInfo.errorCategory;
  if (signal?.aborted) errCategory = "timeout";

  let targetHost = "dashscope.aliyuncs.com";
  try {
    if (config.baseUrl) targetHost = new URL(config.baseUrl).hostname;
  } catch {}

  let proxyEndpoint;
  if (effectiveProxy) {
    try {
      proxyEndpoint = new URL(effectiveProxy).host;
    } catch {
      proxyEndpoint = effectiveProxy;
    }
  }

  const netErr = new ImageCardError("NETWORK_ERROR", `无法连接百炼服务 [${errCategory}] (${errInfo.rawCode}): ${err?.message || errInfo.messages}`, 502);
  netErr.details = {
    stage,
    underlyingErrorCode: String(errInfo.rawCode),
    errorCategory: errCategory,
    elapsedMs,
    targetHost,
    proxyUsed,
    proxyEndpoint
  };
  return netErr;
}

export class DashScopeAdapter {
  constructor(fetcher = globalThis.fetch) {
    this.isDefaultFetcher = (fetcher === globalThis.fetch);
    this.fetcher = fetcher.bind(globalThis);
  }

  async generate(config, prompt, signal, options = {}) {
    if (!config.apiKey) throw new ImageCardError("API_KEY_MISSING", "服务端尚未配置百炼 API Key，可切换到 Mock 测试。", 503);
    const t0 = Date.now();
    let response;
    const requestContent = [];
    if (options.mode === 'image_to_image' && Array.isArray(options.referenceImages)) {
      for (const img of options.referenceImages) {
        if (img && typeof img.dataUrl === 'string' && img.dataUrl.trim()) {
          requestContent.push({ image: img.dataUrl.trim() });
        }
      }
    }
    requestContent.push({ text: prompt.positive });

    // 核心改造：生图前网络预检（零模型费用），提前选定直连或代理路径
    let effectiveProxy = config.proxy || process.env.LIFE_MAP_IMAGE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || "";
    let selectedRoute = effectiveProxy ? "proxy" : "direct";

    if (this.isDefaultFetcher) {
      const preflight = await preflightNetworkCheck(config, { signal });
      selectedRoute = preflight.route;
      effectiveProxy = preflight.proxyUrl || "";
    }

    let activeFetcher = this.fetcher;
    if (this.isDefaultFetcher && effectiveProxy) {
      activeFetcher = createTunneledFetch(effectiveProxy);
    }

    const payloadBody = JSON.stringify({
      model: config.model,
      input: { messages: [{ role: "user", content: requestContent }] },
      parameters: {
        size: config.size,
        n: 1,
        // 契约规定：DashScope 多模态生成 (qwen-image-2.1-turbo 及相关系列) 严禁传递 negative_prompt，所有禁止规则均在 positive prompt 中合并
        prompt_extend: false,
        watermark: false
      }
    });

    try {
      response = await activeFetcher(`${config.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
        method: "POST", redirect: "manual", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: payloadBody
      });
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      // 铁律：生图请求发出后，若失败绝不自动换代理重新提交（避免重复计费）！
      // 提取错误链真实错误码，直接抛出精准分类异常
      const netErr = classifyNetworkError(err, signal, Date.now() - t0, config, Boolean(effectiveProxy), effectiveProxy, "qwen_submitting");
      netErr.details.selectedRoute = selectedRoute;
      throw netErr;
    }

    const responseContentType = response.headers?.get?.("content-type") || "";
    let data;
    try { data = JSON.parse((await readBounded(response, 1024 * 1024)).toString("utf8")); }
    catch {
      if (signal?.aborted) throw signal.reason;
      if (!response.ok) {
        const pErr = providerError(response.status);
        pErr.details = {
          httpStatus: response.status,
          contentType: responseContentType,
          stage: "qwen_generating",
          underlyingErrorCode: `HTTP_${response.status}`,
          errorCategory: "provider_http_error",
          elapsedMs: Date.now() - t0,
          proxyUsed: Boolean(effectiveProxy),
          proxyEndpoint: effectiveProxy ? new URL(effectiveProxy).host : undefined
        };
        throw pErr;
      }
      throw new ImageCardError("PROVIDER_RESPONSE_INVALID", "生图服务返回了无法解析的数据。", 502, {
        httpStatus: response.status,
        contentType: responseContentType,
        stage: "qwen_generating",
        underlyingErrorCode: "RESPONSE_NOT_JSON",
        errorCategory: "provider_http_error",
        elapsedMs: Date.now() - t0,
        proxyUsed: Boolean(effectiveProxy)
      });
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ImageCardError("PROVIDER_RESPONSE_INVALID", "生图服务返回的数据结构不正确。", 502, {
        httpStatus: response.status,
        contentType: responseContentType,
        stage: "qwen_generating",
        underlyingErrorCode: "MALFORMED_DATA",
        errorCategory: "provider_http_error",
        elapsedMs: Date.now() - t0,
        proxyUsed: Boolean(effectiveProxy)
      });
    }

    const requestId = typeof data.request_id === "string" && /^[\w-]{1,160}$/.test(data.request_id) ? data.request_id : undefined;
    if (!response.ok || data.code) {
      const error = providerError(response.status, String(data.code || ""));
      error.details = {
        requestId,
        providerCode: /^[\w.:-]{1,100}$/.test(data.code) ? data.code : undefined,
        httpStatus: response.status,
        contentType: responseContentType,
        stage: "qwen_generating",
        underlyingErrorCode: data.code || `HTTP_${response.status}`,
        errorCategory: "provider_http_error",
        elapsedMs: Date.now() - t0,
        proxyUsed: Boolean(effectiveProxy),
        proxyEndpoint: effectiveProxy ? new URL(effectiveProxy).host : undefined
      };
      throw error;
    }

    const content = data.output?.choices?.[0]?.message?.content;
    const image = Array.isArray(content) ? content.find(item => item && typeof item.image === "string")?.image : undefined;
    let url;
    try {
      url = new URL(image);
    } catch {
      throw new ImageCardError("IMAGE_URL_MISSING", "生图服务未返回图片地址。", 502, {
        requestId,
        httpStatus: response.status,
        contentType: responseContentType,
        stage: "qwen_generating",
        underlyingErrorCode: "NO_IMAGE_URL",
        errorCategory: "provider_http_error",
        elapsedMs: Date.now() - t0,
        proxyUsed: Boolean(effectiveProxy)
      });
    }

    if (url.protocol !== "https:" || !/^[a-zA-Z0-9.-]+\.aliyuncs\.com$/.test(url.hostname) || url.username || url.password || url.port) {
      throw new ImageCardError("IMAGE_URL_INVALID", "供应商返回了不受支持的图片地址。", 502, {
        requestId,
        httpStatus: response.status,
        stage: "image_downloading",
        underlyingErrorCode: "UNTRUSTED_HOST",
        errorCategory: "provider_http_error",
        elapsedMs: Date.now() - t0,
        proxyUsed: Boolean(effectiveProxy)
      });
    }

    try {
      const download = await activeFetcher(url.href, { signal, redirect: "manual" });
      if (!download.ok) {
        throw new ImageCardError([403, 404, 410].includes(download.status) ? "IMAGE_URL_EXPIRED" : "IMAGE_DOWNLOAD_FAILED", "生成图片地址失效或下载失败；未保存成功，请手动重试。", 502, {
          requestId,
          httpStatus: download.status,
          stage: "image_downloading",
          underlyingErrorCode: `HTTP_${download.status}`,
          errorCategory: "provider_http_error",
          elapsedMs: Date.now() - t0,
          proxyUsed: Boolean(effectiveProxy)
        });
      }
      const bytes = await readBounded(download, 20 * 1024 * 1024);
      return {
        bytes,
        requestId,
        httpStatus: response.status,
        contentType: responseContentType,
        networkMeta: {
          stage: "completed",
          selectedRoute,
          elapsedMs: Date.now() - t0,
          proxyUsed: Boolean(effectiveProxy),
          proxyEndpoint: effectiveProxy ? new URL(effectiveProxy).host : undefined,
          targetHost: new URL(config.baseUrl).hostname
        }
      };
    } catch (error) {
      if (signal?.aborted) {
        signal.reason.details = { requestId, stage: "image_downloading", elapsedMs: Date.now() - t0 };
        throw signal.reason;
      }
      if (error instanceof ImageCardError) throw error;
      throw classifyNetworkError(error, signal, Date.now() - t0, config, Boolean(effectiveProxy), effectiveProxy, "image_downloading");
    }
  }
}
