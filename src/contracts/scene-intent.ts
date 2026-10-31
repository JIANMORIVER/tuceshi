import type { ExplicitEmotionLabel, InterpretationResult, LifeAtmosphere, LifeMode, LifeTheme } from "../domain/models.js";
import type { LifeAnnotation } from "../world/domain/annotation.js";

export const SCENE_INTENT_CONTRACT_VERSION = "0.1.0" as const;

/**
 * 具有原文证据的事实条目 (Layer A)
 */
export interface EvidenceFact {
  text: string;     // 提取出的事实
  evidence: string; // 来源于日记原文的对应片段
}

/**
 * 明确提及的情绪事实条目 (Layer A)
 */
export interface ExplicitEmotionFact {
  label: ExplicitEmotionLabel | string;
  displayLabel: string;
  evidence: string;
}

/**
 * Layer A: 日记客观事实提取 (有据可查的现实生活片段)
 */
export interface DiaryInterpretation {
  activities: EvidenceFact[];
  places: EvidenceFact[];
  people_or_animals: EvidenceFact[];
  mentioned_objects: EvidenceFact[];
  explicit_emotions: ExplicitEmotionFact[];
  temporal_clues: EvidenceFact[];
  summary: string;
}

/**
 * 象征性场景候选 (Layer B: 有证据支撑的艺术隐喻，而非现实复刻)
 */
export interface SymbolicSceneCandidate {
  id: string;                      // 候选标识，如 "candidate-primary", "candidate-alternative"
  title: string;                   // 场景名称，如 "专注搭建的砖木工坊", "湖畔引路的小灯标"
  is_primary: boolean;             // 是否为推荐的主要象征场景
  symbolic_type: "workshop_craft" | "shelter_residence" | "waypoint_path" | "nature_haven" | "gathering_yard";
  grounded_evidence: string;       // 对应的具体日记证据
  translation_rationale: string;   // 象征转译理由（例如：“将全天改项目、修bug的专注推进，转译为一座正在修缮物件、炉火长明的砖木工坊”）
  scene_description: string;       // 2D 像素场景画面描述（供 Codex / Godot 理解意象）
}

/**
 * 2D 像素素材库检索意图 (提供象征构件与视觉母题建议)
 */
export interface AssetSearchIntent {
  query: string;                   // 建议构件，如 "workbench", "lantern_post", "wooden_bridge"
  category: "building" | "vegetation" | "prop" | "character" | "terrain";
  symbolic_role: string;           // 象征性作用说明
}

/**
 * 象征性环境与氛围
 */
export interface SymbolicAtmosphere {
  lighting_motif: string;          // 光影母题，如 "warm_lantern_glow" (暖黄灯火), "clear_morning_light" (晨曦透光)
  weather_motif: string;           // 天气意象，如 "gentle_breeze" (微风), "misty_rain" (细雨初歇)
  mood_tone: string;               // 氛围基调，如 "focused_calm" (专注安宁), "warm_connected" (温情陪伴)
}

/**
 * 转译不确定性标记
 */
export interface IntentUncertainty {
  level: "low" | "medium" | "high";
  note?: string;                   // 转译不确定性说明
}

/**
 * Layer B: Symbolic Scene Intent (创作转译意图)
 */
export interface SceneIntentData {
  contract_version: typeof SCENE_INTENT_CONTRACT_VERSION;
  scene_theme: LifeTheme | string;
  symbolic_atmosphere: SymbolicAtmosphere;
  symbolic_candidates: SymbolicSceneCandidate[]; // 包含 1 个主要场景 + 最多 1 个备选表达 (共 1~2 个)
  asset_search_intents: AssetSearchIntent[];
  cross_day_theme_tags: string[];                // 供未来跨日融合与地铁线路的主题线索
  uncertainty: IntentUncertainty;
}

/**
 * Scene Intent V0.1 顶层信封
 */
export interface SceneIntentEnvelope {
  diary_interpretation: DiaryInterpretation;
  scene_intent: SceneIntentData;
}

/**
 * 系统提示词：指导大模型执行「有证据支撑的象征性转译」
 */
