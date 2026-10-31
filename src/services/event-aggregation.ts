/**
 * Life Map V0.4 — 生活焦点事件聚合引擎与触发规则 (Event Aggregation & Focus Trigger)
 * 职责：
 * 1. 将 Stage A 原始活动与事实智能聚合为语义完整的生活事件候选 (VisualizableEventCandidate)。
 * 2. 避免动作机械拆分，确保同一事务（如看资料+写代码+调bug）聚合为一个事件。
 * 3. 基于独立事件数量计算触发级别 (auto_pass / lightweight_prompt / mandatory_selection)。
 * 4. 给出 AI 推荐的 1~2 个优先焦点。
 */

import type { EvidenceFact } from "../contracts/scene-intent.js";
import type { StageAAnalysis, StageAPotentialInquiry } from "../contracts/dual-stage-contract.js";

export type EventType = "activity" | "experience" | "interaction" | "emotion_state" | "reflection";

export interface VisualizableEventCandidate {
  focus_kind?: "event" | "mood" | "place" | "person" | "object";
  keyword?: string;              // 展示用短关键词；title/evidence 保留完整事实
  event_id: string;              // 稳定唯一的事件标识，如 "event_dev_focus"
  title: string;                 // 简短事件名称，如 "代码重构与性能攻坚"
  summary: string;               // 简要说明
  evidence: string;              // 对应日记原文引用片段
  related_fact_ids: string[];    // 关联的 Stage A 事实名称
  event_type: EventType;
  suggested_priority: 1 | 2 | 3; // 1 最优先推荐
  visual_cue_hint: string;       // 具象像素生活线索，如 "摆放铁锤图纸的橡木工作台"
}

export type FocusTriggerLevel = "auto_pass" | "lightweight_prompt" | "mandatory_selection";

export interface FocusTriggerEvaluation {
  candidate_count: number;
  trigger_level: FocusTriggerLevel;
  should_auto_open_modal: boolean;
  prompt_message: string;
}

/**
 * 确定性事件聚合算法
 * 规则：将同一事务、同一生活场景的碎片动词和事实合并为语义连贯的事件，绝不机械按动词逐字拆分。
 */
