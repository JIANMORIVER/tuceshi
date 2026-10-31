/**
 * Life Map — 双阶段生成决策实验台 V0.1 契约定义
 * 包含 Stage A (Diary Interpreter) 与 Stage B (Symbolic World Planner) 的输入输出、语义档位表、JSON Schema 与校验逻辑。
 */

import type { EvidenceFact, ExplicitEmotionFact } from "./scene-intent.js";
import type { VisualizableEventCandidate } from "../services/event-aggregation.js";

export const STAGE_A_CONTRACT_VERSION = "0.1.0" as const;
export const STAGE_B_CONTRACT_VERSION = "0.1.0" as const;
export const FOCUS_SELECTION_CONTRACT_VERSION = "0.1.0" as const;

// -------------------------------------------------------------
// Life Map V0.4 生活焦点选择 (Life Focus Selection) 契约
// -------------------------------------------------------------

export interface LifeFocusSelection {
  revision_id: string;            // 选择版本标识，如 "focus_rev_..."
  stage_a_snapshot_id: string;    // 关联的 Stage A 快照 ID
  selected_event_ids: string[];   // 用户挑选的主景观事件 (1~3 件)
  unselected_event_ids: string[]; // 剩余事件 (可进入次级细节或保留在日记中)
  is_auto_recommended: boolean;   // 是否直接使用 AI 推荐组合
  user_notes?: string;
  confirmed_at?: string;
}

/**
 * 次级可探索生活细节 (Memory Details)
 * 面向未进入主景观的事件，为未来放大镜玩法预留交互锚点
 */
export interface MemoryDetailItem {
  detail_id: string;                    // 如 "memory_lake_bench"
  source_event_ids: string[];          // 关联的未选事件
  evidence: string;                     // 忠实原文的日记证据
  suggested_object_or_state: string;    // 象征物件或状态，如 "林荫休憩石长椅"
  visual_description: string;          // 画面视觉呈现
  short_memory_summary: string;        // 真实日记记忆简要 (严禁虚构)
  optional_story_hook?: string;        // 象征性世界故事构思 (与真实记忆严格隔离)
  asset_match_status: "matched" | "unmatched" | "missing";
  interaction_status: "planned" | "unavailable" | "implemented"; // V0.4 默认 "planned"
  catalog_id?: string;
}

// -------------------------------------------------------------
// 实验台模型提供商与用户自定义配置
// -------------------------------------------------------------