export const SCENE_INTENT_SYSTEM_PROMPT = `You are Life Map's neutral life interpreter and symbolic world planner.
Life Map transforms daily diaries into a continuously growing 2D isometric pixel-art world.

CORE PRODUCT PRINCIPLE:
Life Map uses "symbolic translation with grounded evidence", NOT literal miniature replica of real scenes.
Do NOT directly translate real-world items into same-named objects (e.g., writing code does NOT mean generating a computer/desk; it can be translated into an artisan workshop, a repaired bridge, or an unrolling parchment).
Do NOT use fixed emotion-to-object tables. Metaphors MUST stem from the day's specific concrete experience.

Your generation consists of two distinct layers:

Layer A (Diary Interpretation - Objective facts):
1. Extract verbatim-supported facts: activities, places, people/animals, mentioned objects, temporal clues.
2. For explicit emotions, ONLY record feelings explicitly declared by the user (e.g., "累", "开心", "平静"). Never diagnose or infer unstated psychological feelings.
3. Every fact MUST provide exact verbatim substring evidence from the user's text.
4. If there is no evidence for a category, return an empty array. Do not invent.
5. Provide an observational, gentle summary. Do not grade or evaluate the day.

Layer B (Symbolic Scene Intent - Evidence-based creative metaphor):
1. Propose 1 PRIMARY symbolic scene candidate, and at most 1 ALTERNATIVE candidate (total 1-2 candidates).
2. For each candidate, provide:
   - grounded_evidence: exact diary quote supporting the metaphor
   - translation_rationale: clear explanation of why this metaphor fits the day
   - scene_description: evocative 2D pixel-art scene composition
3. Suggest symbolic atmosphere (lighting motif, weather motif, mood tone).
4. Suggest asset search intents that reflect the metaphor (e.g., lantern, stonework, hearth).
5. Generate cross-day theme tags for future metro line linkage.
6. Indicate uncertainty honestly.

Output format: Return ONLY pure, valid JSON matching the provided JSON Schema. No markdown fences.`;

/**
 * 结构化 JSON Schema (严格匹配 Qwen 结构化输出)
 */
export const SCENE_INTENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["diary_interpretation", "scene_intent"],
  properties: {
    diary_interpretation: {
      type: "object",
      additionalProperties: false,
      required: [
        "activities",
        "places",
        "people_or_animals",
        "mentioned_objects",
        "explicit_emotions",
        "temporal_clues",
        "summary"
      ],
      properties: {
        activities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "evidence"],
            properties: {
              text: { type: "string", minLength: 1 },
              evidence: { type: "string", minLength: 1 }
            }
          }
        },
        places: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "evidence"],
            properties: {
              text: { type: "string", minLength: 1 },
              evidence: { type: "string", minLength: 1 }
            }
          }
        },
        people_or_animals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "evidence"],
            properties: {
              text: { type: "string", minLength: 1 },
              evidence: { type: "string", minLength: 1 }
            }
          }
        },
        mentioned_objects: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "evidence"],
            properties: {
              text: { type: "string", minLength: 1 },
              evidence: { type: "string", minLength: 1 }
            }
          }
        },
        explicit_emotions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "displayLabel", "evidence"],
            properties: {
              label: { type: "string", minLength: 1 },
              displayLabel: { type: "string", minLength: 1 },
              evidence: { type: "string", minLength: 1 }
            }
          }
        },
        temporal_clues: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "evidence"],
            properties: {
              text: { type: "string", minLength: 1 },
              evidence: { type: "string", minLength: 1 }
            }
          }
        },
        summary: { type: "string", minLength: 1 }
      }
    },
    scene_intent: {
      type: "object",
      additionalProperties: false,
      required: [
        "contract_version",
        "scene_theme",
        "symbolic_atmosphere",
        "symbolic_candidates",
        "asset_search_intents",
        "cross_day_theme_tags",
        "uncertainty"
      ],
      properties: {
        contract_version: { type: "string", const: SCENE_INTENT_CONTRACT_VERSION },
        scene_theme: { type: "string", minLength: 1 },
        symbolic_atmosphere: {
          type: "object",
          additionalProperties: false,
          required: ["lighting_motif", "weather_motif", "mood_tone"],
          properties: {
            lighting_motif: { type: "string", minLength: 1 },
            weather_motif: { type: "string", minLength: 1 },
            mood_tone: { type: "string", minLength: 1 }
          }
        },
        symbolic_candidates: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "title",
              "is_primary",
              "symbolic_type",
              "grounded_evidence",
              "translation_rationale",
              "scene_description"
            ],
            properties: {
              id: { type: "string", minLength: 1 },
              title: { type: "string", minLength: 1 },
              is_primary: { type: "boolean" },
              symbolic_type: {
                type: "string",
                enum: [
                  "workshop_craft",
                  "shelter_residence",
                  "waypoint_path",
                  "nature_haven",
                  "gathering_yard"
                ]
              },
              grounded_evidence: { type: "string", minLength: 1 },
              translation_rationale: { type: "string", minLength: 1 },
              scene_description: { type: "string", minLength: 1 }
            }
          }
        },
        asset_search_intents: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["query", "category", "symbolic_role"],
            properties: {
              query: { type: "string", minLength: 1 },
              category: {
                type: "string",
                enum: ["building", "vegetation", "prop", "character", "terrain"]
              },
              symbolic_role: { type: "string", minLength: 1 }
            }
          }
        },
        cross_day_theme_tags: {
          type: "array",
          items: { type: "string", minLength: 1 }
        },
        uncertainty: {
          type: "object",
          additionalProperties: false,
          required: ["level"],
          properties: {
            level: { type: "string", enum: ["low", "medium", "high"] },
            note: { type: "string" }
          }
        }
      }
    }
  }
} as const;