export function aggregateVisualizableEvents(
  analysis: StageAAnalysis,
  rawText: string
): VisualizableEventCandidate[] {
  const candidates: VisualizableEventCandidate[] = [];
  const text = rawText || "";

  // 1. 识别工程开发与技术攻坚类事务 (代码、bug、调试、重构、论文、项目)
  const devMatches = text.match(/写代码|改项目|改代码|调bug|调试|开发|做项目|重构|性能问题|前端|算法/g);
  if (devMatches && devMatches.length > 0) {
    const obstacleMatch = text.match(/卡住|bug|阻碍|难题|繁琐|竞态/);
    const relatedEvidence = text.match(/[^。；\n]*(?:写代码|调试|重构|性能|bug)[^。；\n]*/)?.[0] || devMatches[0];
    candidates.push({
      event_id: "event_craft_engineering",
      title: "项目重构与技术攻坚",
      summary: `围绕代码开发与问题排查展开深度心智劳作${obstacleMatch ? `，克服了${obstacleMatch[0]}等阻碍` : ""}`,
      evidence: relatedEvidence.trim(),
      related_fact_ids: ["项目攻坚", "推进项目"],
      event_type: "activity",
      suggested_priority: 1,
      visual_cue_hint: "工坊中央摆放图纸、工具与长明壁炉的工匠修葺台"
    });
  }

  // 2. 识别阅读学习与学术思考事务 (看资料、看书、上课、图书馆、论文)
  const studyMatches = text.match(/看资料|上课|阅读|读书|学习|借书|还书|论文|笔记|自习/g);
  if (studyMatches && studyMatches.length > 0) {
    const studyEvidence = text.match(/[^。；\n]*(?:看资料|阅读|读书|学习|论文|借书)[^。；\n]*/)?.[0] || studyMatches[0];
    candidates.push({
      event_id: "event_study_reflection",
      title: "文献阅读与学术沉淀",
      summary: "沉浸于书籍资料的阅读思考与学识沉淀，记录内省与求知时刻",
      evidence: studyEvidence.trim(),
      related_fact_ids: ["阅读学习"],
      event_type: "experience",
      suggested_priority: 2,
      visual_cue_hint: "松木书架与摊开的旧卷轴，透出晨曦微光的阅读桌"
    });
  }

  // 3. 识别户外漫步与自然留白事务 (散步、湖边、公园、夕阳、吹风、走走)
  const natureMatches = text.match(/散步|走了走|慢跑|逛街|走了一圈|湖边|海边|公园|森林|夕阳|吹风/g);
  if (natureMatches && natureMatches.length > 0) {
    const natureEvidence = text.match(/[^。；\n]*(?:散步|湖边|公园|走走|微风|湖水)[^。；\n]*/)?.[0] || natureMatches[0];
    candidates.push({
      event_id: "event_nature_stroll",
      title: "湖畔漫步与自然留白",
      summary: "暂时放下繁重事务，在水岸与微风中舒展身心，感受自然的舒缓节律",
      evidence: natureEvidence.trim(),
      related_fact_ids: ["散步放松", "户外漫步"],
      event_type: "experience",
      suggested_priority: 1,
      visual_cue_hint: "水岸泥沙浅滩上的系缆石墩与微风吹拂的帆布露营帐篷"
    });
  }

  // 4. 识别茶歇餐饮与喘息事务 (喝咖啡、喝茶、拉面、小餐馆、聚餐)
  const teaMatches = text.match(/喝咖啡|喝茶|拿铁|咖啡馆|吃拉面|吃午饭|吃晚饭|聚餐|茶歇/g);
  if (teaMatches && teaMatches.length > 0) {
    const teaEvidence = text.match(/[^。；\n]*(?:喝咖啡|喝茶|咖啡馆|拉面|茶歇)[^。；\n]*/)?.[0] || teaMatches[0];
    candidates.push({
      event_id: "event_tea_pause",
      title: "短暂停歇与茶饮小叙",
      summary: "在忙碌间隙享用一杯温热茶饮，为生活留出片刻喘息时间",
      evidence: teaEvidence.trim(),
      related_fact_ids: ["茶歇餐饮"],
      event_type: "activity",
      suggested_priority: 2,
      visual_cue_hint: "粗陶茶壶配两只小茶杯的竹制矮几"
    });
  }

  // 5. 识别社交互动与同伴交流 (同门交流、老师反馈、朋友、聚会)
  const socialMatches = text.match(/同门|同学|老师|朋友|同事|交流|聚会|导师|讨论/g);
  if (socialMatches && socialMatches.length > 0) {
    const socialEvidence = text.match(/[^。；\n]*(?:同门|老师|朋友|交流|讨论|肯定)[^。；\n]*/)?.[0] || socialMatches[0];
    candidates.push({
      event_id: "event_social_dialogue",
      title: "同行交流与支持回响",
      summary: "与导师、同门或伙伴展开对话探讨，收获思想启发与温暖反馈",
      evidence: socialEvidence.trim(),
      related_fact_ids: ["同行陪伴"],
      event_type: "interaction",
      suggested_priority: 2,
      visual_cue_hint: "林荫下并排摆放的石长椅与挂有铜铃的矮枫树"
    });
  }

  // 6. 识别起居整理与日常家务 (洗衣服、收拾、整理书架、宿舍)
  const choreMatches = text.match(/洗衣服|整理|收拾|做家务|打扫|宿舍整理/g);
  if (choreMatches && choreMatches.length > 0) {
    const choreEvidence = text.match(/[^。；\n]*(?:洗衣服|整理|收拾|做家务)[^。；\n]*/)?.[0] || choreMatches[0];
    candidates.push({
      event_id: "event_daily_tidying",
      title: "居所整理与日常打理",
      summary: "清洗衣物、整理书架物件，在细碎琐事中重置平静的生活秩序",
      evidence: choreEvidence.trim(),
      related_fact_ids: ["日常起居"],
      event_type: "activity",
      suggested_priority: 3,
      visual_cue_hint: "整齐堆叠的松木储物箱与挂着小铜铃的门柱"
    });
  }

  // 7. 识别情绪释怀与深层沉思 (疲惫、安心、平静、反思、开悟)
  if (analysis.explicit_emotions.length > 0) {
    const emo = analysis.explicit_emotions[0];
    candidates.push({
      event_id: `event_emotion_${emo.label}`,
      title: `心境觉察：${emo.displayLabel}`,
      summary: `文字中明确记录了“${emo.displayLabel}”的心情体验，展现真实心绪波澜`,
      evidence: emo.evidence,
      related_fact_ids: [emo.displayLabel],
      event_type: "emotion_state",
      suggested_priority: 3,
      visual_cue_hint: "石基路灯木柱散发出的微弱柔和光晕"
    });
  }

  // 8. 兜底保护：若上述均未命中，提供基于事实维度的保底事件
  if (candidates.length === 0) {
    candidates.push({
      event_id: "event_generic_day",
      title: "平静舒缓的日常切片",
      summary: analysis.brief_analysis || "据实记录的平凡一天，未提及剧烈的活动变动",
      evidence: rawText.slice(0, 50),
      related_fact_ids: ["日常"],
      event_type: "experience",
      suggested_priority: 1,
      visual_cue_hint: "微风吹过石板小径与陶盆绿植幼苗"
    });
  }

  return candidates;
}

/**
 * 智能触发级别评估规则
 * 规则：
 * - 1–3 个：默认直接使用 AI 推荐焦点，不强制进入选择页 (auto_pass)。
 * - 4–5 个：显示轻量入口“调整今天想留下的内容”，默认不打断流程 (lightweight_prompt)。
 * - 6 个及以上：自动进入 Life Focus Selection 页面/弹窗 (mandatory_selection)。
 */
