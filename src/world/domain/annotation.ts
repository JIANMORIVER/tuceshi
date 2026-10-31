import type { LifeInput } from "./lifeInput.js";
import type { SceneIntentEnvelope } from "../../contracts/scene-intent.js";

export interface LifeAnnotation {
  activities: string[];
  places: string[];
  emotion: { label: string; emoji: string } | null;
  keywords: string[];
  source: "mock" | "manual" | "ai";
  sceneIntent?: SceneIntentEnvelope;
}

export function createMockAnnotation(input: LifeInput): LifeAnnotation {
  const text = input.text ?? "";
  const places = [
    /coffee|cafe|咖啡馆/i.test(text) && "咖啡馆",
    /lab|实验室/i.test(text) && "实验室",
    /library|图书馆/i.test(text) && "图书馆",
    /park|公园/i.test(text) && "公园",
    /camp|露营|营地/i.test(text) && "露营",
    /海边|beach|seaside/i.test(text) && "海边",
    /温室|花园|花圃|garden|greenhouse/i.test(text) && "花园",
    /集市|市场|market/i.test(text) && "集市",
    /家里|在家|home/i.test(text) && "在家"
  ].filter((value): value is string => Boolean(value));
  const emotion = /开心|happy|快乐/i.test(text) ? { label: "开心", emoji: "☀️" } : /温暖|warm/i.test(text) ? { label: "温暖", emoji: "☀️" } : /充实|fulfilled/i.test(text)
    ? { label: "充实", emoji: "🙂" }
    : /累|tired/i.test(text) ? { label: "有点累", emoji: "🌧️" } : /平静|放松|calm/i.test(text) ? { label: "平静", emoji: "🌿" } : null;
  const keywords = [
    /论文|thesis/i.test(text) && "论文",
    /散步|walk/i.test(text) && "散步",
    /项目|project/i.test(text) && "项目",
    /咖啡|coffee/i.test(text) && "咖啡",
    /读书|阅读|read/i.test(text) && "阅读",
    /做饭|cooking/i.test(text) && "做饭"
  ].filter((value): value is string => Boolean(value));
  return {
    activities: [...new Set(input.activities)],
    places: [...new Set(places)],
    emotion,
    keywords: [...new Set(keywords)],
    source: "mock"
  };
}