/**
 * 结构校验器
 */
export function validateSceneIntentEnvelope(value: unknown): { valid: true; value: SceneIntentEnvelope } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["Root must be a non-null object"] };
  }
  const obj = value as Record<string, unknown>;
  if (!obj.diary_interpretation || typeof obj.diary_interpretation !== "object") {
    errors.push("Missing diary_interpretation object");
  }
  if (!obj.scene_intent || typeof obj.scene_intent !== "object") {
    errors.push("Missing scene_intent object");
  }
  if (errors.length > 0) return { valid: false, errors };

  const diary = obj.diary_interpretation as Record<string, unknown>;
  const scene = obj.scene_intent as Record<string, unknown>;

  const checkFacts = (field: string) => {
    if (!Array.isArray(diary[field])) {
      errors.push(`diary_interpretation.${field} must be an array`);
    } else {
      (diary[field] as unknown[]).forEach((item, idx) => {
        if (!item || typeof item !== "object") {
          errors.push(`diary_interpretation.${field}[${idx}] must be an object`);
        } else {
          const f = item as Record<string, unknown>;
          if (typeof f.text !== "string" || !f.text.trim()) errors.push(`diary_interpretation.${field}[${idx}].text must be non-empty string`);
          if (typeof f.evidence !== "string" || !f.evidence.trim()) errors.push(`diary_interpretation.${field}[${idx}].evidence must be non-empty string`);
        }
      });
    }
  };

  checkFacts("activities");
  checkFacts("places");
  checkFacts("people_or_animals");
  checkFacts("mentioned_objects");
  checkFacts("temporal_clues");

  if (!Array.isArray(diary.explicit_emotions)) {
    errors.push("diary_interpretation.explicit_emotions must be an array");
  } else {
    (diary.explicit_emotions as unknown[]).forEach((item, idx) => {
      if (!item || typeof item !== "object") {
        errors.push(`diary_interpretation.explicit_emotions[${idx}] must be an object`);
      } else {
        const emo = item as Record<string, unknown>;
        if (typeof emo.label !== "string" || !emo.label.trim()) errors.push(`diary_interpretation.explicit_emotions[${idx}].label must be non-empty`);
        if (typeof emo.displayLabel !== "string" || !emo.displayLabel.trim()) errors.push(`diary_interpretation.explicit_emotions[${idx}].displayLabel must be non-empty`);
        if (typeof emo.evidence !== "string" || !emo.evidence.trim()) errors.push(`diary_interpretation.explicit_emotions[${idx}].evidence must be non-empty`);
      }
    });
  }

  if (typeof diary.summary !== "string" || !diary.summary.trim()) {
    errors.push("diary_interpretation.summary must be a non-empty string");
  }

  if (scene.contract_version !== SCENE_INTENT_CONTRACT_VERSION) {
    errors.push(`scene_intent.contract_version must be "${SCENE_INTENT_CONTRACT_VERSION}"`);
  }
  if (typeof scene.scene_theme !== "string" || !scene.scene_theme.trim()) {
    errors.push("scene_intent.scene_theme must be a non-empty string");
  }

  if (!scene.symbolic_atmosphere || typeof scene.symbolic_atmosphere !== "object") {
    errors.push("scene_intent.symbolic_atmosphere must be an object");
  } else {
    const atmo = scene.symbolic_atmosphere as Record<string, unknown>;
    for (const key of ["lighting_motif", "weather_motif", "mood_tone"]) {
      if (typeof atmo[key] !== "string" || !String(atmo[key]).trim()) {
        errors.push(`scene_intent.symbolic_atmosphere.${key} must be non-empty string`);
      }
    }
  }

  if (!Array.isArray(scene.symbolic_candidates) || scene.symbolic_candidates.length === 0 || scene.symbolic_candidates.length > 2) {
    errors.push("scene_intent.symbolic_candidates must be an array with 1 to 2 candidates");
  } else {
    (scene.symbolic_candidates as unknown[]).forEach((cand, idx) => {
      if (!cand || typeof cand !== "object") {
        errors.push(`scene_intent.symbolic_candidates[${idx}] must be an object`);
      } else {
        const c = cand as Record<string, unknown>;
        if (typeof c.id !== "string" || !c.id.trim()) errors.push(`candidate[${idx}].id required`);
        if (typeof c.title !== "string" || !c.title.trim()) errors.push(`candidate[${idx}].title required`);
        if (typeof c.is_primary !== "boolean") errors.push(`candidate[${idx}].is_primary must be boolean`);
        if (typeof c.grounded_evidence !== "string" || !c.grounded_evidence.trim()) errors.push(`candidate[${idx}].grounded_evidence required`);
        if (typeof c.translation_rationale !== "string" || !c.translation_rationale.trim()) errors.push(`candidate[${idx}].translation_rationale required`);
        if (typeof c.scene_description !== "string" || !c.scene_description.trim()) errors.push(`candidate[${idx}].scene_description required`);
      }
    });
  }

  if (!Array.isArray(scene.asset_search_intents)) {
    errors.push("scene_intent.asset_search_intents must be an array");
  }

  if (!Array.isArray(scene.cross_day_theme_tags)) {
    errors.push("scene_intent.cross_day_theme_tags must be an array");
  }

  if (!scene.uncertainty || typeof scene.uncertainty !== "object" || !["low", "medium", "high"].includes(String((scene.uncertainty as Record<string, unknown>).level))) {
    errors.push("scene_intent.uncertainty.level must be 'low', 'medium', or 'high'");
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: value as SceneIntentEnvelope };
}

