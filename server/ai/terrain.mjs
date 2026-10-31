import { createHash } from "node:crypto";
import { join } from "node:path";
import { ImageGenerationService, validId } from "../image-card/service.mjs";
import { ImageCardError, PROJECT_ROOT } from "../image-card/config.mjs";
import { buildPrompt, PROMPT_VERSION } from "../image-card/prompt.mjs";
export function stableRequestId(value) {
  const bytes = createHash("sha256").update(value).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const s = bytes.toString("hex"); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export function terrainDescription(input) {
  const chosen = (input.snapshot.analysis?.visualizable_events || []).filter(event => input.focus_event_ids?.includes(event.event_id));
  const facts = chosen.map(event => `${event.title}：${event.evidence || ""}`).join("；");
  const answers = (input.snapshot.user_supplemental_answers || []).map(answer => answer.final_answer).join("；");
  return `画面内容：${String(input.candidate_plan.scene_description || input.candidate_plan.title || "日记中的生活场景").slice(0,400)}\n当日明确线索：${(facts || input.snapshot.input_text).slice(0,500)}\n用户细节回答：${answers.slice(0,200)}\n方案：${input.candidate_id === "candidate_1" ? "突出主要事项" : "以另一种构图表现同一份日记"}`.slice(0,1200);
}
export function jobFromTerrainRecord(record, input) {
  const prompt = record.prompt || buildPrompt(record.input);
  return { job_id: `terrain:${record.id}`, planning_run_id: input.planning_run_id, candidate_id: input.candidate_id,
    ...(record.generationRoute?{generation_route:record.generationRoute}:{}),
    provider: record.mode === "real" ? "qwen" : "mock", model: record.model, prompt_version: prompt.version,
    submitted_prompt: { prompt_version: prompt.version, positive_prompt: prompt.positive, negative_prompt: prompt.negative, composition_hints: ["complete isometric illustration", "ground calibration unverified"], style_keywords: ["2.5D", "pixel art"], diary_summary: "当天聚合日记", selected_events_summary: record.input, symbolic_anchor: input.candidate_plan?.symbolic_anchor || "", terrain_name: "完整图片地块", core_props: [] },
    request_status: record.status === "processing" ? "timed_out_or_pending_recovery" : record.status,
    provider_task_id: record.id, artifact_id: record.image?.assetId, image_url: record.image ? `/api/terrain-images/${record.id}` : undefined,
    created_at: record.createdAt, completed_at: record.status !== "processing" ? new Date(Date.parse(record.createdAt)+record.elapsedMs).toISOString() : undefined,
    error_message: record.error?.message, imageSize: record.image ? { width:record.image.width, height:record.image.height } : undefined, calibration: { status: "unverified", alphaVerified: false, targetGroundRatio: 752/448 }, cost_info: { image_count: record.image ? 1 : 0 } };
}
export class TerrainGeneration {
  constructor(settings, { storageRoot = join(PROJECT_ROOT,".local/terrain-candidates"), adapter, promptBuilder } = {}) { this.settings = settings; this.storageRoot = storageRoot; this.adapter = adapter; this.promptBuilder = promptBuilder; this.queue = Promise.resolve(); }
  service() { return new ImageGenerationService(this.settings.imageConfig(), { storageRoot: this.storageRoot, ...(this.adapter ? { adapter: this.adapter } : {}) }); }
  generate(input) {
    if (!input || !["candidate_1","candidate_2"].includes(input.candidate_id) || typeof input.planning_run_id !== "string" || !input.planning_run_id || input.planning_run_id.length > 200 || typeof input.snapshot?.input_text !== "string" || !input.candidate_plan) throw new ImageCardError("INPUT_INVALID", "候选需要当天快照、方案和独立批次。", 400);
    const id = input.client_request_id || stableRequestId(`${input.planning_run_id}:${input.candidate_id}`);
    if (!validId(id)) throw new ImageCardError("INPUT_INVALID", "生成请求 ID 无效。", 400);
    const config = this.settings.imageConfig();
    const operation = this.queue.then(async () => {
      const service = new ImageGenerationService(config, { storageRoot: this.storageRoot, ...(this.adapter ? { adapter: this.adapter } : {}), ...(this.promptBuilder ? { promptBuilder: this.promptBuilder } : {}) });
      const record = await service.generate({ requestId: id, description: terrainDescription(input), count: 1, mode: input.model_config?.provider === "mock" ? "mock" : "real" });
      return { job: jobFromTerrainRecord(record,input) };
    });
    this.queue = operation.then(() => undefined, () => undefined); return operation;
  }
  async query(input) { return { ...jobFromTerrainRecord(await this.service().record(input.provider_task_id),input), job_id: input.job_id }; }
  image(id) { return this.service().image(id); }
}
