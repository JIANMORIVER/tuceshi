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

/**
 * 精准分析底层网络异常，分类归因
 */
export function classifyNetworkError(err, signal, elapsedMs, config = {}, proxyUsed = false, effectiveProxy = "", stage = "qwen_submitting") {
  let errCategory = "unknown_network_error";
  const rawCode = err?.code || err?.cause?.code || err?.name || "NETWORK_ERROR";
  const rawMsg = err?.message || err?.cause?.message || String(err || "");

  if (signal?.aborted || /ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i.test(rawCode + " " + rawMsg)) {
    errCategory = "timeout";
  } else if (/ENOTFOUND|EAI_AGAIN|EAI_FAIL|getaddrinfo/i.test(rawCode + " " + rawMsg)) {
    errCategory = "dns_failure";
  } else if (/ECONNRESET|ECONNABORTED|EPIPE|UND_ERR_SOCKET|disconnected before secure TLS/i.test(rawCode + " " + rawMsg)) {
    errCategory = "connection_reset";
  } else if (/PROXY|proxy|ECONNREFUSED/i.test(rawCode + " " + rawMsg) && proxyUsed) {
    errCategory = "proxy_error";
  } else if (/CERT|TLS|SSL/i.test(rawCode + " " + rawMsg)) {
    errCategory = "tls_error";
  }

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

  const netErr = new ImageCardError("NETWORK_ERROR", `无法连接百炼服务 [${errCategory}] (${rawCode}): ${rawMsg}`, 502);
  netErr.details = {
    stage,
    underlyingErrorCode: String(rawCode),
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

    let effectiveProxy = config.proxy || process.env.LIFE_MAP_IMAGE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || "";
    let activeFetcher = this.fetcher;

    // 仅在真实环境下生效代理隧道
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

      // 自愈机制：如果使用默认直连因 Fake-IP / TUN 模式导致连接重置，探测并自愈切换至本地可用代理
      if (this.isDefaultFetcher && !effectiveProxy) {
        const isConnReset = /ECONNRESET|UND_ERR_SOCKET|disconnected before secure TLS/i.test(String(err?.code || '') + ' ' + String(err?.message || ''));
        if (isConnReset) {
          const fallbackProxy = await probeLocalProxy();
          if (fallbackProxy) {
            console.warn(`[DashScopeAdapter] 检测到本地网络连接重置 (TUN 模式)，自愈切换至本地代理 ${fallbackProxy}`);
            try {
              const tunneled = createTunneledFetch(fallbackProxy);
              response = await tunneled(`${config.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
                method: "POST", redirect: "manual", signal,
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
                body: payloadBody
              });
              effectiveProxy = fallbackProxy;
              activeFetcher = tunneled;
            } catch (innerErr) {
              if (signal?.aborted) throw signal.reason;
              throw classifyNetworkError(innerErr, signal, Date.now() - t0, config, true, fallbackProxy, "qwen_submitting");
            }
          }
        }
      }

      if (!response) {
        throw classifyNetworkError(err, signal, Date.now() - t0, config, Boolean(effectiveProxy), effectiveProxy, "qwen_submitting");
      }
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