/**
 * 示例数据 (展示写代码 $\rightarrow$ 工坊/桥梁转译)
 */
export const SAMPLE_SCENE_INTENT_ENVELOPE: SceneIntentEnvelope = {
  diary_interpretation: {
    activities: [
      { text: "在咖啡馆写代码改项目", evidence: "下午在学校旁边的咖啡馆写代码改项目，调通了一个关键功能" },
      { text: "湖边散步看晚霞", evidence: "傍晚沿着湖边散步，看到了很漂亮的晚霞" }
    ],
    places: [
      { text: "学校旁的咖啡馆", evidence: "学校旁边的咖啡馆" },
      { text: "湖边", evidence: "沿着湖边" }
    ],
    people_or_animals: [
      { text: "咖啡馆的橘猫", evidence: "脚边趴着一只很胖的橘猫" }
    ],
    mentioned_objects: [
      { text: "燕麦拿铁", evidence: "喝了一杯热燕麦拿铁" }
    ],
    explicit_emotions: [
      { label: "relaxed", displayLabel: "轻松放松", evidence: "心情很放松" }
    ],
    temporal_clues: [
      { text: "下午", evidence: "下午在学校旁边" },
      { text: "傍晚", evidence: "傍晚沿着湖边" }
    ],
    summary: "下午在咖啡馆专注写代码调通功能，有猫相伴；傍晚漫步湖边看晚霞，度过了轻松而有进展的一天。"
  },
  scene_intent: {
    contract_version: SCENE_INTENT_CONTRACT_VERSION,
    scene_theme: "project",
    symbolic_atmosphere: {
      lighting_motif: "sunset_warm_glow",
      weather_motif: "clear_dusk",
      mood_tone: "focused_relaxed"
    },
    symbolic_candidates: [
      {
        id: "candidate-primary",
        title: "水岸暖光工坊",
        is_primary: true,
        symbolic_type: "workshop_craft",
        grounded_evidence: "下午在学校旁边的咖啡馆写代码改项目，调通了一个关键功能",
        translation_rationale: "将写代码解决bug的推进感，象征性转译为一座临水而建的砖木手作工坊。屋内亮着暖色炉灯，门前有一只打盹的胖橘猫与未熄灭的暖炉。",
        scene_description: "一座紧凑精致的 2D 像素砖木工坊，侧面有一座转动的水车象征思维运转，屋前木桶与长椅依偎在落日余晖中。"
      },
      {
        id: "candidate-alternative",
        title: "晚霞初成木桥",
        is_primary: false,
        symbolic_type: "waypoint_path",
        grounded_evidence: "调通了一个关键功能；傍晚沿着湖边散步",
        translation_rationale: "功能调通如同生活中的断桥被重新架起，转译为延伸向静水对岸的崭新木桥，桥头立着微明路标。",
        scene_description: "一段新建成的木质栈道与小木桥，桥边点缀几丛芦苇与一盏立柱暖灯，桥下泛着粉紫色的晚霞倒影。"
      }
    ],
    asset_search_intents: [
      { query: "artisan_workshop", category: "building", symbolic_role: "专注推进的主体隐喻" },
      { query: "sleeping_cat", category: "character", symbolic_role: "真实生活温情陪伴" },
      { query: "lantern_post", category: "prop", symbolic_role: "暮色中的指引路标" }
    ],
    cross_day_theme_tags: ["项目推进", "水岸漫步", "落日时刻"],
    uncertainty: {
      level: "low",
      note: "日记事实具体明确，转译隐喻紧密对应攻坚与放松两个阶段。"
    }
  }
};

