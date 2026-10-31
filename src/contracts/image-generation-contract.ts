/**
 * Life Map V0.6-A — 真实 Qwen 图像生成契约与 Job 状态机定义
 */

import type { StageASnapshot } from "./dual-stage-contract.js";
import type { SymbolicSceneCandidatePlan } from "./dual-stage-contract.js";
import type { LabModelConfig } from "./dual-stage-contract.js";

export const IMAGE_CONTRACT_VERSION = "0.6.0" as const;

export type GenerationJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out_or_pending_recovery";

export interface ImageModelConfig {
  provider: "qwen" | "mock" | "custom";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export const DEFAULT_IMAGE_MODEL_PRESETS = {
  wanx: {
    provider: "qwen" as const,
    name: "阿里云百炼 (通义万相 2.1 极速版)",
    defaultModel: "wanx2.1-t2i-turbo",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
    tip: "使用百炼官方 wanx2.1-t2i-turbo 异步任务，支持自动转存本地持久化工件"
  },
  wanx_plus: {
    provider: "qwen" as const,
    name: "阿里云百炼 (通义万相 2.1 高画质版)",
    defaultModel: "wanx2.1-t2i-plus",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
    tip: "使用通义万相 2.1 高质感版文生图模型"
  },
  wanx_v1: {
    provider: "qwen" as const,
    name: "阿里云百炼 (通义万相经典版 V1)",
    defaultModel: "wanx-v1",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
    tip: "使用经典版 wanx-v1 文生图模型"
  },
  mock: {
    provider: "mock" as const,
    name: "离线确定性 2D 像素引擎 (Mock)",
    defaultModel: "deterministic-pixel-v0.6",
    defaultBaseUrl: "",
    tip: "无需 API Key，纯本地规则生成 RPG Tilemap 纯 2D 像素画，零 API 费用"
  }
};

export const INITIAL_IMAGE_MODEL_CONFIG: ImageModelConfig = {
  provider: "mock",
  model: "wanx2.1-t2i-turbo",
  apiKey: "",
  baseUrl: ""
};

export interface ImagePromptComposition {
  prompt_version: string;
  positive_prompt: string;
  negative_prompt: string;
  composition_hints: string[];
  style_keywords: string[];
  diary_summary: string;
  selected_events_summary: string;
  symbolic_anchor: string;
  terrain_name: string;
  core_props: string[];
}

export interface GenerationJob {
  manual_review?: { decision: "approved"; job_id: string; image_url: string; source_sha256?: string; reviewed_at: string };
  generation_route?: 'legacy-local'|'native-alpha'|'qwen-851';
  original_image_url?: string;
  background_removal?: { version:string; status:"ready"|"needs_review"|"failed"|"processing"; method:string; source_sha256?:string; transparent_fraction:number;warnings?:string[];message?:string;prediction_id?:string };
  calibration?: { status: "unverified"; alphaVerified: boolean; targetGroundRatio: number };
  imageSize?: { width: number; height: number };
  job_id: string;                         // 唯一任务标识，例如 "job_1729580000_c1"
  planning_run_id: string;                 // 关联的 Stage B 规划 ID / record_id
  candidate_id: "candidate_1" | "candidate_2";
  provider: "qwen" | "mock";
  model: string;                          // 如 "qwen-image-2.1-turbo" 或 "wanx2.1-t2i-turbo"
  prompt_version: string;
  submitted_prompt: ImagePromptComposition;
  request_status: GenerationJobStatus;
  provider_task_id?: string;              // 阿里云百炼 DashScope 异步任务 ID
  artifact_id?: string;                   // 本地持久化存储的图片标识，如 "art_img_..."
  image_url?: string;                     // 本地读取静态路由或数据 URL
  created_at: string;
  completed_at?: string;
  error_message?: string;
  cost_info?: {
    image_count: number;
    estimated_cost_cny?: number;
  };
}

export interface ImageGenerationRequest {
  image_pipeline?: {route:'legacy-local'|'native-alpha'|'qwen-851';model:string};
  candidate_id: "candidate_1" | "candidate_2";
  planning_run_id: string;
  snapshot: StageASnapshot;
  candidate_plan: SymbolicSceneCandidatePlan;
  model_config?: ImageModelConfig | LabModelConfig;
  prompt_override?: Partial<ImagePromptComposition>;
}

export interface ImageTaskQueryRequest {
  job_id: string;
  provider_task_id: string;
  candidate_id: "candidate_1" | "candidate_2";
  model_config?: ImageModelConfig | LabModelConfig;
}

export interface AdoptedSceneArtifactRecord {
  diary_date: string;
  snapshot_id: string;
  planning_run_id: string;
  candidate_id: "candidate_1" | "candidate_2";
  title: string;
  symbolic_anchor: string;
  artifact_id: string;
  image_url: string;
  prompt_summary: string;
  adopted_at: string;
}
