import {
  SCENE_INTENT_CONTRACT_VERSION,
  SCENE_INTENT_SYSTEM_PROMPT,
  SCENE_INTENT_JSON_SCHEMA,
  validateSceneIntentEnvelope,
  sceneIntentToLifeAnnotation,
  sceneIntentToInterpretationResult,
  type SceneIntentEnvelope,
  type EvidenceFact,
  type ExplicitEmotionFact,
  type SymbolicSceneCandidate,
  type AssetSearchIntent
} from "../contracts/scene-intent.js";

export interface LifeInterpretationConfig {
  systemPrompt?: string;
  provider?: "qwen" | "mock" | string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface LifeInterpretationResponse {
  envelope: SceneIntentEnvelope;
  interpretation: ReturnType<typeof sceneIntentToInterpretationResult>;
  annotation: ReturnType<typeof sceneIntentToLifeAnnotation>;
  debug: {
    provider: string;
    model: string;
    latencyMs: number;
    charCount: number;
    validation: "valid";
  };
}

const DEFAULT_QWEN_MODEL = "qwen3.7-flash";
const DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 确定性 Mock 日记理解实现：遵循「有证据支撑的象征性转译」
 */
export function generateMockSceneIntent(text: string): SceneIntentEnvelope {
  const activities: EvidenceFact[] = [];
  const places: EvidenceFact[] = [];
  const people_or_animals: EvidenceFact[] = [];
  const mentioned_objects: EvidenceFact[] = [];
  const explicit_emotions: ExplicitEmotionFact[] = [];
  const temporal_clues: EvidenceFact[] = [];

  const addMatch = (regex: RegExp, list: EvidenceFact[]) => {
    const m = text.match(regex);
    if (m) list.push({ text: m[0], evidence: m[0] });
  };

  // 活动
  const actRules: Array<[RegExp, string]> = [
    [/上课|看资料|读书|学习|还书|借书|图书馆/, "阅读思考"],
    [/写代码|改项目|实验室|调bug|做项目|写论文/, "推进项目"],
    [/喝咖啡|喝茶|吃饭|聚餐|吃拉面|吃午饭|吃早饭|吃晚饭|食堂|小餐馆/, "用餐茶歇"],
    [/散步|走了走|慢跑|逛街|走走/, "户外漫步"],
    [/休息|看视频|玩游戏|睡了一觉|躺平/, "休闲放松"],
    [/洗衣服|收拾|整理|做家务/, "日常起居"]
  ];
  for (const [r, label] of actRules) {
    const m = text.match(r);
    if (m) activities.push({ text: label, evidence: m[0] });
  }

  // 地点
  addMatch(/咖啡馆|咖啡厅|茶馆/, places);
  addMatch(/实验室|工作坊|办公室|工位/, places);
  addMatch(/图书馆|书店/, places);
  addMatch(/小餐馆|餐馆|食堂|饭馆/, places);
  addMatch(/公园|湖边|海边|海滩|森林/, places);
  addMatch(/宿舍|家里|院子|小院/, places);

  // 人物或动物
  addMatch(/猫|小猫|橘猫|狗|小狗|松鼠|小鸟/, people_or_animals);
  addMatch(/室友|朋友|同学|老师|同事/, people_or_animals);

  // 物品
  addMatch(/电脑|笔记本|键盘|书本|资料/, mentioned_objects);
  addMatch(/拿铁|咖啡|茶|拉面|松果|长椅|路灯/, mentioned_objects);

  // 时间线索
  const timeKeywords = ["清晨", "早上", "上午", "中午", "下午", "傍晚", "晚上", "深夜"];
  for (const tw of timeKeywords) {
    if (text.includes(tw)) temporal_clues.push({ text: tw, evidence: tw });
  }

  // 明确情绪 (严格提取有原文依据的情绪)
  const emotionRules: Array<[RegExp, string, string]> = [
    [/累|疲惫|好累|抽空|只想躺平|无力/, "tired", "疲惫"],
    [/开心|高兴|快乐|挺开心的/, "happy", "开心"],
    [/轻松|放松|很放松/, "relaxed", "放松"],
    [/焦虑|压力大|紧张/, "anxious", "焦虑"],
    [/平静|很安静|安心/, "calm", "平静"],
    [/难过|沮丧|低落/, "sad", "难过"],
    [/充实|很充实/, "fulfilled", "充实"]
  ];
  for (const [r, label, display] of emotionRules) {
    const m = text.match(r);
    if (m) explicit_emotions.push({ label, displayLabel: display, evidence: m[0] });
  }

  // 场景象征主题判定
  const isProject = /项目|代码|实验|论文|工作|bug|学习/.test(text);
  const isSocial = /朋友|室友|同学|一起|聚餐/.test(text);
  const isRest = /休息|散步|湖边|公园|睡|视频|放松/.test(text);
  const isExplore = /第一次|新地方|旅行|探索/.test(text);

  const scene_theme = isProject ? "project"
    : isSocial ? "connection"
    : isExplore ? "exploration"
    : isRest ? "rest"
    : "ordinary_day";

  // 象征性转译候选：主要场景 + 最多 1 个备选表达
  let symbolic_candidates: SymbolicSceneCandidate[];
  if (isProject) {
    symbolic_candidates = [
      {
        id: "candidate-primary",
        title: "专注搭建的砖木工坊",
        is_primary: true,
        symbolic_type: "workshop_craft",
        grounded_evidence: activities[0]?.evidence || "改项目",
        translation_rationale: "将专注改项目、写逻辑的脑力创造，象征性转译为一座正在精心修缮物件、炉火温暖的砖木手工坊，寓意构筑与推进。",
        scene_description: "一座紧凑立体的 2D 像素砖木工坊，门前有一条整齐的石砖小径，窗棂透出恒定的暖黄火光。"
      },
      {
        id: "candidate-alternative",
        title: "初通前路的小石桥",
        is_primary: false,
        symbolic_type: "waypoint_path",
        grounded_evidence: activities[0]?.evidence || "推进项目",
        translation_rationale: "攻坚克难如同修通断桥，转译为一座跨越浅溪的结实石桥，象征思维与进度的贯通。",
        scene_description: "横跨清澈浅溪的古朴石拱桥，桥头立着微明路灯，桥边水草随波轻摇。"
      }
    ];
  } else if (isSocial) {
    symbolic_candidates = [
      {
        id: "candidate-primary",
        title: "暖阳聚会的小庭院",
        is_primary: true,
        symbolic_type: "gathering_yard",
        grounded_evidence: people_or_animals[0]?.evidence || "朋友",
        translation_rationale: "将与朋友相聚、分享日常的温情，转译为绿荫环绕的开放庭院，木长桌与长椅为彼此相聚而留。",
        scene_description: "大树庇荫下摆放着结实长木桌与复数长椅，地面铺洒斑驳树影，四周点缀低矮花篱。"
      }
    ];
  } else if (isRest) {
    symbolic_candidates = [
      {
        id: "candidate-primary",
        title: "微风湖畔的驻足长椅",
        is_primary: true,
        symbolic_type: "nature_haven",
        grounded_evidence: activities[0]?.evidence || "散步放松",
        translation_rationale: "将慢节奏散步与放空转译为临水而设的沉静微景观，长椅面向开阔水域，给予心灵栖息地。",
        scene_description: "依傍水岸的草坡，一张原木长椅静静伫立，湖面波光粼粼，岸边伫立一盏暖光柱灯。"
      }
    ];
  } else {
    symbolic_candidates = [
      {
        id: "candidate-primary",
        title: "质朴温馨的日常小屋",
        is_primary: true,
        symbolic_type: "shelter_residence",
        grounded_evidence: text.slice(0, 15) || "日常记录",
        translation_rationale: "将平实温和的日常转译为有风铃守护的小木屋，屋前留有生活的痕迹与安稳的落脚点。",
        scene_description: "一座安静小巧的斜顶木屋，台阶前有一小盆绿植，屋檐随风微动，平实而安宁。"
      }
    ];
  }

  const asset_search_intents: AssetSearchIntent[] = [
    {
      query: isProject ? "artisan_tools" : isRest ? "lakeside_bench" : "cottage_lantern",
      category: isProject || isRest ? "prop" : "building",
      symbolic_role: "核心象征视觉焦点"
    },
    {
      query: "shelter_tree",
      category: "vegetation",
      symbolic_role: "环境氛围守护与自然依托"
    }
  ];

  if (people_or_animals.length > 0) {
    asset_search_intents.push({
      query: "gentle_animal",
      category: "character",
      symbolic_role: "生活温情陪伴隐喻"
    });
  }

  const cross_day_theme_tags = isProject ? ["持续创造", "专注工坊"]
    : isSocial ? ["林下聚会", "温暖陪伴"]
    : isRest ? ["湖畔微风", "留白时光"]
    : ["静默日常"];

  const summary = activities.length > 0
    ? `这一天主要记录了${activities.map(a => a.text).join("、")}${places.length ? `，发生在${places.map(p => p.text).join("与")}` : ""}。${explicit_emotions.length ? `你明确提到了${explicit_emotions.map(e => e.displayLabel).join("、")}的感受。` : ""}`
    : "一段平静简短的生活片段，被认真留在了今天。";

  return {
    diary_interpretation: {
      activities,
      places,
      people_or_animals,
      mentioned_objects,
      explicit_emotions,
      temporal_clues,
      summary
    },
    scene_intent: {
      contract_version: SCENE_INTENT_CONTRACT_VERSION,
      scene_theme,
      symbolic_atmosphere: {
        lighting_motif: isProject ? "hearth_warm_glow" : isRest ? "soft_ambient_sky" : "clear_daylight",
        weather_motif: "gentle_clear",
        mood_tone: isProject ? "focused" : isRest ? "soft" : "quiet"
      },
      symbolic_candidates,
      asset_search_intents,
      cross_day_theme_tags,
      uncertainty: {
        level: "low",
        note: "通过确定性象征转译引擎解析生成。"
      }
    }
  };
}

/**
 * 核心日记理解处理业务逻辑（环境无关）
 */
export async function interpretLifeEntry(
  input: string,
  config: LifeInterpretationConfig = {},
  fetcher: typeof fetch = fetch
): Promise<LifeInterpretationResponse> {
  const text = (input ?? "").trim();
  if (!text) {
    throw new Error("日记内容不能为空");
  }
  if (text.length > 12000) {
    throw new Error("日记内容超出 12000 字限制");
  }

  const provider = (config.provider || "qwen").toLowerCase();
  const startedAt = Date.now();

  // 若显式为 mock 或未配置 DashScope API 密钥，则平滑使用 Mock
  if (provider === "mock" || (provider === "qwen" && !config.apiKey)) {
    const envelope = generateMockSceneIntent(text);
    const validated = validateSceneIntentEnvelope(envelope);
    if (!validated.valid) {
      throw new Error(`Mock 数据未通过结构校验: ${validated.errors.join("; ")}`);
    }
    const latencyMs = Date.now() - startedAt;
    return {
      envelope: validated.value,
      interpretation: sceneIntentToInterpretationResult(validated.value),
      annotation: sceneIntentToLifeAnnotation(validated.value, "mock"),
      debug: {
        provider: "mock",
        model: "deterministic-symbolic-v0.1",
        latencyMs,
        charCount: text.length,
        validation: "valid"
      }
    };
  }

  if (provider === "qwen" || provider === "deepseek") {
    const apiKey = config.apiKey;
    const model = config.model || (provider === "deepseek" ? "deepseek-flash" : DEFAULT_QWEN_MODEL);
    const baseUrl = (config.baseUrl || (provider === "deepseek" ? "https://api.deepseek.com/v1" : DEFAULT_QWEN_BASE_URL)).replace(/\/+$/, "");
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: `${config.systemPrompt || SCENE_INTENT_SYSTEM_PROMPT}\n\nStrict Schema:\n${JSON.stringify(SCENE_INTENT_JSON_SCHEMA)}`
            },
            {
              role: "user",
              content: text
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          ...(provider === "deepseek" ? { thinking: { type: "disabled" }, max_tokens: 6000 } : { enable_thinking: false })
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        let errorMsg = `模型接口响应错误 (${response.status})`;
        try {
          const errBody = await response.json() as { error?: { message?: string } };
          if (errBody?.error?.message) errorMsg = errBody.error.message;
        } catch {
          // ignore parsing error
        }
        throw new Error(errorMsg);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new Error("模型未返回有效文本内容");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawContent);
      } catch (cause) {
        throw new Error(`模型输出不是有效 JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
      }

      const validated = validateSceneIntentEnvelope(parsed);
      if (!validated.valid) {
        throw new Error(`模型输出未通过 Scene Intent 结构校验: ${validated.errors.join("; ")}`);
      }

      const latencyMs = Date.now() - startedAt;
      return {
        envelope: validated.value,
        interpretation: sceneIntentToInterpretationResult(validated.value),
        annotation: sceneIntentToLifeAnnotation(validated.value, "ai"),
        debug: {
          provider,
          model,
          latencyMs,
          charCount: text.length,
          validation: "valid"
        }
      };
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  throw new Error(`不支持的 LLM Provider: ${provider}`);
}

/**
 * 统一 Web 标准 HTTP Request 处理入口 (薄 Adapter)
 * 可同时供 Node.js 原生 HTTP 和 Cloudflare Worker 使用
 */
export async function handleLifeInterpretRequest(
  request: Request,
  config: LifeInterpretationConfig,
  fetcher: typeof fetch = fetch
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体不是有效 JSON" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  if (!body || typeof body !== "object" || typeof (body as { input?: unknown }).input !== "string") {
    return new Response(JSON.stringify({ error: "请求体必须包含 input 字符串字段" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const input = (body as { input: string }).input;

  try {
    const result = await interpretLifeEntry(input, config, fetcher);
    // 日志脱敏：仅打印提供商、模型、字数与耗时，严禁打印日记正文与 API Key
    console.info(`[life-interpret] success: provider=${result.debug.provider} model=${result.debug.model} chars=${result.debug.charCount} latency=${result.debug.latencyMs}ms`);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务处理异常";
    console.warn(`[life-interpret] failed: error=${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
}