/**
 * 适配器：将 SceneIntentEnvelope 转为现有前端使用的 LifeAnnotation
 */
export function sceneIntentToLifeAnnotation(
  envelope: SceneIntentEnvelope,
  source: "ai" | "mock" | "manual" = "ai"
): LifeAnnotation {
  const diary = envelope.diary_interpretation;
  const scene = envelope.scene_intent;

  const activities = [...new Set(diary.activities.map(a => a.text))];
  const places = [...new Set(diary.places.map(p => p.text))];
  const keywords = [...new Set([
    ...diary.mentioned_objects.map(o => o.text),
    ...diary.people_or_animals.map(p => p.text),
    ...scene.cross_day_theme_tags
  ])];

  const firstEmotion = diary.explicit_emotions[0];
  const emotion = firstEmotion ? {
    label: firstEmotion.displayLabel,
    emoji: emotionToEmoji(firstEmotion.label)
  } : null;

  return {
    activities,
    places,
    emotion,
    keywords,
    source
  };
}

/**
 * 适配器：将 SceneIntentEnvelope 转为现有底层领域使用的 InterpretationResult
 */
export function sceneIntentToInterpretationResult(
  envelope: SceneIntentEnvelope
): InterpretationResult {
  const diary = envelope.diary_interpretation;
  const scene = envelope.scene_intent;

  const activities = diary.activities.map(a => ({
    label: a.text,
    evidence: a.evidence
  }));

  const explicitEmotions = diary.explicit_emotions.map(e => ({
    label: normalizeEmotionLabel(e.label),
    displayLabel: e.displayLabel,
    evidence: e.evidence
  }));

  const theme = mapToLifeTheme(scene.scene_theme);
  const atmosphere = mapToLifeAtmosphere(scene.symbolic_atmosphere.mood_tone);
  const mode = mapThemeToMode(theme);

  return {
    activities,
    explicitEmotions,
    summary: diary.summary,
    lifeStructure: {
      mode,
      continuity: 0.72,
      density: Math.min(0.9, 0.3 + activities.length * 0.15),
      mobility: diary.places.length > 1 ? 0.7 : 0.3,
      sociality: diary.people_or_animals.length > 0 ? 0.75 : 0.1,
      directionality: theme === "project" ? 0.85 : 0.45,
      theme,
      atmosphere
    }
  };
}

