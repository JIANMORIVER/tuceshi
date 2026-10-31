export type IsoDate = string;
export type LifeMode = "advance" | "connect" | "restore" | "explore" | "pause";
export type TileZone = "center" | "north" | "northeast" | "southeast" | "south" | "southwest" | "northwest";
export type PlacementRule = "anchor" | "edge" | "free";
export type AchievementCategory = "world" | "life" | "custom";
export type AchievementTriggerType = "count" | "streak" | "date" | "manual";
export type AssetCategory = "building" | "vegetation" | "prop";
export type LifeTheme = "project" | "connection" | "rest" | "movement" | "exploration" | "ordinary_day";
export type LifeAtmosphere = "focused" | "warm" | "soft" | "quiet" | "tired_calm" | "open" | "mixed";
export type ExplicitEmotionLabel = "tired" | "happy" | "anxious" | "relaxed" | "sad" | "excited" | "calm";
export type LifeInterpreterMode = "mock" | "real";
export type AuthMode = "registered" | "guest";

export const TILE_SPEC_SCHEMA_VERSION = "1.0.0" as const;
export const ASSET_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;

export interface DailyRecord {
  id: string;
  date: IsoDate;
  rawText: string;
  transcript: string;
  activities: ActivityEvidence[];
  explicitEmotions: ExplicitEmotion[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface LifeStructure {
  mode: LifeMode;
  continuity: number;
  density: number;
  mobility: number;
  sociality: number;
  directionality: number;
  theme: LifeTheme;
  atmosphere: LifeAtmosphere;
}

export interface ActivityEvidence {
  label: string;
  evidence: string;
}

export interface ExplicitEmotion {
  label: ExplicitEmotionLabel;
  displayLabel: string;
  evidence: string;
}

export interface TileObjectSpec {
  objectId: string;
  assetId: string;
  zone: TileZone;
  placementRule: PlacementRule;
  rotationY: number;
}

export interface TileSpec {
  schemaVersion: typeof TILE_SPEC_SCHEMA_VERSION;
  tileId: string;
  q: number;
  r: number;
  seed: number;
  objects: TileObjectSpec[];
}

export interface TileCandidate {
  id: string;
  recordId: string;
  date: IsoDate;
  tileSpec: TileSpec;
  title: string;
  description: string;
}

export interface AssetManifestEntry {
  assetId: string;
  category: AssetCategory;
  themes: string[];
}

export interface AssetManifest {
  schemaVersion: typeof ASSET_MANIFEST_SCHEMA_VERSION;
  assets: AssetManifestEntry[];
}

export interface UserTileSelection {
  recordId: string;
  candidateId: string;
  tileId: string;
  selectedAt: string;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface UserOverride {
  tileId: string;
  objectId: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  locked: boolean;
  updatedAt: string;
}

export interface WorldState {
  worldId: string;
  tiles: TileSpec[];
  regions: Array<{ id: string; tileIds: string[]; title: string }>;
  metroLines: Array<{ id: string; tileIds: string[]; title: string }>;
  environment: { season: string; atmosphere: string };
  focusedTileId?: string;
  selectedTileId?: string;
  overrides: UserOverride[];
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: AchievementCategory;
  earned: boolean;
  earnedAt?: string;
  progress: number;
  triggerType: AchievementTriggerType;
}

export interface CustomAchievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  ruleType: AchievementTriggerType;
  target: number | IsoDate | null;
  current: number;
  deadline: IsoDate | null;
  completed: boolean;
  completedAt: string | null;
}

export interface SessionState {
  structuresByRecord: Record<string, LifeStructure>;
  candidatesByRecord: Record<string, TileCandidate[]>;
  selectionsByRecord: Record<string, UserTileSelection>;
}

export interface AchievementState {
  counts: Record<string, number>;
  eventDates: Record<string, IsoDate[]>;
  unlocked: Record<string, IsoDate>;
  custom: CustomAchievement[];
}

export interface UserPreferences {
  developerSettings?: { enabled: boolean; simulatedDayOffset: number };
  worldMessageSeen?: boolean;
  annotationsEnabled?: boolean;
  lifeInterpreterMode?: LifeInterpreterMode;
}

export interface InterpretationResult {
  activities: ActivityEvidence[];
  explicitEmotions: ExplicitEmotion[];
  summary: string;
  lifeStructure: LifeStructure;
}

export interface InterpretationDebug {
  input: string;
  provider: string;
  model: string;
  latencyMs: number;
  rawResponse?: unknown;
  validation: "valid";
}

export interface InterpretationExecution {
  result: InterpretationResult;
  debug: InterpretationDebug;
}

export interface AuthUser {
  userId: string;
  displayName: string;
  avatar: string;
  createdAt: string;
  authMode: AuthMode;
}

export interface AuthSession {
  user: AuthUser;
  signedInAt: string;
}

export interface MetroLine {
  lineId: string;
  name: string;
  description?: string;
  emoji?: string;
  tileIds: string[];
  stations?: MetroStation[];
  durationDays?: number;
  state?: "growing" | "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export interface MetroStation {
  stationId: string;
  title: string;
  date: IsoDate;
  tileId?: string;
  description: string;
}

export function isMetroLine(value: unknown): value is MetroLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<MetroLine>;
  return typeof line.lineId === "string" && typeof line.name === "string" && Array.isArray(line.tileIds)
    && (!line.stations || line.stations.every(station => typeof station.stationId === "string" && typeof station.title === "string" && /^\d{4}-\d{2}-\d{2}$/.test(station.date) && typeof station.description === "string"));
}

export interface TodayBundle {
  record: DailyRecord;
  structure: LifeStructure;
  candidates: TileCandidate[];
  selection?: UserTileSelection;
  interpretation?: InterpretationResult;
}

export interface SavedTileContext {
  record: DailyRecord;
  candidate: TileCandidate;
  selection: UserTileSelection;
  tileSpec: TileSpec;
}

export interface LifeMapSnapshot {
  records: DailyRecord[];
  session: SessionState;
  world: WorldState;
  achievements: AchievementState;
  preferences: UserPreferences;
  authSession: AuthSession | null;
  metroLines: MetroLine[];
}
