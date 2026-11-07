import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
// Process > root .env.local > root .env > existing docs/.env.local. Never mutate process.env.
export function loadImageEnv(root = PROJECT_ROOT, environment = process.env) {
  const merged = {};
  for (const name of ["docs/.env.local", ".env", ".env.local"]) {
    const path = join(root, name);
    if (existsSync(path)) Object.assign(merged, parseEnv(readFileSync(path, "utf8")));
  }
  return { ...merged, ...environment };
}
export class ImageCardError extends Error {
  constructor(code, message, status = 502, details = {}) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
const badConfig = message => { throw new ImageCardError("CONFIG_INVALID", message, 503); };
export function readImageConfig(env = loadImageEnv()) {
  const provider = env.LIFE_MAP_IMAGE_PROVIDER || "dashscope";
  const region = env.LIFE_MAP_IMAGE_REGION || "beijing";
  const model = env.LIFE_MAP_IMAGE_MODEL || "qwen-image-2.0";
  const size = env.LIFE_MAP_IMAGE_SIZE || "1024*1024";
  const timeoutMs = Number(env.LIFE_MAP_IMAGE_TIMEOUT_MS || 120000);
  const maxImages = Number(env.LIFE_MAP_IMAGE_MAX_IMAGES || 1);
  const mode = env.LIFE_MAP_IMAGE_MODE || "mock";
  const enabled = (env.LIFE_MAP_IMAGE_ENABLED || "true") === "true";
  const apiKey = env.LIFE_MAP_IMAGE_API_KEY || env.DASHSCOPE_API_KEY || "";
  if (provider !== "dashscope" || !["mock", "real"].includes(mode) || !["beijing", "singapore"].includes(region)) badConfig("检查生图供应商、模式与地域配置。");
  // 2.1 uses the same endpoint, but omits unsupported negative_prompt in the adapter.
  if (!["qwen-image-2.0", "qwen-image-2.0-2026-03-03", "qwen-image-2.0-pro", "qwen-image-2.0-pro-2026-03-03", "qwen-image-2.0-pro-2026-04-22", "qwen-image-2.0-pro-2026-06-22", "qwen-image-2.1-turbo", "qwen-image-2.1-pro"].includes(model)) badConfig("请选择已适配的千问 2.0 或 2.1 生图模型。");
  const match = /^(\d{3,4})\*(\d{3,4})$/.exec(size);
  const width = Number(match?.[1]), height = Number(match?.[2]);
  if (!match || width < 512 || height < 512 || width > 4096 || height > 4096 || width * height > 2048 ** 2) badConfig("图像尺寸需在 512×512 至 2048×2048 总像素范围内，单边 512–4096。");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000 || maxImages !== 1) badConfig("超时需为 100–300000ms；本轮每次只允许生成一张图片。");
  const baseUrl = (env.LIFE_MAP_IMAGE_BASE_URL || (region === "beijing" ? "https://dashscope.aliyuncs.com" : "https://dashscope-intl.aliyuncs.com")).replace(/\/$/, "");
  let url; try { url = new URL(baseUrl); } catch { badConfig("生图 Base URL 无效。"); }
  const expected = region === "beijing" ? /^(dashscope\.aliyuncs\.com|[a-zA-Z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com)$/ : /^(dashscope-intl\.aliyuncs\.com|[a-zA-Z0-9-]+\.ap-southeast-1\.maas\.aliyuncs\.com)$/;
  if (url.protocol !== "https:" || !expected.test(url.hostname) || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) badConfig("Base URL 必须为所选地域的官方 DashScope 域名根地址，不要填写文本模型兼容接口地址。");
  const proxy = (env.LIFE_MAP_IMAGE_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY || env.https_proxy || env.http_proxy || env.ALL_PROXY || env.all_proxy || "").trim();
  return { provider, model, region, baseUrl, size, width, height, timeoutMs, maxImages, mode, enabled, apiKey, proxy };
}
export function publicImageConfig(config) {
  const { apiKey, proxy, ...safe } = config;
  let safeProxy;
  if (proxy) {
    try {
      const u = new URL(proxy);
      safeProxy = `${u.protocol}//${u.host}`;
    } catch {
      safeProxy = "configured";
    }
  }
  return { ...safe, proxyConfigured: Boolean(proxy), proxy: safeProxy, apiConfigured: Boolean(apiKey), realReady: Boolean(apiKey) && config.enabled, accountAccess: "unverified" };
}