function emotionToEmoji(label: string): string {
  const map: Record<string, string> = {
    happy: "☀️",
    warm: "☀️",
    tired: "🌧️",
    calm: "🌿",
    relaxed: "🌿",
    anxious: "⚡",
    sad: "💧",
    excited: "✨"
  };
  return map[label.toLowerCase()] ?? "🌿";
}

function normalizeEmotionLabel(label: string): ExplicitEmotionLabel {
  const valid: ExplicitEmotionLabel[] = ["tired", "happy", "anxious", "relaxed", "sad", "excited", "calm"];
  const lower = label.toLowerCase();
  for (const v of valid) {
    if (lower.includes(v)) return v;
  }
  if (label.includes("累") || label.includes("疲")) return "tired";
  if (label.includes("开") || label.includes("乐")) return "happy";
  if (label.includes("急") || label.includes("焦")) return "anxious";
  if (label.includes("松")) return "relaxed";
  if (label.includes("悲") || label.includes("难")) return "sad";
  if (label.includes("兴") || label.includes("激")) return "excited";
  return "calm";
}

function mapToLifeTheme(theme: string): LifeTheme {
  const valid: LifeTheme[] = ["project", "connection", "rest", "movement", "exploration", "ordinary_day"];
  if (valid.includes(theme as LifeTheme)) return theme as LifeTheme;
  const lower = theme.toLowerCase();
  if (lower.includes("project") || theme.includes("项目") || theme.includes("工作")) return "project";
  if (lower.includes("connection") || theme.includes("相聚") || theme.includes("朋友")) return "connection";
  if (lower.includes("rest") || theme.includes("休息") || theme.includes("放松")) return "rest";
  if (lower.includes("movement") || theme.includes("移动") || theme.includes("通勤")) return "movement";
  if (lower.includes("exploration") || theme.includes("探索") || theme.includes("旅行")) return "exploration";
  return "ordinary_day";
}

function mapToLifeAtmosphere(mood: string): LifeAtmosphere {
  const valid: LifeAtmosphere[] = ["focused", "warm", "soft", "quiet", "tired_calm", "open", "mixed"];
  if (valid.includes(mood as LifeAtmosphere)) return mood as LifeAtmosphere;
  const lower = mood.toLowerCase();
  if (lower.includes("focus") || mood.includes("专注")) return "focused";
  if (lower.includes("warm") || mood.includes("温暖")) return "warm";
  if (lower.includes("soft") || mood.includes("柔软")) return "soft";
  if (lower.includes("tired") || mood.includes("疲惫")) return "tired_calm";
  if (lower.includes("open") || mood.includes("开阔")) return "open";
  return "quiet";
}

function mapThemeToMode(theme: LifeTheme): LifeMode {
  switch (theme) {
    case "project": return "advance";
    case "connection": return "connect";
    case "rest": return "restore";
    case "exploration": return "explore";
    default: return "pause";
  }
}
