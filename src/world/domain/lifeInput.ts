import type { TileMood } from "../schemas/tileSpec.js";

export interface LifeInput {
  date: string;
  text?: string;
  activities: string[];
  mood: string;
}

export function normalizeLifeMood(value: string): TileMood {
  const mood = value.trim().toLowerCase();
  if (["warm", "happy", "social", "excited", "温暖", "开心"].some(token => mood.includes(token))) return "warm";
  if (["misty", "tired", "rain", "sad", "疲惫", "累", "雨", "低落"].some(token => mood.includes(token))) return "misty";
  return "calm";
}