export function resolveFocusSelectionTrigger(
  candidates: VisualizableEventCandidate[]
): FocusTriggerEvaluation {
  const count = candidates.length;

  if (count <= 3) {
    return {
      candidate_count: count,
      trigger_level: "auto_pass",
      should_auto_open_modal: false,
      prompt_message: `识别到 ${count} 件生活事件，景观容量充足，已自动采用 AI 推荐的主要焦点。`
    };
  }

  if (count <= 5) {
    return {
      candidate_count: count,
      trigger_level: "lightweight_prompt",
      should_auto_open_modal: false,
      prompt_message: `识别到 ${count} 件生活事件。景观已选入主要经历，您可点击「调整焦点」自定留存重点。`
    };
  }

  return {
    candidate_count: count,
    trigger_level: "mandatory_selection",
    should_auto_open_modal: true,
    prompt_message: `今天经历较丰富 (共 ${count} 件独立事件)。为保持世界意象凝练统一，请选择今天主要想视觉化的 1~3 件生活经历。`
  };
}

/**
 * 默认焦点推荐选择函数
 * 选取推荐优先级最高的 1~2 个事件 ID
 */
export function recommendDefaultFocusEvents(
  candidates: VisualizableEventCandidate[],
  maxToSelect = 2
): string[] {
  if (!candidates || candidates.length === 0) return [];

  // 按 priority 升序 (1 最优先)，同 priority 保持原有顺序
  const sorted = [...candidates].sort((a, b) => a.suggested_priority - b.suggested_priority);
  return sorted.slice(0, Math.min(maxToSelect, candidates.length)).map(c => c.event_id);
}

/**
 * V0.7-A 预生成主观体验与情绪追问
 * 规则：
 * 1. 仅针对有主观感受拓展空间或体验歧义的事件提问；
 * 2. 绝不重复日记中已经写明的确定事实；
 * 3. 每个事件最多产生 1 个追问，总量控制在 1~3 个；
 * 4. 严格关联实际存在的 event_id 与原文证据。
 */
export function generatePotentialInquiries(
  events: VisualizableEventCandidate[],
  rawText: string
): StageAPotentialInquiry[] {
  const inquiries: StageAPotentialInquiry[] = [];
  const text = rawText || "";

  for (const event of events) {
    if (inquiries.length >= 3) break;

    // 1. 获得鼓励、肯定或评价相关事件
    if (/鼓励|夸奖|看好|认可|肯定|批阅|信心/.test(event.title + event.summary)) {
      if (!inquiries.some(q => q.target_event_id === event.event_id)) {
        inquiries.push({
          question_id: `inq_encouragement_${event.event_id}`,
          target_event_id: event.event_id,
          question_text: "这份认可与鼓励，更让你松了一口气，还是更有动力继续探索？",
          answer_options: ["松了一口气，心里踏实了", "更有动力和冲劲了", "依然感到挑战在后面"],
          evidence: event.evidence || "日记中提及被肯定与鼓励的经历",
          reason_for_asking: "理解外部反馈在内心激起的是释然还是前进的驱动力"
        });
        continue;
      }
    }

    // 2. 技术研发与攻坚相关事件
    if (/攻坚|重构|代码|调试|开发|调通|功能/.test(event.title + event.summary)) {
      if (!inquiries.some(q => q.target_event_id === event.event_id)) {
        inquiries.push({
          question_id: `inq_dev_${event.event_id}`,
          target_event_id: event.event_id,
          question_text: "在攻克关键功能或推进项目时，你更沉浸在何种体验中？",
          answer_options: ["高度专注的心流状态", "克服阻碍后的豁然开朗", "忙碌但踏实的劳作感"],
          evidence: event.evidence || "技术推进与项目经历",
          reason_for_asking: "明确智力劳作在心理空间留下的核心印记"
        });
        continue;
      }
    }

    // 3. 散步、自然、独处与慢生活事件
    if (/散步|公园|湖边|晚霞|风|休息|慢下来|发呆/.test(event.title + event.summary)) {
      if (!inquiries.some(q => q.target_event_id === event.event_id)) {
        inquiries.push({
          question_id: `inq_nature_${event.event_id}`,
          target_event_id: event.event_id,
          question_text: "漫步与感受周围景物时，你的思绪更倾向于？",
          answer_options: ["完全放空，只感受风与晚霞", "静静回味和整理白天的事", "感到平静而有安全感"],
          evidence: event.evidence || "散步与自然微景经历",
          reason_for_asking: "捕捉休憩时刻是彻底放空还是内省沉淀"
        });
        continue;
      }
    }

    // 4. 社交互动与餐饮相聚事件
    if (/交流|同门|朋友|室友|聊天|聚餐|拉面|咖啡馆/.test(event.title + event.summary)) {
      if (!inquiries.some(q => q.target_event_id === event.event_id)) {
        inquiries.push({
          question_id: `inq_social_${event.event_id}`,
          target_event_id: event.event_id,
          question_text: "和同行或伙伴相处交流后，最触动你的是哪种氛围？",
          answer_options: ["彼此懂得的温暖与陪伴", "畅谈未来的开阔与期待", "随性惬意的放松感"],
          evidence: event.evidence || "人际交流与生活相聚",
          reason_for_asking: "探寻人际互动在记忆景观中的温度底色"
        });
        continue;
      }
    }
  }

  return inquiries;
}