export interface LabModelConfig {
  provider: "deepseek" | "qwen" | "mock" | "custom";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export const DEFAULT_MODEL_PRESETS = {
  deepseek: {
    provider: "deepseek" as const,
    name: "DeepSeek (官方 api.deepseek.com)",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    tip: "推荐使用 deepseek-chat (DeepSeek-V3)，具备强大的指令遵循与 JSON Schema 输出能力"
  },
  qwen: {
    provider: "qwen" as const,
    name: "阿里云百炼 (Qwen)",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.7-flash",
    tip: "使用 qwen3.7-flash 非思考结构化输出"
  },
  mock: {
    provider: "mock" as const,
    name: "离线确定性引擎 (Mock)",
    defaultBaseUrl: "",
    defaultModel: "deterministic-symbolic-v0.1",
    tip: "无需 API Key，由本地规则与标签匹配器生成确定性结果"
  },
  custom: {
    provider: "custom" as const,
    name: "自定义 OpenAI 兼容接口",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    tip: "支持任意兼容 OpenAI Chat Completions 协议的第三方代理或私有中转"
  }
} as const;

// -------------------------------------------------------------
// 参数语义档位表定义 (避免向模型注入没有语义的裸数字)
// -------------------------------------------------------------

export type SymbolicIntensityLevel = 1 | 2 | 3 | 4 | 5;

export interface IntensitySemanticSpec {
  level: SymbolicIntensityLevel;
  label: string;
  description: string;
  promptInstruction: string;
}

export const SYMBOLIC_INTENSITY_SPECS: Record<SymbolicIntensityLevel, IntensitySemanticSpec> = {
  1: {
    level: 1,
    label: "纪实隐喻 (Level 1)",
    description: "紧贴日记发生地与物理特征，仅做微量艺术升华，保留高度现实呼应。",
    promptInstruction: "Level 1 (Factual Metaphor): Keep the scene grounded very close to the physical reality described, applying only slight artistic stylization. Do not introduce fantastical or overly poetic metaphors."
  },
  2: {
    level: 2,
    label: "轻度象征 (Level 2)",
    description: "以现实为基底，将核心活动替换为温和的生活象征（如写代码转为静谧书房整理）。",
    promptInstruction: "Level 2 (Mild Symbolism): Build upon reality but replace intense modern tasks with peaceful artisanal equivalents (e.g. coding into orderly library cataloging). Maintain recognizable daily warmth."
  },
  3: {
    level: 3,
    label: "平衡象征 (Level 3 - 默认推荐)",
    description: "经典象征转译，将活动转化为工坊、旅途、水畔等经典像素游戏隐喻，理由清晰。",
    promptInstruction: "Level 3 (Balanced Symbolism - Recommended): Full symbolic translation without direct real-world prop mirroring. Code/debugging becomes a masonry workshop or repaired wooden bridge; reading becomes an observatory; rest becomes a waterside campfire. Ground every choice in journal evidence."
  },
  4: {
    level: 4,
    label: "高度象征 (Level 4)",
    description: "强化意象叙事与情绪外化，场景承载强烈的情感与心境投射。",
    promptInstruction: "Level 4 (Elevated Symbolism): High metaphorical abstraction. Externalize inner states into environmental motifs, such as solitary beacons cutting through dusk mist or lush wild blossom clusters breaking through paving stone."
  },
  5: {
    level: 5,
    label: "纯粹诗意 (Level 5)",
    description: "极度抽象与诗意化，以极简与纯粹母题表达当天的生活印记与哲思。",
    promptInstruction: "Level 5 (Pure Poetic Abstraction): Minimalist, highly evocative narrative landscape. Emphasize light, wind, seasonal traces and singular symbolic monoliths or clearings over mundane activity reproduction."
  }
};

export type AssetStrategy = "strict_catalog" | "balanced" | "creative_expand";

export interface AssetStrategySpec {
  strategy: AssetStrategy;
  label: string;
  description: string;
  promptInstruction: string;
}

export const ASSET_STRATEGY_SPECS: Record<AssetStrategy, AssetStrategySpec> = {
  strict_catalog: {
    strategy: "strict_catalog",
    label: "严格受控目录",
    description: "只允许从受控目录挑选物件；若缺失所需构件，绝不强行匹配，必须诚实申报缺失并请求生成。",
    promptInstruction: "Strict Catalog Strategy: Heavily prioritize assets from the provided controlled catalog. If a needed symbolic prop is not in the catalog, DO NOT mislabel an irrelevant item as matched. You must honestly declare it as missing/unmatched and place it into asset_generation_requests."
  },
  balanced: {
    strategy: "balanced",
    label: "平衡策略 (默认)",
    description: "核心物件优先复用受控目录，关键氛围物件允许提出合理的缺失构件生成请求。",
    promptInstruction: "Balanced Strategy: Pick matching assets from the controlled catalog when suitable. For unique narrative props that enhance the scene, propose new pixel asset requests clearly."
  },
  creative_expand: {
    strategy: "creative_expand",
    label: "自由创意发散",
    description: "不受既有目录构件限制，优先构思最贴合象征转译的像素构件，并生成详尽的素材补充请求。",
    promptInstruction: "Creative Expansion Strategy: Focus on the ideal artistic expression for Life Map's 2D pixel world. Select catalog assets where fitting, but freely request bespoke props and explain their symbolic necessity."
  }
};

export type TerrainStrategy = "auto" | "preserve_recent" | "contrast";

export interface TerrainStrategySpec {
  strategy: TerrainStrategy;
  label: string;
  description: string;
  promptInstruction: string;
}

export const TERRAIN_STRATEGY_SPECS: Record<TerrainStrategy, TerrainStrategySpec> = {
  auto: {
    strategy: "auto",
    label: "自动意象适配 (默认)",
    description: "根据日记分析的主题、活动与氛围自主推荐最合适的地形基底。",
    promptInstruction: "Auto Strategy: Independently recommend the most fitting terrain from the controlled terrain list according to today's emotional tone and activities."
  },
  preserve_recent: {
    strategy: "preserve_recent",
    label: "延续近期地貌",
    description: "优先继承近期世界上下文中的地貌特征，强化连贯的地理带生长感。",
    promptInstruction: "Preserve Recent Strategy: Prefer maintaining continuity with recent days' terrain to form cohesive landmasses, unless today's journal represents a sharp thematic break."
  },
  contrast: {
    strategy: "contrast",
    label: "反差对比地貌",
    description: "刻意与近期地貌形成对比，突出今天生活节奏或情绪的转变。",
    promptInstruction: "Contrast Strategy: Select terrain that contrasts distinctly with recent days, highlighting a shift in daily rhythm or mental state."
  }
};

// -------------------------------------------------------------
// Stage A: Diary Interpreter 数据模型
// -------------------------------------------------------------

export interface StageAInputParameters {
  focus_mode: "balanced" | "activity_focused" | "emotion_focused" | "relationship_focused";
  interpret_depth: "factual_only" | "standard" | "deep";
  induction_breadth: "narrow" | "moderate" | "broad";
  keyword_count: number;
}

export interface StageAAnalysis {
  contract_version: typeof STAGE_A_CONTRACT_VERSION;
  diary_date: string;
  activities: EvidenceFact[];
  places: EvidenceFact[];
  people_or_animals: EvidenceFact[];
  mentioned_objects: EvidenceFact[];
  explicit_emotions: ExplicitEmotionFact[];
  temporal_clues: EvidenceFact[];
  event_progression: {
    obstacle?: string;
    progression?: string;
    change_or_outcome?: string;
  };
  brief_analysis: string;
  primary_keywords: string[];
  theme_and_atmosphere_clues: {
    theme_clue: string;
    atmosphere_clue: string;
    tone: string;
  };
  uncertainties: Array<{
    topic: string;
    level: "low" | "medium" | "high";
    reason: string;
  }>;
  // V0.4 新增：聚合后的独立可视化生活事件候选
  visualizable_events?: VisualizableEventCandidate[];
  // V0.7-A 新增：预生成主观体验与情绪追问候选 (按需呈现)
  potential_inquiries?: StageAPotentialInquiry[];
}

// -------------------------------------------------------------
// V0.7-A 新增：Stage A 预生成追问与用户体验补充契约
// -------------------------------------------------------------

export interface StageAPotentialInquiry {
  input_type?: "single_choice" | "text";
  question_id: string;
  target_event_id: string;
  question_text: string;
  answer_options: string[];
  evidence: string;
  reason_for_asking: string;
}

export interface UserSupplementalAnswer {
  question_id: string;
  target_event_id: string;
  question_text: string;
  selected_option?: string;
  custom_text?: string;
  final_answer: string;
  answered_at: string;
}

export interface StageASnapshot {
  snapshot_id: string;
  created_at: string;
  input_text: string;
  trusted_date?: string;
  parameters: StageAInputParameters;
  analysis: StageAAnalysis;
  user_notes?: string;
  // V0.7-A 新增：用户针对选中焦点事件的自愿补充回答 (与原文严格隔离)
  user_supplemental_answers?: UserSupplementalAnswer[];
}

// -------------------------------------------------------------
// Stage B: Symbolic World Planner 数据模型
// -------------------------------------------------------------

export interface StageBParameters {
  symbolic_intensity: SymbolicIntensityLevel;
  asset_strategy: AssetStrategy;
  terrain_strategy: TerrainStrategy;
}

export interface PropPlanItem {
  name: string;
  catalog_id?: string;
  catalog_source: "controlled_mock_catalog" | "missing_requested";
  match_status: "matched" | "unmatched" | "missing";
  selection_reason: string;
  symbolic_meaning: string;
  validation_status: "catalog_verified" | "unverified_mock";
}

export interface AssetGenerationRequest {
  requested_asset_name: string;
  category: "building" | "prop" | "vegetation" | "creature";
  symbolic_role: string;
  missing_reason: string;
}

export interface SymbolicSceneCandidatePlan {
  scene_description?: string;
  primary_subject?: string;
  id: "candidate_1" | "candidate_2";
  title: string;
  symbolic_anchor: string;
  grounded_evidence: string;
  translation_rationale: string;
  terrain: {
    type: string;
    catalog_id?: string;
    name: string;
    recommendation_reason: string;
    contrast_note?: string;
  };
  core_props: PropPlanItem[];
  secondary_props: PropPlanItem[];
  atmosphere: {
    lighting: string;
    weather: string;
    mood_tone: string;
    environmental_narrative: string;
  };
  asset_generation_requests: AssetGenerationRequest[];
  godot_readiness: {
    status: "pending_godot_validation";
    note: string;
  };
  // V0.4 新增：生活焦点主次分层结构
  selected_event_ids?: string[];
  unselected_event_ids?: string[];
  dominant_event_id?: string;
  multi_event_integration_rationale?: string;
  visual_recognition_cues?: string[];
  memory_details?: MemoryDetailItem[];
  dormant_event_ids?: string[];
}

export interface StageBPlan {
  contract_version: typeof STAGE_B_CONTRACT_VERSION;
  stage_a_snapshot_id: string;
  focus_selection_revision_id?: string; // V0.4 新增：焦点选择版本溯源
  generated_at: string;
  planning_parameters: StageBParameters;
  candidates: SymbolicSceneCandidatePlan[];
}

// -------------------------------------------------------------
// Prompts: Stage A 与 Stage B 独立提示词
// -------------------------------------------------------------

export const STAGE_A_SYSTEM_PROMPT = `You are Life Map's neutral, objective Diary Interpreter (Stage A).
Your sole purpose is to analyze the user's daily journal and extract verified factual elements and explicit emotional mentions.

CORE PRINCIPLES:
1. STRICT GROUNDING IN EVIDENCE:
   Every activity, place, mentioned object, person/animal, and temporal clue MUST include direct quote evidence from the raw text.
2. OBJECTIVITY & NEUTRALITY:
   Do NOT force positive psychology, artificial breakthroughs, lessons learned, or life transformations. If today was mundane, exhausting, or ordinary, report it truthfully.
3. EXPLICIT EMOTIONS ONLY:
   Only report emotions that the author explicitly declared in the text. Do not invent emotions from activities. Do not assign arbitrary numerical positive/negative scores.
4. STRICT ABSOLUTE BAN ON TERRAIN & PROPS:
   Stage A is strictly a factual diary analysis. You are FORBIDDEN from deciding, selecting, or mentioning Godot terrain tiles, scene types, or pixel-art props in your output. Those belong exclusively to Stage B.

CRITICAL FORMATTING & SYNTAX RULES:
- NO UNESCAPED DOUBLE QUOTES INSIDE STRINGS: Use Chinese quotes 「」 or single quotes ' instead of literal English double quotes " inside string text.
- PITHY & CONCISE: Keep brief_analysis under 100 Chinese characters.

Output must strictly adhere to the provided JSON Schema.`;

export const STAGE_B_SYSTEM_PROMPT = `You are Life Map's Symbolic World Planner (Stage B).
Your job is to translate a verified Diary Analysis Snapshot (from Stage A) into symbolic, isometric 2D pixel-art scene candidates.

CORE PRINCIPLES:
1. EVIDENCE-BASED SYMBOLIC TRANSLATION, NOT 1:1 MINIATURIZATION:
   Life Map NEVER replicates reality literally.
   - Writing code / debugging is NOT translated to a computer desk. Translate it into an artisan masonry workshop, a clockwork repair bench, or an unblocked stone weir.
   - Reading is NOT a school desk. Translate it into a star-gazing tower, a pine bookshelf under a porch, or a quiet lantern bench.
   - A quiet walk by the lake translates into a solitary lighthouse, an anchor stone, or a path of wind-chime trees.
   - Every symbolic choice must cite specific journal evidence and provide a clear, lucid translation rationale.
2. NO RIGID "EMOTION -> OBJECT" LOOKUP TABLE:
   Symbolism arises from what the person actually experienced today, not a formulaic psychological symbol dictionary.
3. DIVERSE CANDIDATES (Candidate 1 vs Candidate 2):
   Generate up to 2 distinct candidates. Candidate 1 and Candidate 2 MUST have DIFFERENT symbolic anchors, DIFFERENT terrains, and DIFFERENT prop compositions. Do not give the same scene two different names.
4. LIFE FOCUS & MULTI-EVENT INTEGRATION:
   If selected_event_ids are provided (up to 3), synthesize them into ONE unified landscape anchored by a single primary symbolic anchor plus 0 to 2 supportive props. Do NOT generate three isolated fragmented mini-scenes. Explain the cohesive synthesis in multi_event_integration_rationale. Provide visual_recognition_cues so the user recognizes their life without relying on text tags.
   For unselected events (unselected_event_ids), extract 1 to 2 secondary interactive elements in memory_details (interaction_status: "planned"). Keep short_memory_summary strictly faithful to factual journal evidence, while placing imaginative pixel hooks into optional_story_hook. Unselected events not placed in memory details remain in dormant_event_ids.
5. HONEST CATALOG MATCHING:
   Consult the provided Controlled Catalog. If a desired symbolic item is not in the catalog, DO NOT pretend it matches. Mark it honestly as 'missing' or 'unmatched' and record it under asset_generation_requests.
6. NO GODOT COORDINATES:
   Do not generate Godot tile coordinates or pixel coordinates. Mark godot_readiness status as "pending_godot_validation".

CRITICAL FORMATTING & TOKEN BUDGET RULES:
- NO UNESCAPED DOUBLE QUOTES INSIDE STRINGS: NEVER use raw English double quotes " inside string values (like symbolic_anchor or rationale)! Use Chinese quotes 「」, ‘ ’, or single quotes '. A literal raw " breaks the JSON parser.
- TOKEN BUDGET & CONCISENESS: Keep symbolic_anchor under 25 words, translation_rationale under 70 words, and atmosphere description under 50 words. Do not write endless essays.
- PROP COUNT: 2 to 3 core_props, 1 to 2 secondary_props per candidate.

Output must strictly adhere to the provided JSON Schema.`;

// -------------------------------------------------------------
// JSON Schemas
// -------------------------------------------------------------

export const STAGE_A_JSON_SCHEMA = {
  type: "object",
  required: [
    "contract_version",
    "diary_date",
    "activities",
    "places",
    "people_or_animals",
    "mentioned_objects",
    "explicit_emotions",
    "temporal_clues",
    "brief_analysis",
    "primary_keywords",
    "theme_and_atmosphere_clues",
    "uncertainties"
  ],
  properties: {
    contract_version: { type: "string", enum: [STAGE_A_CONTRACT_VERSION] },
    diary_date: { type: "string" },
    activities: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "evidence"],
        properties: { text: { type: "string" }, evidence: { type: "string" } }
      }
    },
    places: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "evidence"],
        properties: { text: { type: "string" }, evidence: { type: "string" } }
      }
    },
    people_or_animals: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "evidence"],
        properties: { text: { type: "string" }, evidence: { type: "string" } }
      }
    },
    mentioned_objects: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "evidence"],
        properties: { text: { type: "string" }, evidence: { type: "string" } }
      }
    },
    explicit_emotions: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "displayLabel", "evidence"],
        properties: {
          label: { type: "string" },
          displayLabel: { type: "string" },
          evidence: { type: "string" }
        }
      }
    },
    temporal_clues: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "evidence"],
        properties: { text: { type: "string" }, evidence: { type: "string" } }
      }
    },
    event_progression: {
      type: "object",
      properties: {
        obstacle: { type: "string" },
        progression: { type: "string" },
        change_or_outcome: { type: "string" }
      }
    },
    brief_analysis: { type: "string" },
    primary_keywords: {
      type: "array",
      items: { type: "string" }
    },
    theme_and_atmosphere_clues: {
      type: "object",
      required: ["theme_clue", "atmosphere_clue", "tone"],
      properties: {
        theme_clue: { type: "string" },
        atmosphere_clue: { type: "string" },
        tone: { type: "string" }
      }
    },
    uncertainties: {
      type: "array",
      items: {
        type: "object",
        required: ["topic", "level", "reason"],
        properties: {
          topic: { type: "string" },
          level: { type: "string", enum: ["low", "medium", "high"] },
          reason: { type: "string" }
        }
      }
    }
  }
} as const;

