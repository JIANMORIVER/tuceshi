import {STAGE_A_CONTRACT_VERSION,type StageASnapshot,type StageAPotentialInquiry,type UserSupplementalAnswer} from "../contracts/dual-stage-contract.js";
import type {VisualizableEventCandidate} from "../services/event-aggregation.js";
export function createSnapshot(
  diaryDate: string,
  rawText: string,
  analysis: {
    activities: any[];
    places: any[];
    explicit_emotions: any[];
    keywords: string[];
    brief_analysis?: string;
    visualizable_events?: VisualizableEventCandidate[];
    potential_inquiries?: StageAPotentialInquiry[];
  },
  supplementalAnswers?: UserSupplementalAnswer[]
): StageASnapshot {
  return {
    snapshot_id: `snap_${Date.now()}`,
    created_at: new Date().toISOString(),
    input_text: rawText,
    trusted_date: diaryDate,
    parameters: {
      focus_mode: "balanced",
      interpret_depth: "standard",
      induction_breadth: "moderate",
      keyword_count: 5
    },
    analysis: {
      contract_version: STAGE_A_CONTRACT_VERSION,
      diary_date: diaryDate,
      activities: analysis.activities || [],
      places: analysis.places || [],
      people_or_animals: [],
      mentioned_objects: [],
      explicit_emotions: analysis.explicit_emotions || [],
      temporal_clues: [],
      event_progression: {},
      brief_analysis: analysis.brief_analysis || "生活日记事实与焦点提炼",
      primary_keywords: analysis.keywords || [],
      theme_and_atmosphere_clues: {
        theme_clue: "生活微景",
        atmosphere_clue: "宁静",
        tone: "温暖"
      },
      uncertainties: [],
      visualizable_events: analysis.visualizable_events || [],
      potential_inquiries: analysis.potential_inquiries || []
    },
    user_supplemental_answers: supplementalAnswers
  };
}

