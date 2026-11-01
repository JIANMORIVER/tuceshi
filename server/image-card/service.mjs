import { mkdir, readFile, readdir, rename, writeFile, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { ImageCardError, PROJECT_ROOT, publicImageConfig } from "./config.mjs";
import { buildPrompt } from "./prompt.mjs";
import { DashScopeAdapter } from "./dashscope.mjs";
import { mockPng, validatePng } from "./png.mjs";

export const validId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function buildAuditReport({ record, input, generated, error }) {
  const positive = record?.prompt?.positive || "";
  const segments = record?.prompt?.segments || {
    scene_content: record?.input?.length || 0,
    structure_rules: 0,
    scale_rules: 0,
    style_package: 0,
    transparency_rules: 0,
    i2i_reference_rules: 0,
    negative_prohibitions: 0
  };
  const refImages = Array.isArray(input?.labConfig?.reference_images) ? input.labConfig.reference_images : [];
  let totalRefPayloadBytes = 0;
  const imageDetails = refImages.map(img => {
    const dataLen = typeof img.dataUrl === "string" ? img.dataUrl.length : 0;
    const estBytes = img.sizeBytes || Math.round(dataLen * 0.75);
    totalRefPayloadBytes += dataLen;
    return {
      id: img.id,
      name: img.name,
      role: img.role,
      size_bytes: estBytes
    };
  });
  const estTotalPayload = totalRefPayloadBytes + positive.length * 2 + 1024;
  const httpStatus = generated?.httpStatus || (error ? (error.details?.httpStatus || error.status || 500) : 200);
  const contentType = generated?.contentType || error?.details?.contentType || "application/json; charset=utf-8";

  const reqId = record?.requestId || error?.details?.requestId || undefined;

  return {
    final_prompt: positive,
    total_prompt_chars: positive.length,
    prompt_segments: segments,
    images_meta: {
      count: refImages.length,
      details: imageDetails,
      estimated_request_payload_bytes: estTotalPayload
    },
    http_meta: {
      status_code: httpStatus,
      content_type: contentType
    },
    ...(error ? { backend_error_code: error.code || "MODEL_REQUEST_FAILED" } : {}),
    ...(error?.details?.providerCode ? { provider_raw_error_code: error.details.providerCode } : {}),
    ...(reqId ? { request_id: reqId } : {}),
    stage: error ? (error.details?.stage || "failed") : "completed"
  };
}

export class ImageGenerationService {
  constructor(config, { adapter = new DashScopeAdapter(), storageRoot = join(PROJECT_ROOT, ".local/image-card-lab"), promptBuilder = buildPrompt } = {}) {
    this.config = config; this.adapter = adapter; this.storageRoot = storageRoot; this.promptBuilder = promptBuilder; this.busy = false;
  }
  info() { return publicImageConfig(this.config); }
  async record(id) {
    if (!validId(id)) throw new ImageCardError("NOT_FOUND", "实验记录不存在。", 404);
    try { return JSON.parse(await readFile(join(this.storageRoot, `${id}.json`), "utf8")); }
    catch (error) { if (error.code === "ENOENT") throw new ImageCardError("NOT_FOUND", "实验记录不存在。", 404); throw error; }
  }
  async history() {
    let files; try { files = await readdir(this.storageRoot); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const records = await Promise.all(files.filter(name => validId(name.slice(0,-5)) && name.endsWith(".json")).map(name => this.record(name.slice(0,-5))));
    return records.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,30);
  }
  async saveRecord(record) {
    const path = join(this.storageRoot, `${record.id}.json`);
    await writeFile(`${path}.tmp`, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  async generate(input) {
    if (!input || !validId(input.requestId) || typeof input.description !== "string" || !input.description.trim() || input.description.length > 1200 || !["mock","real"].includes(input.mode) || (input.count !== undefined && input.count !== 1)) throw new ImageCardError("INPUT_INVALID", "请输入 1–1200 字的场景、有效请求 ID 和模式；每次只生成一张。", 400);
    if (this.busy) throw new ImageCardError("GENERATION_BUSY", "已有生成任务进行中，请等待结果；不会重复调用。", 409);
    this.busy = true;
    try {
      let previous;
      try { previous = await this.record(input.requestId); } catch (error) { if (error.code !== "NOT_FOUND") throw error; }
      if (previous) {
        if (previous.input !== input.description.trim() || previous.mode !== input.mode) throw new ImageCardError("REQUEST_CONFLICT", "请求 ID 已用于其他内容。", 409);
        return previous;
      }
      if (!this.config.enabled) throw new ImageCardError("GENERATION_DISABLED", "生图开关已关闭。", 503);
      if (input.mode === "real" && !this.config.apiKey) throw new ImageCardError("API_KEY_MISSING", "服务端尚未配置百炼 API Key，可使用 Mock。", 503);
      await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
      const started = Date.now();
      const prompt = this.promptBuilder(input.description.trim(), input.labConfig || {});
      const record = { version: 1, id: input.requestId, status: "processing", input: input.description.trim(), prompt,
        provider: input.mode === "mock" ? "mock" : this.config.provider, model: input.mode === "mock" ? "deterministic-pixel-fixture-v1" : this.config.model,
        mode: input.mode, region: this.config.region, requestedSize: this.config.size, createdAt: new Date().toISOString(), elapsedMs: 0,
        ...(input.labConfig ? { labConfig: input.labConfig } : {}),
        ...(this.config.generationRoute ? {generationRoute:this.config.generationRoute} : {}) };
      await this.saveRecord(record);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new ImageCardError("REQUEST_TIMEOUT", "请求超时；供应商可能仍在处理。请检查控制台后再决定是否手动重新生成。", 504)), this.config.timeoutMs);
      try {
        const generated = input.mode === "mock" ? { bytes: mockPng(this.config.width, this.config.height) }
          : await this.adapter.generate(this.config, record.prompt, controller.signal, { referenceImages: input.labConfig?.reference_images, mode: input.labConfig?.mode });
        if (generated.requestId) record.requestId = generated.requestId;
        const dimensions = validatePng(generated.bytes);
        const filename = `${record.id}.png`;
        const path = join(this.storageRoot, filename);
        await writeFile(`${path}.tmp`, generated.bytes, { mode: 0o600 });
        await rename(`${path}.tmp`, path);
        record.image = { assetId: record.id, storagePath: relative(PROJECT_ROOT,path).replaceAll("\\","/"), url: `/api/image-cards/${record.id}/image`, ...dimensions };
        record.status = "succeeded"; record.elapsedMs = Date.now() - started;
        record.auditReport = buildAuditReport({ record, input, generated });
        await this.saveRecord(record);
      } catch (error) {
        const safe = controller.signal.aborted ? controller.signal.reason : error instanceof ImageCardError ? error : new ImageCardError("STORAGE_FAILED", "本地保存失败，请检查目录权限与可用空间。", 500);
        record.status = "failed"; record.elapsedMs = Date.now() - started;
        record.error = { code: safe.code, message: safe.message, ...safe.details };
        if (safe.details?.requestId) record.requestId = safe.details.requestId;
        if (record.requestId) record.error.requestId = record.requestId;
        record.auditReport = buildAuditReport({ record, input, error: safe });
        delete record.image;
        await unlink(join(this.storageRoot, `${record.id}.png`)).catch(() => {});
        await this.saveRecord(record);
      } finally { clearTimeout(timer); }
      return record;
    } finally { this.busy = false; }
  }
  async image(id) {
    const record = await this.record(id);
    if (record.status !== "succeeded") throw new ImageCardError("NOT_FOUND", "图片尚未保存。", 404);
    try { return await readFile(join(this.storageRoot, `${id}.png`)); }
    catch { throw new ImageCardError("NOT_FOUND", "本地图片不存在。", 404); }
  }
}