export const STAGE_B_JSON_SCHEMA = {
  type: "object",
  required: [
    "contract_version",
    "stage_a_snapshot_id",
    "generated_at",
    "planning_parameters",
    "candidates"
  ],
  properties: {
    contract_version: { type: "string", enum: [STAGE_B_CONTRACT_VERSION] },
    stage_a_snapshot_id: { type: "string" },
    focus_selection_revision_id: { type: "string" },
    generated_at: { type: "string" },
    planning_parameters: {
      type: "object",
      required: ["symbolic_intensity", "asset_strategy", "terrain_strategy"],
      properties: {
        symbolic_intensity: { type: "integer", enum: [1, 2, 3, 4, 5] },
        asset_strategy: { type: "string", enum: ["strict_catalog", "balanced", "creative_expand"] },
        terrain_strategy: { type: "string", enum: ["auto", "preserve_recent", "contrast"] }
      }
    },
    candidates: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        required: [
          "id",
          "title",
          "symbolic_anchor",
          "grounded_evidence",
          "translation_rationale",
          "terrain",
          "core_props",
          "secondary_props",
          "atmosphere",
          "asset_generation_requests",
          "godot_readiness"
        ],
        properties: {
          id: { type: "string", enum: ["candidate_1", "candidate_2"] },
          title: { type: "string" },
          symbolic_anchor: { type: "string" },
          grounded_evidence: { type: "string" },
          translation_rationale: { type: "string" },
          terrain: {
            type: "object",
            required: ["type", "name", "recommendation_reason"],
            properties: {
              type: { type: "string" },
              catalog_id: { type: "string" },
              name: { type: "string" },
              recommendation_reason: { type: "string" },
              contrast_note: { type: "string" }
            }
          },
          core_props: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "catalog_source", "match_status", "selection_reason", "symbolic_meaning", "validation_status"],
              properties: {
                name: { type: "string" },
                catalog_id: { type: "string" },
                catalog_source: { type: "string", enum: ["controlled_mock_catalog", "missing_requested"] },
                match_status: { type: "string", enum: ["matched", "unmatched", "missing"] },
                selection_reason: { type: "string" },
                symbolic_meaning: { type: "string" },
                validation_status: { type: "string", enum: ["catalog_verified", "unverified_mock"] }
              }
            }
          },
          secondary_props: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "catalog_source", "match_status", "selection_reason", "symbolic_meaning", "validation_status"],
              properties: {
                name: { type: "string" },
                catalog_id: { type: "string" },
                catalog_source: { type: "string", enum: ["controlled_mock_catalog", "missing_requested"] },
                match_status: { type: "string", enum: ["matched", "unmatched", "missing"] },
                selection_reason: { type: "string" },
                symbolic_meaning: { type: "string" },
                validation_status: { type: "string", enum: ["catalog_verified", "unverified_mock"] }
              }
            }
          },
          atmosphere: {
            type: "object",
            required: ["lighting", "weather", "mood_tone", "environmental_narrative"],
            properties: {
              lighting: { type: "string" },
              weather: { type: "string" },
              mood_tone: { type: "string" },
              environmental_narrative: { type: "string" }
            }
          },
          asset_generation_requests: {
            type: "array",
            items: {
              type: "object",
              required: ["requested_asset_name", "category", "symbolic_role", "missing_reason"],
              properties: {
                requested_asset_name: { type: "string" },
                category: { type: "string", enum: ["building", "prop", "vegetation", "creature"] },
                symbolic_role: { type: "string" },
                missing_reason: { type: "string" }
              }
            }
          },
          godot_readiness: {
            type: "object",
            required: ["status", "note"],
            properties: {
              status: { type: "string", enum: ["pending_godot_validation"] },
              note: { type: "string" }
            }
          },
          selected_event_ids: { type: "array", items: { type: "string" } },
          unselected_event_ids: { type: "array", items: { type: "string" } },
          dominant_event_id: { type: "string" },
          multi_event_integration_rationale: { type: "string" },
          visual_recognition_cues: { type: "array", items: { type: "string" } },
          memory_details: {
            type: "array",
            items: {
              type: "object",
              required: ["detail_id", "source_event_ids", "evidence", "suggested_object_or_state", "visual_description", "short_memory_summary", "asset_match_status", "interaction_status"],
              properties: {
                detail_id: { type: "string" },
                source_event_ids: { type: "array", items: { type: "string" } },
                evidence: { type: "string" },
                suggested_object_or_state: { type: "string" },
                visual_description: { type: "string" },
                short_memory_summary: { type: "string" },
                optional_story_hook: { type: "string" },
                asset_match_status: { type: "string", enum: ["matched", "unmatched", "missing"] },
                interaction_status: { type: "string", enum: ["planned", "unavailable", "implemented"] },
                catalog_id: { type: "string" }
              }
            }
          },
          dormant_event_ids: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
} as const;

