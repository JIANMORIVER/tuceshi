import type { DiaryInterpretation, EvidenceFact } from "../contracts/scene-intent.js";
import type { VisualizableEventCandidate } from "./event-aggregation.js";

export const FOCUS_KIND_LABELS = { event: "事件", mood: "心情", place: "地点", person: "人物 / 动物", object: "物件" } as const;
type Kind = keyof typeof FOCUS_KIND_LABELS;
function activityKeyword(label: string, interpretation: DiaryInterpretation): string {
  let keyword = label;
  const prefixes = ["今天", "早上", "上午", "中午", "下午", "傍晚", "晚上", "夜里",
    ...(interpretation.places || []).map(place => `在${place.text}`),
    ...(interpretation.people_or_animals || []).flatMap(person => ["和", "与", "跟"].map(preposition => preposition + person.text))];
  for (let pass = 0; pass < 5; pass++) {
    const prefix = prefixes.find(value => keyword.startsWith(value) && keyword.slice(value.length).trim().length >= 2);
    if (!prefix) break;
    keyword = keyword.slice(prefix.length).replace(/^[，,\s]+/, "");
  }
  return keyword;
}
const normalize = (text: string) => text.normalize("NFKC").replace(/[\s，。；！？、,:;!?]/g, "").toLowerCase();
function stableId(key: string): string {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return `event_diary_${(hash >>> 0).toString(16)}`;
}

/** Current diary flow: use model facts with verbatim evidence, never fixed lifestyle templates. */
export function buildDiaryFocusCandidates(interpretation: DiaryInterpretation, rawText: string): VisualizableEventCandidate[] {
  const result: VisualizableEventCandidate[] = [];
  const seen = new Set<string>();
  const add = (kind: Kind, text: string, evidence: string) => {
    const label = text?.trim();
    const quote = evidence?.trim();
    if (!label || !quote || !rawText.includes(quote)) return;
    const key = `${kind}:${normalize(label)}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ event_id: stableId(key), focus_kind: kind, keyword: kind === "event" ? activityKeyword(label, interpretation) : label, title: label, summary: quote, evidence: quote,
      related_fact_ids: [label], event_type: kind === "mood" ? "emotion_state" : kind === "person" ? "interaction" : "activity",
      suggested_priority: kind === "event" ? 1 : kind === "mood" ? 2 : 3, visual_cue_hint: label });
  };
  const facts = (kind: Kind, values: EvidenceFact[] | undefined) => {
    for (const fact of values || []) add(kind, fact.text, fact.evidence);
  };
  facts("event", interpretation.activities);
  for (const mood of interpretation.explicit_emotions || []) add("mood", mood.displayLabel, mood.evidence);
  facts("place", interpretation.places);
  facts("person", interpretation.people_or_animals);
  facts("object", interpretation.mentioned_objects);
  if (!result.length) {
    const quote = rawText.split(/[。；！？\n]/).map(line => line.trim()).find(Boolean);
    if (quote) add("event", quote, quote);
  }
  return result;
}
