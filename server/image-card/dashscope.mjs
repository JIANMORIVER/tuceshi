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
export class DashScopeAdapter {
  constructor(fetcher = fetch) { this.fetcher = fetcher.bind(globalThis); }
  async generate(config, prompt, signal, options = {}) {
    if (!config.apiKey) throw new ImageCardError("API_KEY_MISSING", "服务端尚未配置百炼 API Key，可切换到 Mock 测试。", 503);
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
    try {
      response = await this.fetcher(`${config.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
        method: "POST", redirect: "manual", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, input: { messages: [{ role: "user", content: requestContent }] },
          parameters: { size: config.size, n: 1, ...(!config.model.startsWith('qwen-image-2.1-') ? {negative_prompt: prompt.negative} : {}), prompt_extend: false, watermark: false } })
      });
    } catch { if (signal.aborted) throw signal.reason; throw new ImageCardError("NETWORK_ERROR", "无法连接百炼服务，请检查网络后手动重试。"); }
    let data;
    try { data = JSON.parse((await readBounded(response, 1024 * 1024)).toString("utf8")); }
    catch { if (signal.aborted) throw signal.reason; if (!response.ok) throw providerError(response.status); throw new ImageCardError("PROVIDER_RESPONSE_INVALID", "生图服务返回了无法解析的数据。"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new ImageCardError("PROVIDER_RESPONSE_INVALID", "生图服务返回的数据结构不正确。");
    const requestId = typeof data.request_id === "string" && /^[\w-]{1,160}$/.test(data.request_id) ? data.request_id : undefined;
    if (!response.ok || data.code) {
      const error = providerError(response.status, String(data.code || ""));
      error.details = { requestId, providerCode: /^[\w.:-]{1,100}$/.test(data.code) ? data.code : undefined };
      throw error;
    }
    const content = data.output?.choices?.[0]?.message?.content;
    const image = Array.isArray(content) ? content.find(item => item && typeof item.image === "string")?.image : undefined;
    let url; try { url = new URL(image); } catch { throw new ImageCardError("IMAGE_URL_MISSING", "生图服务未返回图片地址。", 502, { requestId }); }
    // Never follow arbitrary/private URLs or send the API credential to image hosts.
    if (url.protocol !== "https:" || !/^[a-zA-Z0-9.-]+\.aliyuncs\.com$/.test(url.hostname) || url.username || url.password || url.port) throw new ImageCardError("IMAGE_URL_INVALID", "供应商返回了不受支持的图片地址。", 502, { requestId });
    try {
      const download = await this.fetcher(url.href, { signal, redirect: "manual" });
      if (!download.ok) throw new ImageCardError([403,404,410].includes(download.status) ? "IMAGE_URL_EXPIRED" : "IMAGE_DOWNLOAD_FAILED", "生成图片地址失效或下载失败；未保存成功，请手动重试。", 502, { requestId });
      const bytes = await readBounded(download, 20 * 1024 * 1024);
      return { bytes, requestId };
    } catch (error) {
      if (signal.aborted) { signal.reason.details = { requestId }; throw signal.reason; }
      if (error instanceof ImageCardError) throw error;
      throw new ImageCardError("IMAGE_DOWNLOAD_FAILED", "图片下载失败，请检查网络。", 502, { requestId });
    }
  }
}