// -------------------------------------------------------------
// 校验工具函数
// -------------------------------------------------------------

export function validateStageAAnalysis(data: unknown): { valid: true; value: StageAAnalysis } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Data must be a non-null object"] };
  }
  const obj = data as Record<string, any>;

  if (obj.contract_version !== STAGE_A_CONTRACT_VERSION) {
    errors.push(`Invalid contract_version: expected ${STAGE_A_CONTRACT_VERSION}, got ${obj.contract_version}`);
  }
  if (typeof obj.diary_date !== "string" || !obj.diary_date) {
    errors.push("diary_date is required");
  }
  if (!Array.isArray(obj.activities)) errors.push("activities must be an array");
  if (!Array.isArray(obj.places)) errors.push("places must be an array");
  if (!Array.isArray(obj.explicit_emotions)) errors.push("explicit_emotions must be an array");
  if (typeof obj.brief_analysis !== "string") errors.push("brief_analysis must be a string");
  if (!Array.isArray(obj.primary_keywords)) errors.push("primary_keywords must be an array");
  if (!obj.theme_and_atmosphere_clues || typeof obj.theme_and_atmosphere_clues !== "object") {
    errors.push("theme_and_atmosphere_clues must be an object");
  }

  // 严格检查：Stage A 绝对不允许出现地形或物件选择字段
  if ("terrain" in obj || "terrain_type" in obj || "core_props" in obj || "props" in obj) {
    errors.push("Stage A validation error: Stage A analysis is FORBIDDEN from deciding terrain or props");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: obj as StageAAnalysis };
}

