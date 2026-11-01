import type { VisualizableEventCandidate } from '../services/event-aggregation.js';
import type { UserSupplementalAnswer } from '../contracts/dual-stage-contract.js';

export const DIARY_INPUT_SCHEMA_VERSION = 'diary-input-v1';

export interface ExportedFocusItem {
  event_id: string;
  title: string;
  focus_kind: string;
  evidence: string;
}

export interface DiaryInputSnapshot {
  schema_version: 'diary-input-v1';
  exported_at: string;
  diary_case_id: string;
  diary_date: string;
  notes: string[];
  selected_focuses: ExportedFocusItem[];
  supplemental_answers: UserSupplementalAnswer[];
  extra_detail?: string;
}

export function exportDiaryInputSnapshot(options: {
  date: string;
  notes: string[];
  focuses: VisualizableEventCandidate[];
  focusIds: string[];
  answers: UserSupplementalAnswer[];
  extra: string;
}): DiaryInputSnapshot {
  const selectedFocuses: ExportedFocusItem[] = options.focuses
    .filter(f => options.focusIds.includes(f.event_id))
    .map(f => ({
      event_id: f.event_id,
      title: f.title || f.keyword || '生活焦点',
      focus_kind: f.focus_kind || 'event',
      evidence: f.evidence || ''
    }));

  return {
    schema_version: DIARY_INPUT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    diary_case_id: `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    diary_date: options.date,
    notes: options.notes.filter(n => n.trim().length > 0),
    selected_focuses: selectedFocuses,
    supplemental_answers: options.answers || [],
    extra_detail: options.extra?.trim() || undefined
  };
}

export function validateAndParseDiarySnapshot(rawJson: string): DiaryInputSnapshot {
  let data: any;
  try {
    data = JSON.parse(rawJson);
  } catch {
    throw new Error('导入失败：文件不是合法的 JSON 格式。');
  }

  if (!data || typeof data !== 'object') {
    throw new Error('导入失败：数据内容为空或非对象结构。');
  }

  if (data.schema_version !== DIARY_INPUT_SCHEMA_VERSION) {
    throw new Error(`导入失败：不支持的日记快照版本 (${data.schema_version || '未知'})，期望版本为 ${DIARY_INPUT_SCHEMA_VERSION}。`);
  }

  if (!Array.isArray(data.notes) || data.notes.length === 0 || !data.notes.some((n: any) => typeof n === 'string' && n.trim())) {
    throw new Error('导入失败：快照中未包含有效的日记便签内容。');
  }

  if (!Array.isArray(data.selected_focuses) || data.selected_focuses.length === 0) {
    throw new Error('导入失败：快照中缺少确认的重点事项列表。');
  }

  if (data.selected_focuses.length > 3) {
    throw new Error('导入失败：重点事项数量超出上限（最多 3 项）。');
  }

  for (const focus of data.selected_focuses) {
    if (!focus.event_id || typeof focus.title !== 'string') {
      throw new Error('导入失败：重点事项数据损坏，缺少必要标识或标题。');
    }
  }

  return {
    schema_version: DIARY_INPUT_SCHEMA_VERSION,
    exported_at: data.exported_at || new Date().toISOString(),
    diary_case_id: data.diary_case_id || `case_${Date.now()}`,
    diary_date: typeof data.diary_date === 'string' ? data.diary_date : new Date().toISOString().split('T')[0],
    notes: data.notes.map((n: any) => String(n)),
    selected_focuses: data.selected_focuses.map((f: any) => ({
      event_id: String(f.event_id),
      title: String(f.title),
      focus_kind: String(f.focus_kind || 'event'),
      evidence: String(f.evidence || '')
    })),
    supplemental_answers: Array.isArray(data.supplemental_answers) ? data.supplemental_answers : [],
    extra_detail: typeof data.extra_detail === 'string' ? data.extra_detail : ''
  };
}
