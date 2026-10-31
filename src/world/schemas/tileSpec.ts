export const TILE_MOODS = ["calm", "warm", "misty"] as const;
export const BUILDING_TYPES = ["home", "cafe", "studio", "library", "workshop", "shop", "pavilion", "tent", "greenhouse", "lighthouse"] as const;
export const TERRAIN_TYPES = ["flat", "mound", "slope", "basin", "ridge", "terrace"] as const;
export const VEGETATION_TYPES = ["round", "tall", "mixed"] as const;
export const PATH_TYPES = ["dirt", "stone", "paved", "curved"] as const;
export const PROP_FAMILIES = ["rest", "garden", "wayfinding", "social"] as const;
export const TILE_PALETTES = ["sage", "autumn", "mist", "coastal"] as const;
export const SCENE_TYPES = ["cafe-courtyard", "workshop-yard", "waterside-garden", "forest-camp", "reading-court", "flower-greenhouse", "seaside-pier", "market-square", "home-orchard"] as const;
export type SceneType = (typeof SCENE_TYPES)[number];
export const WEATHER_TYPES = ["sunny", "overcast", "rain", "snow", "fog"] as const;
export const DAY_TIMES = ["dawn", "day", "dusk", "night"] as const;
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export const DECORATION_IDS = ["campfire", "stool", "bookshelf", "flowerbed", "vegetablebed", "crate", "barrel", "boat", "marketstall", "fruitbasket", "birdhouse", "bicycle", "waterwell", "arch"] as const;
export type DecorationId = (typeof DECORATION_IDS)[number];
export interface EnvironmentSpec { weather: (typeof WEATHER_TYPES)[number]; timeOfDay: (typeof DAY_TIMES)[number]; season: (typeof SEASONS)[number] }
export const DEFAULT_ENVIRONMENT: EnvironmentSpec = { weather: "sunny", timeOfDay: "day", season: "summer" };
export function isEnvironmentSpec(value: unknown): value is EnvironmentSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as EnvironmentSpec;
  return WEATHER_TYPES.includes(spec.weather) && DAY_TIMES.includes(spec.timeOfDay) && SEASONS.includes(spec.season);
}

export type TileMood = (typeof TILE_MOODS)[number];
export type BuildingType = (typeof BUILDING_TYPES)[number];
export type TerrainType = (typeof TERRAIN_TYPES)[number];
export type VegetationType = (typeof VEGETATION_TYPES)[number];
export type PathType = (typeof PATH_TYPES)[number];
export type PropFamily = (typeof PROP_FAMILIES)[number];
export type TilePalette = (typeof TILE_PALETTES)[number];

export interface TerrainSpec {
  type: TerrainType;
  amplitude: number;
}

/** R3F world-generation input. Kept separate from the frozen Unity TileSpec contract. */
export interface ProceduralTileSpec {
  schemaVersion: 2;
  /** Optional for backwards compatibility: absent preserves the original scatter layout. */
  sceneType?: SceneType;
  environment?: EnvironmentSpec;
  decorations?: DecorationId[];
  seed: number;
  mood: TileMood;
  buildingType: BuildingType;
  buildingScale: number;
  treeCount: number;
  density: number;
  terrain: TerrainSpec;
  vegetationType: VegetationType;
  pathType: PathType;
  propFamily: PropFamily;
  palette: TilePalette;
}

/** Public name used by the R3F world slice. */
export type TileSpec = ProceduralTileSpec;

export const DEFAULT_PROCEDURAL_TILE_SPEC: ProceduralTileSpec = {
  schemaVersion: 2,
  seed: 42,
  mood: "calm",
  buildingType: "cafe",
  buildingScale: 1,
  treeCount: 8,
  density: 0.5,
  terrain: { type: "mound", amplitude: 0.42 },
  vegetationType: "mixed",
  pathType: "stone",
  propFamily: "rest",
  palette: "sage"
};

type LegacyTileSpec = Omit<Partial<ProceduralTileSpec>, "buildingType" | "terrain"> & { buildingType?: BuildingType | "cabin"; terrain?: Partial<TerrainSpec> };