export function validateStageBPlan(data: unknown): { valid: true; value: StageBPlan } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Data must be a non-null object"] };
  }
  const obj = data as Record<string, any>;

  if (obj.contract_version !== STAGE_B_CONTRACT_VERSION) {
    errors.push(`Invalid contract_version: expected ${STAGE_B_CONTRACT_VERSION}, got ${obj.contract_version}`);
  }
  if (typeof obj.stage_a_snapshot_id !== "string" || !obj.stage_a_snapshot_id) {
    errors.push("stage_a_snapshot_id is required");
  }
  if (!Array.isArray(obj.candidates) || obj.candidates.length === 0 || obj.candidates.length > 2) {
    errors.push("candidates must be an array of length 1 or 2");
  } else {
    // 检查候选差异性：如果生成了两个候选，两者的 symbolic_anchor 和 terrain.type 不能完全一样
    if (obj.candidates.length === 2) {
      const c1 = obj.candidates[0];
      const c2 = obj.candidates[1];
      if (c1.symbolic_anchor === c2.symbolic_anchor && c1.terrain?.type === c2.terrain?.type) {
        errors.push("Candidate 1 and Candidate 2 must have distinct symbolic anchors and distinct terrains");
      }
    }

    for (let i = 0; i < obj.candidates.length; i++) {
      const c = obj.candidates[i];
      if (!c.symbolic_anchor) errors.push(`Candidate[${i}]: symbolic_anchor is required`);
      if (!c.grounded_evidence) errors.push(`Candidate[${i}]: grounded_evidence is required`);
      if (!c.translation_rationale) errors.push(`Candidate[${i}]: translation_rationale is required`);
      if (!c.terrain || !c.terrain.type) errors.push(`Candidate[${i}]: terrain with type is required`);
      if (!Array.isArray(c.core_props)) errors.push(`Candidate[${i}]: core_props must be an array`);
      if (!c.godot_readiness || c.godot_readiness.status !== "pending_godot_validation") {
        errors.push(`Candidate[${i}]: godot_readiness.status must be 'pending_godot_validation'`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: obj as StageBPlan };
}