export function normalizeTileSpec(input: LegacyTileSpec): ProceduralTileSpec {
  const spec = input ?? {};
  const buildingType = spec.buildingType === "cabin" ? "home" : spec.buildingType;
  return {
    schemaVersion: 2,
    ...(spec.sceneType && SCENE_TYPES.includes(spec.sceneType) ? { sceneType: spec.sceneType } : {}),
    ...(isEnvironmentSpec(spec.environment) ? { environment: { ...spec.environment } } : {}),
    ...(Array.isArray(spec.decorations) ? { decorations: [...new Set(spec.decorations.filter(id => DECORATION_IDS.includes(id)))].slice(0,6) } : {}),
    seed: Math.trunc(Number.isFinite(spec.seed) ? spec.seed as number : 0),
    mood: TILE_MOODS.includes(spec.mood as TileMood) ? spec.mood as TileMood : "calm",
    buildingType: BUILDING_TYPES.includes(buildingType as BuildingType) ? buildingType as BuildingType : "cafe",
    buildingScale: Math.max(0.72, Math.min(1.45, Number.isFinite(spec.buildingScale) ? spec.buildingScale as number : 1)),
    treeCount: Math.max(0, Math.min(24, Math.trunc(Number.isFinite(spec.treeCount) ? spec.treeCount as number : 6))),
    density: Math.max(0, Math.min(1, Number.isFinite(spec.density) ? spec.density as number : 0.5)),
    terrain: {
      type: TERRAIN_TYPES.includes(spec.terrain?.type as TerrainType) ? spec.terrain?.type as TerrainType : "flat",
      amplitude: Math.max(0, Math.min(1.4, Number.isFinite(spec.terrain?.amplitude) ? spec.terrain?.amplitude as number : 0))
    },
    vegetationType: VEGETATION_TYPES.includes(spec.vegetationType as VegetationType) ? spec.vegetationType as VegetationType : "mixed",
    pathType: PATH_TYPES.includes(spec.pathType as PathType) ? spec.pathType as PathType : "dirt",
    propFamily: PROP_FAMILIES.includes(spec.propFamily as PropFamily) ? spec.propFamily as PropFamily : "rest",
    palette: TILE_PALETTES.includes(spec.palette as TilePalette) ? spec.palette as TilePalette : "sage"
  };
}

export function isTileSpec(value: unknown): value is TileSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as Partial<TileSpec>;
  return spec.schemaVersion === 2
    && Number.isInteger(spec.seed)
    && (spec.sceneType === undefined || SCENE_TYPES.includes(spec.sceneType))
    && (spec.environment === undefined || isEnvironmentSpec(spec.environment))
    && (spec.decorations === undefined || Array.isArray(spec.decorations) && spec.decorations.length <= 6 && new Set(spec.decorations).size === spec.decorations.length && spec.decorations.every(id => DECORATION_IDS.includes(id)))
    && TILE_MOODS.includes(spec.mood as TileMood)
    && BUILDING_TYPES.includes(spec.buildingType as BuildingType)
    && Number.isFinite(spec.buildingScale) && (spec.buildingScale ?? 0) >= 0.72 && (spec.buildingScale ?? 2) <= 1.45
    && Number.isInteger(spec.treeCount) && (spec.treeCount ?? -1) >= 0 && (spec.treeCount ?? 25) <= 24
    && Number.isFinite(spec.density) && (spec.density ?? -1) >= 0 && (spec.density ?? 2) <= 1
    && !!spec.terrain && TERRAIN_TYPES.includes(spec.terrain.type) && Number.isFinite(spec.terrain.amplitude) && spec.terrain.amplitude >= 0 && spec.terrain.amplitude <= 1.4
    && VEGETATION_TYPES.includes(spec.vegetationType as VegetationType)
    && PATH_TYPES.includes(spec.pathType as PathType)
    && PROP_FAMILIES.includes(spec.propFamily as PropFamily)
    && TILE_PALETTES.includes(spec.palette as TilePalette);
}
